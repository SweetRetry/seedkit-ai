use anyhow::{bail, Context, Result};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};
use tokio::time::{sleep, Duration, Instant};
use tracing::{error, info, warn};

use super::SharedDb;
use crate::ark::types::{VideoContentItem, VideoGenRequest};
use crate::ark::ArkClient;
use crate::db::TaskRow;

const POLL_INTERVAL: Duration = Duration::from_secs(5);
const POLL_TIMEOUT: Duration = Duration::from_secs(600); // 10 minutes

/// Execute video generation: create task, poll until done, download video, write asset.
pub async fn run_video_task(
    db: &SharedDb,
    ark: &ArkClient,
    app_handle: &Option<AppHandle>,
    task: &TaskRow,
    projects_dir: &PathBuf,
) {
    let task_id = task.id.clone();

    if let Err(e) = execute(db, ark, task, projects_dir).await {
        error!(task_id = %task_id, "video task failed: {e:#}");
        if let Ok(guard) = db.lock() {
            let _ = guard.update_task(&task_id, "failed", None, None, Some(&format!("{e:#}")));
        }
        if let Some(ref handle) = app_handle {
            let _ = handle.emit("task:complete", serde_json::json!({
                "taskId": task_id,
                "status": "failed",
                "error": format!("{e:#}"),
            }));
        }
        return;
    }

    info!(task_id = %task_id, "video task completed");
}

async fn execute(
    db: &SharedDb,
    ark: &ArkClient,
    task: &TaskRow,
    projects_dir: &PathBuf,
) -> Result<()> {
    let input: serde_json::Value =
        serde_json::from_str(&task.input).context("invalid task input JSON")?;
    let prompt = input["prompt"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("missing prompt in task input"))?;
    let model = input["model"]
        .as_str()
        .unwrap_or(super::DEFAULT_VIDEO_MODEL);
    let resolution = input["resolution"].as_str().map(String::from);
    let ratio = input["ratio"].as_str().map(String::from);
    let duration = input["duration"].as_i64().map(|v| v as i32);

    // Mark as running
    {
        let guard = db.lock().map_err(|e| anyhow::anyhow!("db lock: {e}"))?;
        guard.update_task(&task.id, "running", None, None, None)?;
    }

    // Step 1: Create async video generation task
    let req = VideoGenRequest {
        model: model.to_string(),
        content: vec![VideoContentItem {
            content_type: "text".to_string(),
            text: Some(prompt.to_string()),
        }],
        resolution,
        ratio,
        duration,
        watermark: false,
    };

    let ark_task_id = ark.create_video_task(&req).await?;
    {
        let guard = db.lock().map_err(|e| anyhow::anyhow!("db lock: {e}"))?;
        guard.update_task(&task.id, "running", None, Some(&ark_task_id), None)?;
    }

    // Step 2: Poll for completion
    let start = Instant::now();
    let video_url = loop {
        if start.elapsed() > POLL_TIMEOUT {
            bail!(
                "video generation timed out after {}s (ark_task: {ark_task_id})",
                POLL_TIMEOUT.as_secs()
            );
        }

        sleep(POLL_INTERVAL).await;

        let status = ark.get_video_task(&ark_task_id).await?;
        match status.status.as_deref() {
            Some("succeeded") => {
                let url = status
                    .content
                    .and_then(|c| c.video_url)
                    .ok_or_else(|| anyhow::anyhow!("succeeded but no video URL"))?;
                break url;
            }
            Some("failed") | Some("expired") | Some("cancelled") => {
                let msg = status
                    .error
                    .and_then(|e| e.message)
                    .unwrap_or_else(|| "unknown error".to_string());
                bail!(
                    "video task {}: {} (ark_task: {ark_task_id})",
                    status.status.as_deref().unwrap_or("unknown"),
                    msg
                );
            }
            Some(s) => {
                info!(ark_task_id = %ark_task_id, status = %s, "polling video task...");
            }
            None => {
                warn!(ark_task_id = %ark_task_id, "poll returned no status");
            }
        }
    };

    // Step 3: Download video → write to assets
    let http = reqwest::Client::new();
    let video_bytes = http
        .get(&video_url)
        .send()
        .await?
        .bytes()
        .await
        .context("failed to download video")?;

    let asset_dir = projects_dir.join(&task.project_id).join("assets");
    tokio::fs::create_dir_all(&asset_dir).await?;

    let filename = format!("{}.mp4", uuid::Uuid::new_v4());
    let asset_path = asset_dir.join(&filename);
    tokio::fs::write(&asset_path, &video_bytes).await?;

    let output = serde_json::json!({
        "assetPath": asset_path.to_string_lossy(),
        "width": 1280,
        "height": 720,
    });

    {
        let guard = db.lock().map_err(|e| anyhow::anyhow!("db lock: {e}"))?;
        guard.update_task(&task.id, "done", Some(&output.to_string()), Some(&ark_task_id), None)?;
    }

    Ok(())
}
