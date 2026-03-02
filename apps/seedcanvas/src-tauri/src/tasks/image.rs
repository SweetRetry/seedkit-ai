use anyhow::{Context, Result};
use base64::Engine;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};
use tracing::{error, info};

use super::SharedDb;
use crate::ark::types::ImageGenRequest;
use crate::ark::ArkClient;
use crate::db::{AssetRow, TaskRow};

/// Execute image generation: call ARK API, decode base64, write asset, update DB.
pub async fn run_image_task(
    db: &SharedDb,
    ark: &ArkClient,
    app_handle: &Option<AppHandle>,
    task: &TaskRow,
    projects_dir: &PathBuf,
) {
    let task_id = task.id.clone();

    if let Err(e) = execute(db, ark, task, projects_dir).await {
        error!(task_id = %task_id, "image task failed: {e:#}");
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

    info!(task_id = %task_id, "image task completed");
}

async fn execute(
    db: &SharedDb,
    ark: &ArkClient,
    task: &TaskRow,
    projects_dir: &PathBuf,
) -> Result<()> {
    // Parse input parameters
    let input: serde_json::Value =
        serde_json::from_str(&task.input).context("invalid task input JSON")?;
    let prompt = input["prompt"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("missing prompt in task input"))?;
    let model = input["model"]
        .as_str()
        .unwrap_or("doubao-seedream-5-0-260128");
    let size = input["size"].as_str().map(String::from);

    // Mark as running
    {
        let guard = db.lock().map_err(|e| anyhow::anyhow!("db lock: {e}"))?;
        guard.update_task(&task.id, "running", None, None, None)?;
    }

    // Call ARK image generation API
    let req = ImageGenRequest {
        model: model.to_string(),
        prompt: prompt.to_string(),
        size,
        n: Some(1),
        response_format: "b64_json".to_string(),
        watermark: false,
    };

    let resp = ark.generate_image(&req).await?;

    let item = resp
        .data
        .first()
        .ok_or_else(|| anyhow::anyhow!("empty image generation response"))?;
    let b64 = item
        .b64_json
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("no b64_json in image response"))?;

    // Decode base64 → write PNG asset
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .context("failed to decode base64 image")?;

    let asset_dir = projects_dir.join(&task.project_id).join("assets");
    tokio::fs::create_dir_all(&asset_dir).await?;

    let filename = format!("{}.png", uuid::Uuid::new_v4());
    let asset_path = asset_dir.join(&filename);
    tokio::fs::write(&asset_path, &bytes).await?;

    // Parse dimensions from size string (e.g. "2048x2048") or default
    let (width, height) = item
        .size
        .as_deref()
        .and_then(parse_dimensions)
        .unwrap_or((2048, 2048));

    let output = serde_json::json!({
        "assetPath": asset_path.to_string_lossy(),
        "width": width,
        "height": height,
    });

    let file_size = bytes.len() as i64;

    {
        let guard = db.lock().map_err(|e| anyhow::anyhow!("db lock: {e}"))?;
        guard.update_task(&task.id, "done", Some(&output.to_string()), None, None)?;

        // Record the generated asset in the assets table
        let asset = AssetRow {
            id: uuid::Uuid::new_v4().to_string(),
            project_id: task.project_id.clone(),
            task_id: Some(task.id.clone()),
            asset_type: "image".to_string(),
            file_path: asset_path.to_string_lossy().to_string(),
            file_name: filename.clone(),
            prompt: Some(prompt.to_string()),
            model: Some(model.to_string()),
            width: Some(width as i32),
            height: Some(height as i32),
            file_size: Some(file_size),
            source: "generated".to_string(),
            created_at: task.created_at.clone(),
        };
        if let Err(e) = guard.insert_asset(&asset) {
            error!(task_id = %task.id, "failed to insert asset record: {e:#}");
        }
    }

    Ok(())
}

fn parse_dimensions(size: &str) -> Option<(u32, u32)> {
    let parts: Vec<&str> = size.split('x').collect();
    if parts.len() == 2 {
        let w = parts[0].parse().ok()?;
        let h = parts[1].parse().ok()?;
        Some((w, h))
    } else {
        None
    }
}
