pub mod ark;
pub mod db;
pub mod mcp;
pub mod tasks;

#[cfg(unix)]
mod mcp_bridge;

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::Manager;
use tracing::info;

use ark::ArkClient;
use db::Db;
use tasks::{ImageParams, TaskQueue, VideoParams};

// ---------------------------------------------------------------------------
// App state managed by Tauri
// ---------------------------------------------------------------------------

struct AppState {
    task_queue: Arc<TaskQueue>,
}

// ---------------------------------------------------------------------------
// Settings — read from {appDataDir}/settings.json
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    #[serde(default)]
    api_key: String,
    #[serde(default = "default_base_url")]
    #[serde(alias = "baseURL")]
    base_url: String,
    #[serde(default)]
    model: String,
}

fn default_base_url() -> String {
    "https://ark.cn-beijing.volces.com/api/v3".to_string()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            base_url: default_base_url(),
            model: String::new(),
        }
    }
}

fn load_settings(data_dir: &PathBuf) -> Settings {
    let path = data_dir.join("settings.json");
    match std::fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
async fn generate_image(
    state: tauri::State<'_, AppState>,
    project_id: String,
    prompt: String,
    model: Option<String>,
    node_id: Option<String>,
    size: Option<String>,
) -> Result<serde_json::Value, String> {
    let params = ImageParams {
        project_id,
        prompt,
        model,
        node_id,
        size,
    };

    let task_id = state
        .task_queue
        .submit_image(params)
        .map_err(|e| format!("{e:#}"))?;

    Ok(serde_json::json!({
        "taskId": task_id,
        "status": "submitted",
    }))
}

#[tauri::command]
async fn generate_video(
    state: tauri::State<'_, AppState>,
    project_id: String,
    prompt: String,
    model: Option<String>,
    node_id: Option<String>,
    resolution: Option<String>,
    ratio: Option<String>,
    duration: Option<i32>,
) -> Result<serde_json::Value, String> {
    let params = VideoParams {
        project_id,
        prompt,
        model,
        node_id,
        resolution,
        ratio,
        duration,
    };

    let task_id = state
        .task_queue
        .submit_video(params)
        .map_err(|e| format!("{e:#}"))?;

    Ok(serde_json::json!({
        "taskId": task_id,
        "status": "submitted",
    }))
}

#[tauri::command]
async fn task_status(
    state: tauri::State<'_, AppState>,
    task_id: String,
) -> Result<serde_json::Value, String> {
    let task = state
        .task_queue
        .get_task(&task_id)
        .map_err(|e| format!("{e:#}"))?;

    match task {
        Some(t) => Ok(serde_json::json!({
            "taskId": t.id,
            "projectId": t.project_id,
            "type": t.task_type,
            "status": t.status,
            "output": t.output.as_deref().and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok()),
            "error": t.error,
            "createdAt": t.created_at,
            "updatedAt": t.updated_at,
        })),
        None => Ok(serde_json::json!({
            "taskId": task_id,
            "status": "not_found",
        })),
    }
}

// ---------------------------------------------------------------------------
// MCP onboarding commands
// ---------------------------------------------------------------------------

/// Return the current compilation target triple (e.g. "aarch64-apple-darwin").
fn current_target_triple() -> &'static str {
    #[cfg(all(target_arch = "aarch64", target_os = "macos"))]
    { "aarch64-apple-darwin" }
    #[cfg(all(target_arch = "x86_64", target_os = "macos"))]
    { "x86_64-apple-darwin" }
    #[cfg(all(target_arch = "x86_64", target_os = "linux"))]
    { "x86_64-unknown-linux-gnu" }
    #[cfg(all(target_arch = "aarch64", target_os = "linux"))]
    { "aarch64-unknown-linux-gnu" }
    #[cfg(all(target_arch = "x86_64", target_os = "windows"))]
    { "x86_64-pc-windows-msvc" }
}

#[tauri::command]
async fn resolve_mcp_binary_path(app: tauri::AppHandle) -> Result<String, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("failed to resolve resource dir: {e}"))?;

    let triple = current_target_triple();
    let binary_name = format!("binaries/seedcanvas-mcp-{triple}");

    #[cfg(target_os = "windows")]
    let binary_name = format!("{binary_name}.exe");

    let binary_path = resource_dir.join(&binary_name);
    Ok(binary_path.to_string_lossy().to_string())
}

/// Path to `~/.claude.json`.
fn claude_config_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("could not determine home directory")?;
    Ok(home.join(".claude.json"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct McpConfigStatus {
    configured: bool,
    current_path: Option<String>,
}

#[tauri::command]
async fn check_mcp_config() -> Result<McpConfigStatus, String> {
    let path = claude_config_path()?;
    let config = read_claude_config(&path);

    let entry = config
        .get("mcpServers")
        .and_then(|s| s.get("seedcanvas"));

    match entry {
        Some(obj) => {
            let cmd = obj
                .get("command")
                .and_then(|v| v.as_str())
                .map(String::from);
            Ok(McpConfigStatus {
                configured: true,
                current_path: cmd,
            })
        }
        None => Ok(McpConfigStatus {
            configured: false,
            current_path: None,
        }),
    }
}

#[tauri::command]
async fn inject_mcp_config(binary_path: String) -> Result<serde_json::Value, String> {
    let path = claude_config_path()?;
    let mut config = read_claude_config(&path);

    // Ensure mcpServers object exists
    let mcp_servers = config
        .as_object_mut()
        .ok_or("~/.claude.json is not a JSON object")?
        .entry("mcpServers")
        .or_insert_with(|| serde_json::json!({}));

    let servers = mcp_servers
        .as_object_mut()
        .ok_or("mcpServers is not a JSON object")?;

    servers.insert(
        "seedcanvas".to_string(),
        serde_json::json!({
            "command": binary_path,
            "args": []
        }),
    );

    // Write back with pretty formatting
    let contents = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("failed to serialize config: {e}"))?;
    std::fs::write(&path, contents)
        .map_err(|e| format!("failed to write {}: {e}", path.display()))?;

    Ok(serde_json::json!({ "ok": true }))
}

/// Read `~/.claude.json`, returning `{}` if missing or unparseable.
fn read_claude_config(path: &Path) -> serde_json::Value {
    match std::fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_else(|_| serde_json::json!({})),
        Err(_) => serde_json::json!({}),
    }
}

// ---------------------------------------------------------------------------
// Tauri app setup
// ---------------------------------------------------------------------------

pub fn run() {
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&data_dir)?;

            // Load settings
            let settings = load_settings(&data_dir);
            info!(base_url = %settings.base_url, "loaded settings");

            // Open SQLite database
            let db_path = data_dir.join("seedcanvas.db");
            let db = Db::open(&db_path).expect("failed to open database");

            // Create ARK client
            let ark = ArkClient::new(settings.base_url, settings.api_key);

            // Projects directory (same as frontend uses via Tauri fs plugin)
            let projects_dir = data_dir.join("projects");
            std::fs::create_dir_all(&projects_dir)?;

            // Create task queue and resume any interrupted tasks
            let task_queue = TaskQueue::new(db, ark, app.handle().clone(), projects_dir);
            if let Err(e) = task_queue.resume_running_tasks() {
                tracing::error!("failed to resume running tasks: {e:#}");
            }

            app.manage(AppState {
                task_queue: Arc::new(task_queue),
            });

            // Start the Unix socket bridge for MCP binary communication
            #[cfg(unix)]
            {
                let bridge_data_dir = data_dir.clone();
                let bridge_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = mcp_bridge::start(bridge_data_dir, bridge_handle).await {
                        tracing::error!("MCP bridge failed: {e:#}");
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            generate_image,
            generate_video,
            task_status,
            resolve_mcp_binary_path,
            check_mcp_config,
            inject_mcp_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
