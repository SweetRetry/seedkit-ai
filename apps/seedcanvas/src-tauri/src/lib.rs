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
use db::{Db, SharedDb};
use tasks::{ImageParams, TaskQueue, UserDefaults, VideoParams};

// ---------------------------------------------------------------------------
// App state managed by Tauri
// ---------------------------------------------------------------------------

struct AppState {
    task_queue: Arc<TaskQueue>,
    db: SharedDb,
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
    #[serde(default)]
    default_image_model: Option<String>,
    #[serde(default)]
    default_video_model: Option<String>,
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
            default_image_model: None,
            default_video_model: None,
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
// Asset & Usage commands
// ---------------------------------------------------------------------------

#[tauri::command]
async fn list_assets(
    state: tauri::State<'_, AppState>,
    project_id: Option<String>,
    asset_type: Option<String>,
    query: Option<String>,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<Vec<db::AssetRow>, String> {
    let db = state.db.lock().map_err(|e| format!("db lock: {e}"))?;
    db.list_assets(
        project_id.as_deref(),
        asset_type.as_deref(),
        query.as_deref(),
        limit.unwrap_or(50),
        offset.unwrap_or(0),
    )
    .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn get_asset_stats(
    state: tauri::State<'_, AppState>,
) -> Result<db::AssetStats, String> {
    let db = state.db.lock().map_err(|e| format!("db lock: {e}"))?;
    db.get_asset_stats().map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn register_imported_asset(
    state: tauri::State<'_, AppState>,
    project_id: String,
    file_path: String,
    file_name: String,
    asset_type: String,
) -> Result<serde_json::Value, String> {
    let file_size = std::fs::metadata(&file_path).ok().map(|m| m.len() as i64);
    let now = chrono::Utc::now().to_rfc3339();

    let asset = db::AssetRow {
        id: uuid::Uuid::new_v4().to_string(),
        project_id,
        task_id: None,
        asset_type,
        file_path,
        file_name,
        prompt: None,
        model: None,
        width: None,
        height: None,
        file_size,
        source: "imported".to_string(),
        created_at: now,
    };

    let db = state.db.lock().map_err(|e| format!("db lock: {e}"))?;
    db.insert_asset(&asset).map_err(|e| format!("{e:#}"))?;

    Ok(serde_json::json!({ "id": asset.id }))
}

#[tauri::command]
async fn get_usage_stats(
    state: tauri::State<'_, AppState>,
) -> Result<db::UsageStats, String> {
    let db = state.db.lock().map_err(|e| format!("db lock: {e}"))?;
    db.get_usage_stats().map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn get_data_dir_info(
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve data dir: {e}"))?;
    let db_path = data_dir.join("seedcanvas.db");
    let db_size = std::fs::metadata(&db_path).ok().map(|m| m.len()).unwrap_or(0);

    Ok(serde_json::json!({
        "dataDir": data_dir.to_string_lossy(),
        "dbSize": db_size,
    }))
}

/// Delete SQLite data associated with a project.
/// When `keep_assets` is true, only tasks are deleted (asset records remain to track files on disk).
#[tauri::command]
async fn delete_project_data(
    state: tauri::State<'_, AppState>,
    project_id: String,
    keep_assets: Option<bool>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| format!("db lock: {e}"))?;
    if keep_assets.unwrap_or(false) {
        db.delete_tasks_by_project(&project_id).map_err(|e| format!("{e:#}"))
    } else {
        db.delete_all_project_data(&project_id).map_err(|e| format!("{e:#}"))
    }
}

#[tauri::command]
async fn reveal_data_dir(app: tauri::AppHandle) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve data dir: {e}"))?;

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&data_dir)
            .spawn()
            .map_err(|e| format!("failed to open Finder: {e}"))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&data_dir)
            .spawn()
            .map_err(|e| format!("failed to open file manager: {e}"))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&data_dir)
            .spawn()
            .map_err(|e| format!("failed to open Explorer: {e}"))?;
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Orphan project cleanup
// ---------------------------------------------------------------------------

/// An orphan directory found in projects/ that isn't tracked in projects.json.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OrphanProject {
    id: String,
    path: String,
    has_manifest: bool,
    has_assets: bool,
    size_bytes: u64,
}

/// Scan projects/ directory for subdirectories not tracked in projects.json.
#[tauri::command]
async fn scan_orphan_projects(app: tauri::AppHandle) -> Result<Vec<OrphanProject>, String> {
    let data_dir = app.path().app_data_dir()
        .map_err(|e| format!("failed to resolve data dir: {e}"))?;
    let projects_dir = data_dir.join("projects");

    // Read projects.json to find tracked project IDs
    let index_path = data_dir.join("projects.json");
    let tracked_ids: std::collections::HashSet<String> = match std::fs::read_to_string(&index_path) {
        Ok(contents) => {
            serde_json::from_str::<Vec<serde_json::Value>>(&contents)
                .unwrap_or_default()
                .iter()
                .filter_map(|v| v["id"].as_str().map(String::from))
                .collect()
        }
        Err(_) => std::collections::HashSet::new(),
    };

    let mut orphans = Vec::new();
    let entries = std::fs::read_dir(&projects_dir).map_err(|e| format!("{e}"))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let dir_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };

        if tracked_ids.contains(&dir_name) {
            continue;
        }

        // This directory is an orphan
        let has_manifest = path.join("manifest.json").exists();
        let has_assets = path.join("assets").is_dir();
        let size_bytes = dir_size(&path);

        orphans.push(OrphanProject {
            id: dir_name,
            path: path.to_string_lossy().to_string(),
            has_manifest,
            has_assets,
            size_bytes,
        });
    }

    Ok(orphans)
}

/// Delete specified orphan project directories and their SQLite data.
#[tauri::command]
async fn cleanup_orphan_projects(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    project_ids: Vec<String>,
) -> Result<serde_json::Value, String> {
    let data_dir = app.path().app_data_dir()
        .map_err(|e| format!("failed to resolve data dir: {e}"))?;
    let projects_dir = data_dir.join("projects");

    let mut deleted = 0u32;
    let mut errors = Vec::new();

    for id in &project_ids {
        // Delete SQLite data (tasks + assets)
        if let Ok(db) = state.db.lock() {
            let _ = db.delete_all_project_data(id);
        }

        // Delete the directory on disk
        let dir = projects_dir.join(id);
        if dir.is_dir() {
            match std::fs::remove_dir_all(&dir) {
                Ok(()) => deleted += 1,
                Err(e) => errors.push(format!("{id}: {e}")),
            }
        } else {
            deleted += 1; // Already gone
        }
    }

    Ok(serde_json::json!({ "deleted": deleted, "errors": errors }))
}

/// Recursively compute directory size in bytes.
fn dir_size(path: &Path) -> u64 {
    let mut total = 0u64;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                total += dir_size(&p);
            } else if let Ok(meta) = p.metadata() {
                total += meta.len();
            }
        }
    }
    total
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

            // Open SQLite database (shared handle)
            let db_path = data_dir.join("seedcanvas.db");
            let db = Db::open(&db_path).expect("failed to open database");
            let shared_db: SharedDb = Arc::new(std::sync::Mutex::new(db));

            // Backfill asset records from existing tasks
            {
                let guard = shared_db.lock().expect("db lock for backfill");
                match guard.backfill_assets_from_tasks() {
                    Ok(0) => {}
                    Ok(n) => info!(count = n, "backfilled asset records from existing tasks"),
                    Err(e) => tracing::error!("asset backfill failed: {e:#}"),
                }
            }

            // Create ARK client
            let ark = ArkClient::new(settings.base_url, settings.api_key);

            // Projects directory (same as frontend uses via Tauri fs plugin)
            let projects_dir = data_dir.join("projects");
            std::fs::create_dir_all(&projects_dir)?;

            // Build user defaults from settings
            let user_defaults = UserDefaults {
                default_image_model: settings.default_image_model,
                default_video_model: settings.default_video_model,
            };

            // Create task queue with shared DB and resume any interrupted tasks
            let task_queue = TaskQueue::new_with_shared(
                Arc::clone(&shared_db),
                ark,
                app.handle().clone(),
                projects_dir,
                user_defaults,
            );
            if let Err(e) = task_queue.resume_running_tasks() {
                tracing::error!("failed to resume running tasks: {e:#}");
            }

            app.manage(AppState {
                task_queue: Arc::new(task_queue),
                db: shared_db,
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
            list_assets,
            get_asset_stats,
            register_imported_asset,
            get_usage_stats,
            get_data_dir_info,
            delete_project_data,
            reveal_data_dir,
            scan_orphan_projects,
            cleanup_orphan_projects,
            resolve_mcp_binary_path,
            check_mcp_config,
            inject_mcp_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
