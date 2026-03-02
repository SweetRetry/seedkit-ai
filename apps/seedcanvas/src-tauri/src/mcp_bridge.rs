//! Unix socket bridge: accepts connections from the seedcanvas-mcp binary
//! and proxies canvas read/batch requests to the WebView via Tauri events.
//!
//! Protocol: newline-delimited JSON over a Unix domain socket.
//!
//! Request:  {"id":"req-1","method":"canvas_read","params":{...}}
//! Response: {"id":"req-1","result":"..."} or {"id":"req-1","error":"..."}

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Listener};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;
use tokio::sync::{oneshot, Mutex};
use tracing::{error, info, warn};

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct BridgeRequest {
    id: String,
    method: String,
    params: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct BridgeResponse {
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

// ---------------------------------------------------------------------------
// Pending response registry — shared between event listener and socket writer
// ---------------------------------------------------------------------------

type PendingMap = Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>;

// ---------------------------------------------------------------------------
// Tauri event payloads
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct McpCanvasReadEvent {
    request_id: String,
    scope: serde_json::Value,
    node_ids: serde_json::Value,
    edge_ids: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct McpCanvasBatchEvent {
    request_id: String,
    operations: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
struct McpResponseEvent {
    id: String,
    result: String,
}

// ---------------------------------------------------------------------------
// Public entry point — called from lib.rs setup()
// ---------------------------------------------------------------------------

pub async fn start(data_dir: PathBuf, app_handle: AppHandle) -> Result<()> {
    let sock_path = data_dir.join("mcp.sock");

    // Clean up stale socket
    if sock_path.exists() {
        let _ = std::fs::remove_file(&sock_path);
    }

    let listener = UnixListener::bind(&sock_path)?;
    info!(path = %sock_path.display(), "MCP bridge listening");

    // Shared pending-response map
    let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));

    // Listen for mcp:response events from the WebView.
    // Tauri's listen callback is sync (Fn, not async), so we use
    // try_lock and handle contention gracefully.
    let pending_for_listener = Arc::clone(&pending);
    app_handle.listen("mcp:response", move |event| {
        let payload = event.payload();
        match serde_json::from_str::<McpResponseEvent>(payload) {
            Ok(resp) => {
                // Use try_lock to avoid blocking the event thread.
                // If the lock is contended, the response sender is dropped and
                // the waiting connection will get a timeout error instead.
                if let Ok(mut map) = pending_for_listener.try_lock() {
                    if let Some(tx) = map.remove(&resp.id) {
                        let _ = tx.send(resp.result);
                    }
                } else {
                    // Rare: lock contended. Spawn a task to retry.
                    let pending = Arc::clone(&pending_for_listener);
                    let resp_id = resp.id;
                    let resp_result = resp.result;
                    tokio::spawn(async move {
                        let mut map = pending.lock().await;
                        if let Some(tx) = map.remove(&resp_id) {
                            let _ = tx.send(resp_result);
                        }
                    });
                }
            }
            Err(e) => {
                warn!("Failed to parse mcp:response payload: {e}");
            }
        }
    });

    // Accept connections
    loop {
        match listener.accept().await {
            Ok((stream, _addr)) => {
                let app = app_handle.clone();
                let pending = Arc::clone(&pending);

                tokio::spawn(async move {
                    if let Err(e) = handle_connection(stream, app, pending).await {
                        warn!("MCP bridge connection ended: {e:#}");
                    }
                });
            }
            Err(e) => {
                error!("MCP bridge accept error: {e}");
            }
        }
    }
}

async fn handle_connection(
    stream: tokio::net::UnixStream,
    app: AppHandle,
    pending: PendingMap,
) -> Result<()> {
    let (reader, mut writer) = stream.into_split();
    let mut buf_reader = BufReader::new(reader);
    let mut line = String::new();

    loop {
        line.clear();
        let bytes_read = buf_reader.read_line(&mut line).await?;
        if bytes_read == 0 {
            break;
        }

        let req: BridgeRequest = match serde_json::from_str(line.trim()) {
            Ok(r) => r,
            Err(e) => {
                let resp = BridgeResponse {
                    id: "unknown".into(),
                    result: None,
                    error: Some(format!("Invalid request JSON: {e}")),
                };
                let mut resp_line = serde_json::to_string(&resp)?;
                resp_line.push('\n');
                writer.write_all(resp_line.as_bytes()).await?;
                continue;
            }
        };

        let request_id = req.id.clone();

        // Create a oneshot channel for the response from the WebView
        let (tx, rx) = oneshot::channel();
        {
            let mut map = pending.lock().await;
            map.insert(request_id.clone(), tx);
        }

        // Emit the appropriate event to the WebView
        let emit_result = match req.method.as_str() {
            "canvas_read" => app.emit(
                "mcp:canvas_read",
                McpCanvasReadEvent {
                    request_id: request_id.clone(),
                    scope: req.params.get("scope").cloned().unwrap_or_default(),
                    node_ids: req.params.get("nodeIds").cloned().unwrap_or_default(),
                    edge_ids: req.params.get("edgeIds").cloned().unwrap_or_default(),
                },
            ),
            "canvas_batch" => app.emit(
                "mcp:canvas_batch",
                McpCanvasBatchEvent {
                    request_id: request_id.clone(),
                    operations: req.params.clone(),
                },
            ),
            other => {
                // Unknown method — respond with error, clean up pending
                let mut map = pending.lock().await;
                map.remove(&request_id);
                let resp = BridgeResponse {
                    id: request_id,
                    result: None,
                    error: Some(format!("Unknown method: {other}")),
                };
                let mut resp_line = serde_json::to_string(&resp)?;
                resp_line.push('\n');
                writer.write_all(resp_line.as_bytes()).await?;
                continue;
            }
        };

        if let Err(e) = emit_result {
            let mut map = pending.lock().await;
            map.remove(&request_id);
            let resp = BridgeResponse {
                id: request_id,
                result: None,
                error: Some(format!("Failed to emit event: {e}")),
            };
            let mut resp_line = serde_json::to_string(&resp)?;
            resp_line.push('\n');
            writer.write_all(resp_line.as_bytes()).await?;
            continue;
        }

        // Wait for the WebView to respond (with a timeout)
        let response = tokio::time::timeout(std::time::Duration::from_secs(30), rx).await;

        let resp = match response {
            Ok(Ok(result)) => BridgeResponse {
                id: request_id,
                result: Some(result),
                error: None,
            },
            Ok(Err(_)) => BridgeResponse {
                id: request_id,
                result: None,
                error: Some("Response channel closed".into()),
            },
            Err(_) => {
                // Timeout — clean up pending entry
                let mut map = pending.lock().await;
                map.remove(&request_id);
                BridgeResponse {
                    id: request_id,
                    result: None,
                    error: Some("Request timed out (30s)".into()),
                }
            }
        };

        let mut resp_line = serde_json::to_string(&resp)?;
        resp_line.push('\n');
        writer.write_all(resp_line.as_bytes()).await?;
    }

    Ok(())
}
