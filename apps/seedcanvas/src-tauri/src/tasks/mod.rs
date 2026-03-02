pub mod image;
pub mod video;

use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tracing::{error, info};

use crate::ark::ArkClient;
use crate::db::{Db, SharedDb, TaskRow};

/// Callback invoked when a task completes (used in headless mode to notify the frontend
/// via the Unix socket bridge instead of Tauri events).
pub type OnCompleteCallback = Arc<dyn Fn(TaskRow) + Send + Sync>;

// ---------------------------------------------------------------------------
// Valid values — single source of truth for Tauri commands AND future MCP tools
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Valid values — single source of truth, aligned with ARK API docs.
// Ref: apps/docs/raw/image_gen/index.md, apps/docs/raw/video_gen/index.md
// ---------------------------------------------------------------------------

pub const IMAGE_MODELS: &[&str] = &[
    "doubao-seedream-5-0-260128",
    "doubao-seedream-5-0-lite-260128",
    "doubao-seedream-4-5-251128",
    "doubao-seedream-4-0-250828",
];

/// Image sizes — tier strings ("2K") AND recommended pixel dimensions.
pub const IMAGE_SIZES: &[&str] = &[
    // Tier strings
    "1K", "2K", "3K", "4K",
    // Common 2K pixel values (all models)
    "2048x2048", "1728x2304", "2304x1728",
    "2848x1600", "1600x2848",
    "2496x1664", "1664x2496",
    "3136x1344",
    // 1K (Seedream 4.0 only)
    "1024x1024", "864x1152", "1152x864",
    "1312x736", "736x1312", "832x1248", "1248x832", "1568x672",
    // 3K (Seedream 5.0 lite only)
    "3072x3072", "2592x3456", "3456x2592",
    "4096x2304", "2304x4096", "2496x3744", "3744x2496", "4704x2016",
    // 4K (Seedream 4.5 / 4.0)
    "4096x4096", "3520x4704", "4704x3520",
    "5504x3040", "3040x5504", "3328x4992", "4992x3328", "6240x2656",
];

pub const VIDEO_MODELS: &[&str] = &[
    "doubao-seedance-1-5-pro-251215",
    "doubao-seedance-1-0-pro-250528",
    "doubao-seedance-1-0-pro-fast-251015",
    "doubao-seedance-1-0-lite-t2v-250428",
    "doubao-seedance-1-0-lite-i2v-250428",
];

pub const VIDEO_RESOLUTIONS: &[&str] = &["480p", "720p", "1080p"];
pub const VIDEO_RATIOS: &[&str] = &["16:9", "9:16", "4:3", "3:4", "1:1", "21:9", "adaptive"];

pub const DEFAULT_IMAGE_MODEL: &str = "doubao-seedream-5-0-260128";
pub const DEFAULT_IMAGE_SIZE: &str = "2K";
pub const DEFAULT_VIDEO_MODEL: &str = "doubao-seedance-1-5-pro-251215";
pub const DEFAULT_VIDEO_RESOLUTION: &str = "720p";
pub const DEFAULT_VIDEO_RATIO: &str = "16:9";
pub const DEFAULT_VIDEO_DURATION: i32 = 5;

// ---------------------------------------------------------------------------
// Submit parameters — with validation + defaults
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageParams {
    pub project_id: String,
    pub prompt: String,
    pub model: Option<String>,
    pub node_id: Option<String>,
    pub size: Option<String>,
}

impl ImageParams {
    /// Apply defaults and validate. Called before enqueueing.
    pub fn normalize(&mut self) -> Result<()> {
        if self.prompt.trim().is_empty() {
            bail!("prompt must not be empty");
        }
        let model = self.model.get_or_insert_with(|| DEFAULT_IMAGE_MODEL.into());
        if !IMAGE_MODELS.contains(&model.as_str()) {
            bail!("invalid image model \"{model}\". Valid: {}", IMAGE_MODELS.join(", "));
        }
        let size = self.size.get_or_insert_with(|| DEFAULT_IMAGE_SIZE.into());
        if !IMAGE_SIZES.contains(&size.as_str()) {
            bail!("invalid image size \"{size}\". Valid: {}", IMAGE_SIZES.join(", "));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoParams {
    pub project_id: String,
    pub prompt: String,
    pub model: Option<String>,
    pub node_id: Option<String>,
    pub resolution: Option<String>,
    pub ratio: Option<String>,
    pub duration: Option<i32>,
}

impl VideoParams {
    /// Apply defaults and validate. Called before enqueueing.
    pub fn normalize(&mut self) -> Result<()> {
        if self.prompt.trim().is_empty() {
            bail!("prompt must not be empty");
        }
        let model = self.model.get_or_insert_with(|| DEFAULT_VIDEO_MODEL.into());
        if !VIDEO_MODELS.contains(&model.as_str()) {
            bail!("invalid video model \"{model}\". Valid: {}", VIDEO_MODELS.join(", "));
        }
        let res = self.resolution.get_or_insert_with(|| DEFAULT_VIDEO_RESOLUTION.into());
        if !VIDEO_RESOLUTIONS.contains(&res.as_str()) {
            bail!("invalid resolution \"{res}\". Valid: {}", VIDEO_RESOLUTIONS.join(", "));
        }
        let ratio = self.ratio.get_or_insert_with(|| DEFAULT_VIDEO_RATIO.into());
        if !VIDEO_RATIOS.contains(&ratio.as_str()) {
            bail!("invalid ratio \"{ratio}\". Valid: {}", VIDEO_RATIOS.join(", "));
        }
        let dur = self.duration.get_or_insert(DEFAULT_VIDEO_DURATION);
        if !(2..=12).contains(dur) {
            bail!("duration must be 2-12 seconds, got {dur}");
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// TaskQueue — owns Db + ArkClient, spawns async work
// ---------------------------------------------------------------------------

pub struct TaskQueue {
    db: SharedDb,
    ark: Arc<ArkClient>,
    app_handle: Option<AppHandle>,
    projects_dir: PathBuf,
    on_complete: Option<OnCompleteCallback>,
}

impl TaskQueue {
    /// Create a TaskQueue with a Tauri AppHandle (normal app mode).
    pub fn new(db: Db, ark: ArkClient, app_handle: AppHandle, projects_dir: PathBuf) -> Self {
        Self {
            db: Arc::new(std::sync::Mutex::new(db)),
            ark: Arc::new(ark),
            app_handle: Some(app_handle),
            projects_dir,
            on_complete: None,
        }
    }

    /// Create a TaskQueue without a Tauri AppHandle (headless MCP mode).
    pub fn new_headless(db: Db, ark: ArkClient, projects_dir: PathBuf) -> Self {
        Self {
            db: Arc::new(std::sync::Mutex::new(db)),
            ark: Arc::new(ark),
            app_handle: None,
            projects_dir,
            on_complete: None,
        }
    }

    /// Create a TaskQueue with a pre-wrapped SharedDb (used when DB is shared across subsystems).
    pub fn new_with_shared(db: SharedDb, ark: ArkClient, app_handle: AppHandle, projects_dir: PathBuf) -> Self {
        Self {
            db,
            ark: Arc::new(ark),
            app_handle: Some(app_handle),
            projects_dir,
            on_complete: None,
        }
    }

    /// Register a callback for task completion (headless mode).
    /// Called after a task finishes with the updated TaskRow.
    pub fn set_on_complete(&mut self, cb: OnCompleteCallback) {
        self.on_complete = Some(cb);
    }

    /// Submit an image generation task. Returns the task ID immediately.
    pub fn submit_image(&self, mut params: ImageParams) -> Result<String> {
        params.normalize()?;
        let project_id = params.project_id.clone();
        let task = self.create_task_row(&project_id, "image", &params)?;
        let task_id = task.id.clone();
        self.emit_submitted(&task_id, &project_id, "image");
        self.spawn_image(task);
        Ok(task_id)
    }

    /// Submit a video generation task. Returns the task ID immediately.
    pub fn submit_video(&self, mut params: VideoParams) -> Result<String> {
        params.normalize()?;
        let project_id = params.project_id.clone();
        let task = self.create_task_row(&project_id, "video", &params)?;
        let task_id = task.id.clone();
        self.emit_submitted(&task_id, &project_id, "video");
        self.spawn_video(task);
        Ok(task_id)
    }

    /// Get a task by ID.
    pub fn get_task(&self, task_id: &str) -> Result<Option<TaskRow>> {
        let db = self.db.lock().map_err(|e| anyhow::anyhow!("db lock poisoned: {e}"))?;
        db.get_task(task_id)
    }

    /// Resume any tasks that were left in "running" state (e.g. after app restart).
    pub fn resume_running_tasks(&self) -> Result<()> {
        let running = {
            let db = self.db.lock().map_err(|e| anyhow::anyhow!("db lock poisoned: {e}"))?;
            db.get_running_tasks()?
        };
        if running.is_empty() {
            return Ok(());
        }
        info!(count = running.len(), "resuming running tasks");
        for task in running {
            match task.task_type.as_str() {
                "image" => self.spawn_image(task),
                "video" => self.spawn_video(task),
                other => {
                    error!(task_type = %other, task_id = %task.id, "unknown task type during resume");
                }
            }
        }
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------------

    fn emit_submitted(&self, task_id: &str, project_id: &str, task_type: &str) {
        if let Some(ref handle) = self.app_handle {
            let _ = handle.emit("task:submitted", serde_json::json!({
                "taskId": task_id,
                "projectId": project_id,
                "type": task_type,
            }));
        }
    }

    fn create_task_row<T: Serialize>(
        &self,
        project_id: &str,
        task_type: &str,
        params: &T,
    ) -> Result<TaskRow> {
        let now = chrono::Utc::now().to_rfc3339();
        let task = TaskRow {
            id: uuid::Uuid::new_v4().to_string(),
            project_id: project_id.to_string(),
            task_type: task_type.to_string(),
            status: "pending".to_string(),
            input: serde_json::to_string(params)?,
            output: None,
            ark_task_id: None,
            error: None,
            created_at: now.clone(),
            updated_at: now,
        };
        let db = self.db.lock().map_err(|e| anyhow::anyhow!("db lock poisoned: {e}"))?;
        db.insert_task(&task)?;
        Ok(task)
    }

    fn spawn_image(&self, task: TaskRow) {
        let db = Arc::clone(&self.db);
        let ark = Arc::clone(&self.ark);
        let app_handle = self.app_handle.clone();
        let on_complete = self.on_complete.clone();
        let projects_dir = self.projects_dir.clone();

        tokio::spawn(async move {
            image::run_image_task(&db, &ark, &app_handle, &task, &projects_dir).await;
            let updated = db.lock().ok().and_then(|g| g.get_task(&task.id).ok().flatten());
            if let Some(ref updated) = updated {
                // Tauri app mode: emit event to frontend
                if let Some(ref handle) = app_handle {
                    let _ = handle.emit("task:complete", task_complete_payload(updated));
                }
                // Headless mode: invoke callback (e.g. push via socket bridge)
                if let Some(ref cb) = on_complete {
                    cb(updated.clone());
                }
            }
        });
    }

    fn spawn_video(&self, task: TaskRow) {
        let db = Arc::clone(&self.db);
        let ark = Arc::clone(&self.ark);
        let app_handle = self.app_handle.clone();
        let on_complete = self.on_complete.clone();
        let projects_dir = self.projects_dir.clone();

        tokio::spawn(async move {
            video::run_video_task(&db, &ark, &app_handle, &task, &projects_dir).await;
            let updated = db.lock().ok().and_then(|g| g.get_task(&task.id).ok().flatten());
            if let Some(ref updated) = updated {
                if let Some(ref handle) = app_handle {
                    let _ = handle.emit("task:complete", task_complete_payload(updated));
                }
                if let Some(ref cb) = on_complete {
                    cb(updated.clone());
                }
            }
        });
    }
}

fn task_complete_payload(task: &TaskRow) -> serde_json::Value {
    serde_json::json!({
        "taskId": task.id,
        "projectId": task.project_id,
        "type": task.task_type,
        "status": task.status,
        "output": task.output.as_deref().and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok()),
        "error": task.error,
        "nodeId": serde_json::from_str::<serde_json::Value>(&task.input)
            .ok()
            .and_then(|v| v["node_id"].as_str().map(String::from)),
    })
}
