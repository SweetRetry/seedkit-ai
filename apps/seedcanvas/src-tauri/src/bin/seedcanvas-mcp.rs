//! Standalone MCP server binary for SeedCanvas.
//!
//! Communicates with AI clients (e.g. Claude Desktop) over stdio JSON-RPC.
//! Optionally connects to the running SeedCanvas desktop app via Unix socket
//! for canvas read/write operations.

use anyhow::{Context, Result};
use rmcp::{transport::stdio, ServiceExt};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::mpsc;
use tracing::info;

// Import from the library crate
use seedcanvas_lib::ark::ArkClient;
use seedcanvas_lib::db::Db;
use seedcanvas_lib::mcp::{CanvasIpcRequest, SeedCanvasMcp};
use seedcanvas_lib::tasks::TaskQueue;

// ---------------------------------------------------------------------------
// Settings — mirrors lib.rs but avoids pulling in Tauri types
// ---------------------------------------------------------------------------

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    #[serde(default)]
    api_key: String,
    #[serde(default = "default_base_url")]
    #[serde(alias = "baseURL")]
    base_url: String,
}

fn default_base_url() -> String {
    "https://ark.cn-beijing.volces.com/api/v3".to_string()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            base_url: default_base_url(),
        }
    }
}

// ---------------------------------------------------------------------------
// Unix socket client — connects to the running Tauri app's bridge
// ---------------------------------------------------------------------------

#[cfg(unix)]
async fn connect_canvas_socket(
    sock_path: &PathBuf,
) -> Option<mpsc::Sender<CanvasIpcRequest>> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::UnixStream;

    let stream = match UnixStream::connect(sock_path).await {
        Ok(s) => s,
        Err(e) => {
            info!("SeedCanvas app not running (socket connect failed: {e}). Canvas tools disabled.");
            return None;
        }
    };

    info!("Connected to SeedCanvas app via {}", sock_path.display());

    let (tx, mut rx) = mpsc::channel::<CanvasIpcRequest>(32);

    tokio::spawn(async move {
        let (reader, mut writer) = stream.into_split();
        let mut buf_reader = BufReader::new(reader);

        while let Some(req) = rx.recv().await {
            let (method, params, reply) = match req {
                CanvasIpcRequest::Read { params, reply } => ("canvas_read", params, reply),
                CanvasIpcRequest::Batch { operations, reply } => {
                    ("canvas_batch", operations, reply)
                }
            };

            let request = serde_json::json!({
                "id": uuid::Uuid::new_v4().to_string(),
                "method": method,
                "params": params,
            });

            let mut line = serde_json::to_string(&request).unwrap();
            line.push('\n');

            if writer.write_all(line.as_bytes()).await.is_err() {
                let _ = reply.send(Err("Lost connection to SeedCanvas app".into()));
                break;
            }

            // Read response line
            let mut response_line = String::new();
            match buf_reader.read_line(&mut response_line).await {
                Ok(0) | Err(_) => {
                    let _ = reply.send(Err("Lost connection to SeedCanvas app".into()));
                    break;
                }
                Ok(_) => {}
            }

            let response: serde_json::Value =
                serde_json::from_str(response_line.trim()).unwrap_or_default();

            if let Some(err) = response.get("error") {
                let _ = reply.send(Err(err.to_string()));
            } else if let Some(result) = response.get("result") {
                let _ = reply.send(Ok(result.as_str().unwrap_or("{}").to_string()));
            } else {
                let _ = reply.send(Ok(response_line.trim().to_string()));
            }
        }
    });

    Some(tx)
}

#[cfg(not(unix))]
async fn connect_canvas_socket(
    _sock_path: &PathBuf,
) -> Option<mpsc::Sender<CanvasIpcRequest>> {
    info!("Unix socket bridge is only supported on Unix platforms. Canvas tools disabled.");
    None
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() -> Result<()> {
    // Log to stderr so stdout stays clean for MCP JSON-RPC
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .init();

    // Resolve app data directory (same as Tauri: com.seedkit.canvas)
    let data_dir = resolve_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;

    // Load settings
    let settings_path = data_dir.join("settings.json");
    let settings: Settings = match std::fs::read_to_string(&settings_path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => Settings::default(),
    };

    info!(base_url = %settings.base_url, "loaded settings");

    // Open database
    let db_path = data_dir.join("seedcanvas.db");
    let db = Db::open(&db_path).context("failed to open database")?;

    // Create ARK client
    let ark = ArkClient::new(settings.base_url, settings.api_key);

    // Projects directory
    let projects_dir = data_dir.join("projects");
    std::fs::create_dir_all(&projects_dir)?;

    // Create headless task queue (no AppHandle — events won't emit to frontend)
    let mut task_queue = TaskQueue::new_headless(db, ark, projects_dir);

    // Try connecting to the running SeedCanvas app via Unix socket
    let sock_path = data_dir.join("mcp.sock");
    let canvas_tx = connect_canvas_socket(&sock_path).await;

    // When connected to the app, register a task-completion callback that pushes
    // results to canvas nodes via the existing socket bridge (canvas_batch).
    if let Some(ref tx) = canvas_tx {
        let tx = tx.clone();
        task_queue.set_on_complete(std::sync::Arc::new(move |task: seedcanvas_lib::db::TaskRow| {
            if task.status != "done" {
                return;
            }
            // Extract node_id and output from the completed task
            let node_id = serde_json::from_str::<serde_json::Value>(&task.input)
                .ok()
                .and_then(|v| v["node_id"].as_str().map(String::from));
            let output = task.output.as_deref()
                .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok());

            if let (Some(node_id), Some(output)) = (node_id, output) {
                let asset_path = output["assetPath"].as_str().unwrap_or_default().to_string();
                if asset_path.is_empty() {
                    return;
                }

                // Build an update_node batch op with the asset URL
                let (url_key, width, height) = if task.task_type == "image" {
                    ("newImageUrl",
                     output["width"].as_u64().unwrap_or(2048) as u32,
                     output["height"].as_u64().unwrap_or(2048) as u32)
                } else {
                    ("newVideoUrl",
                     output["width"].as_u64().unwrap_or(1280) as u32,
                     output["height"].as_u64().unwrap_or(720) as u32)
                };

                let batch_op = serde_json::json!([{
                    "op": "update_node",
                    "nodeId": node_id,
                    url_key: asset_path,
                    "width": width,
                    "height": height,
                }]);

                let tx = tx.clone();
                tokio::spawn(async move {
                    let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
                    if tx.send(seedcanvas_lib::mcp::CanvasIpcRequest::Batch {
                        operations: batch_op,
                        reply: reply_tx,
                    }).await.is_ok() {
                        match reply_rx.await {
                            Ok(Ok(_)) => info!("pushed task result to node {}", node_id),
                            Ok(Err(e)) => tracing::warn!("failed to push result to node: {e}"),
                            Err(_) => tracing::warn!("bridge response channel closed"),
                        }
                    }
                });
            }
        }));
    }

    let task_queue = Arc::new(task_queue);

    // Create MCP server and serve over stdio
    let server = SeedCanvasMcp::new(task_queue, canvas_tx);

    info!("SeedCanvas MCP server starting on stdio");

    let service = server
        .serve(stdio())
        .await
        .context("MCP server failed to start")?;

    service.waiting().await?;

    Ok(())
}

/// Resolve the app data directory cross-platform.
/// Uses the same identifier as the Tauri app: com.seedkit.canvas
fn resolve_data_dir() -> Result<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let home = dirs::home_dir().context("could not determine home directory")?;
        Ok(home.join("Library/Application Support/com.seedkit.canvas"))
    }

    #[cfg(target_os = "linux")]
    {
        let data = dirs::data_dir().context("could not determine data directory")?;
        Ok(data.join("com.seedkit.canvas"))
    }

    #[cfg(target_os = "windows")]
    {
        let data = dirs::data_dir().context("could not determine data directory")?;
        Ok(data.join("com.seedkit.canvas"))
    }
}
