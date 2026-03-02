use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, Mutex};

/// Thread-safe database handle. rusqlite::Connection is !Sync,
/// so we wrap Db in a Mutex for cross-thread access.
pub type SharedDb = Arc<Mutex<Db>>;

// ---------------------------------------------------------------------------
// Task row model
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskRow {
    pub id: String,
    pub project_id: String,
    #[serde(rename = "type")]
    pub task_type: String, // "image" | "video"
    pub status: String,    // "pending" | "running" | "done" | "failed"
    pub input: String,     // JSON
    pub output: Option<String>,
    pub ark_task_id: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// ---------------------------------------------------------------------------
// Asset row model
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetRow {
    pub id: String,
    pub project_id: String,
    pub task_id: Option<String>,
    #[serde(rename = "type")]
    pub asset_type: String, // "image" | "video"
    pub file_path: String,
    pub file_name: String,
    pub prompt: Option<String>,
    pub model: Option<String>,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub file_size: Option<i64>,
    pub source: String, // "generated" | "imported"
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetStats {
    pub total: i64,
    pub images: i64,
    pub videos: i64,
    pub total_size: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageStats {
    pub total_tasks: i64,
    pub images_generated: i64,
    pub videos_generated: i64,
    pub succeeded: i64,
    pub failed: i64,
    pub daily_counts: Vec<DailyCount>,
    pub recent_tasks: Vec<TaskRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyCount {
    pub date: String,
    pub count: i64,
}

// ---------------------------------------------------------------------------
// Database wrapper
// ---------------------------------------------------------------------------

pub struct Db {
    conn: Connection,
}

impl Db {
    /// Open (or create) the database at `path` and run migrations.
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path).context("failed to open SQLite database")?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        let db = Db { conn };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<()> {
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS tasks (
                id          TEXT PRIMARY KEY,
                project_id  TEXT NOT NULL,
                type        TEXT NOT NULL,
                status      TEXT NOT NULL DEFAULT 'pending',
                input       TEXT NOT NULL,
                output      TEXT,
                ark_task_id TEXT,
                error       TEXT,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
            CREATE INDEX IF NOT EXISTS idx_tasks_status  ON tasks(status);

            CREATE TABLE IF NOT EXISTS assets (
                id          TEXT PRIMARY KEY,
                project_id  TEXT NOT NULL,
                task_id     TEXT,
                type        TEXT NOT NULL,
                file_path   TEXT NOT NULL,
                file_name   TEXT NOT NULL,
                prompt      TEXT,
                model       TEXT,
                width       INTEGER,
                height      INTEGER,
                file_size   INTEGER,
                source      TEXT NOT NULL DEFAULT 'generated',
                created_at  TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id);
            CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(type);
            CREATE INDEX IF NOT EXISTS idx_assets_created_at ON assets(created_at);
            CREATE INDEX IF NOT EXISTS idx_assets_task_id ON assets(task_id);

            -- Legacy: chat tables unused since Phase 3 (MCP architecture).
            -- Drop if they exist from older DB files.
            DROP TABLE IF EXISTS chat_messages;
            DROP TABLE IF EXISTS chat_sessions;",
        )?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // CRUD
    // -----------------------------------------------------------------------

    pub fn insert_task(&self, task: &TaskRow) -> Result<()> {
        self.conn.execute(
            "INSERT INTO tasks (id, project_id, type, status, input, output, ark_task_id, error, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                task.id,
                task.project_id,
                task.task_type,
                task.status,
                task.input,
                task.output,
                task.ark_task_id,
                task.error,
                task.created_at,
                task.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn update_task(
        &self,
        id: &str,
        status: &str,
        output: Option<&str>,
        ark_task_id: Option<&str>,
        error: Option<&str>,
    ) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.conn.execute(
            "UPDATE tasks SET status=?2, output=?3, ark_task_id=?4, error=?5, updated_at=?6 WHERE id=?1",
            params![id, status, output, ark_task_id, error, now],
        )?;
        Ok(())
    }

    pub fn get_task(&self, id: &str) -> Result<Option<TaskRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, type, status, input, output, ark_task_id, error, created_at, updated_at FROM tasks WHERE id=?1",
        )?;
        let mut rows = stmt.query_map(params![id], row_to_task)?;
        Ok(rows.next().transpose()?)
    }

    pub fn get_running_tasks(&self) -> Result<Vec<TaskRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, type, status, input, output, ark_task_id, error, created_at, updated_at FROM tasks WHERE status='running'",
        )?;
        let rows = stmt.query_map([], row_to_task)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .context("failed to collect running tasks")
    }

    #[allow(dead_code)] // Used in Phase 4b (MCP server)
    pub fn get_tasks_by_project(&self, project_id: &str) -> Result<Vec<TaskRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, type, status, input, output, ark_task_id, error, created_at, updated_at FROM tasks WHERE project_id=?1 ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![project_id], row_to_task)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .context("failed to collect project tasks")
    }

    // -------------------------------------------------------------------
    // Asset CRUD
    // -------------------------------------------------------------------

    pub fn insert_asset(&self, asset: &AssetRow) -> Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO assets (id, project_id, task_id, type, file_path, file_name, prompt, model, width, height, file_size, source, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                asset.id,
                asset.project_id,
                asset.task_id,
                asset.asset_type,
                asset.file_path,
                asset.file_name,
                asset.prompt,
                asset.model,
                asset.width,
                asset.height,
                asset.file_size,
                asset.source,
                asset.created_at,
            ],
        )?;
        Ok(())
    }

    pub fn list_assets(
        &self,
        project_id: Option<&str>,
        asset_type: Option<&str>,
        query: Option<&str>,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<AssetRow>> {
        let mut sql = String::from(
            "SELECT id, project_id, task_id, type, file_path, file_name, prompt, model, width, height, file_size, source, created_at FROM assets WHERE 1=1"
        );
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(pid) = project_id {
            param_values.push(Box::new(pid.to_string()));
            sql.push_str(&format!(" AND project_id=?{}", param_values.len()));
        }
        if let Some(atype) = asset_type {
            param_values.push(Box::new(atype.to_string()));
            sql.push_str(&format!(" AND type=?{}", param_values.len()));
        }
        if let Some(q) = query {
            param_values.push(Box::new(format!("%{q}%")));
            sql.push_str(&format!(" AND prompt LIKE ?{}", param_values.len()));
        }

        param_values.push(Box::new(limit as i64));
        sql.push_str(&format!(" ORDER BY created_at DESC LIMIT ?{}", param_values.len()));
        param_values.push(Box::new(offset as i64));
        sql.push_str(&format!(" OFFSET ?{}", param_values.len()));

        let mut stmt = self.conn.prepare(&sql)?;
        let params_ref: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
        let rows = stmt.query_map(params_ref.as_slice(), row_to_asset)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .context("failed to collect assets")
    }

    pub fn get_asset_stats(&self) -> Result<AssetStats> {
        let total: i64 = self.conn.query_row("SELECT COUNT(*) FROM assets", [], |r| r.get(0))?;
        let images: i64 = self.conn.query_row("SELECT COUNT(*) FROM assets WHERE type='image'", [], |r| r.get(0))?;
        let videos: i64 = self.conn.query_row("SELECT COUNT(*) FROM assets WHERE type='video'", [], |r| r.get(0))?;
        let total_size: i64 = self.conn.query_row("SELECT COALESCE(SUM(file_size), 0) FROM assets", [], |r| r.get(0))?;
        Ok(AssetStats { total, images, videos, total_size })
    }

    pub fn delete_assets_by_project(&self, project_id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM assets WHERE project_id=?1", params![project_id])?;
        Ok(())
    }

    pub fn delete_tasks_by_project(&self, project_id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM tasks WHERE project_id=?1", params![project_id])?;
        Ok(())
    }

    /// Check whether any tasks exist for a given project_id (used to validate project existence).
    /// Since projects are file-based, we check the filesystem — this method checks DB-side only.
    pub fn has_tasks_for_project(&self, project_id: &str) -> Result<bool> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM tasks WHERE project_id=?1",
            params![project_id],
            |r| r.get(0),
        )?;
        Ok(count > 0)
    }

    /// Delete all SQLite data associated with a project (tasks + assets).
    pub fn delete_all_project_data(&self, project_id: &str) -> Result<()> {
        self.delete_assets_by_project(project_id)?;
        self.delete_tasks_by_project(project_id)?;
        Ok(())
    }

    /// Backfill asset rows from existing done tasks that don't already have an asset record.
    pub fn backfill_assets_from_tasks(&self) -> Result<usize> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, type, input, output, created_at FROM tasks
             WHERE status='done' AND output IS NOT NULL
             AND id NOT IN (SELECT task_id FROM assets WHERE task_id IS NOT NULL)"
        )?;

        let tasks: Vec<(String, String, String, String, String, String)> = stmt
            .query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        let mut count = 0usize;
        for (task_id, project_id, task_type, input_json, output_json, created_at) in &tasks {
            let input: serde_json::Value = serde_json::from_str(input_json).unwrap_or_default();
            let output: serde_json::Value = serde_json::from_str(output_json).unwrap_or_default();

            let asset_path = match output["assetPath"].as_str() {
                Some(p) => p,
                None => continue,
            };
            let file_name = std::path::Path::new(asset_path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string();

            let width = output["width"].as_i64().map(|v| v as i32);
            let height = output["height"].as_i64().map(|v| v as i32);

            // Try to get file size from disk
            let file_size = std::fs::metadata(asset_path).ok().map(|m| m.len() as i64);

            let asset = AssetRow {
                id: uuid::Uuid::new_v4().to_string(),
                project_id: project_id.clone(),
                task_id: Some(task_id.clone()),
                asset_type: task_type.clone(),
                file_path: asset_path.to_string(),
                file_name,
                prompt: input["prompt"].as_str().map(String::from),
                model: input["model"].as_str().map(String::from),
                width,
                height,
                file_size,
                source: "generated".to_string(),
                created_at: created_at.clone(),
            };

            self.insert_asset(&asset)?;
            count += 1;
        }

        Ok(count)
    }

    // -------------------------------------------------------------------
    // Usage stats
    // -------------------------------------------------------------------

    pub fn get_usage_stats(&self) -> Result<UsageStats> {
        let total_tasks: i64 = self.conn.query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))?;
        let images_generated: i64 = self.conn.query_row("SELECT COUNT(*) FROM tasks WHERE type='image'", [], |r| r.get(0))?;
        let videos_generated: i64 = self.conn.query_row("SELECT COUNT(*) FROM tasks WHERE type='video'", [], |r| r.get(0))?;
        let succeeded: i64 = self.conn.query_row("SELECT COUNT(*) FROM tasks WHERE status='done'", [], |r| r.get(0))?;
        let failed: i64 = self.conn.query_row("SELECT COUNT(*) FROM tasks WHERE status='failed'", [], |r| r.get(0))?;

        // Daily counts for last 30 days
        let mut daily_stmt = self.conn.prepare(
            "SELECT DATE(created_at) as d, COUNT(*) as c FROM tasks
             WHERE created_at >= DATE('now', '-30 days')
             GROUP BY d ORDER BY d ASC"
        )?;
        let daily_counts = daily_stmt
            .query_map([], |row| {
                Ok(DailyCount {
                    date: row.get(0)?,
                    count: row.get(1)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()
            .context("failed to collect daily counts")?;

        // Recent 20 tasks
        let mut recent_stmt = self.conn.prepare(
            "SELECT id, project_id, type, status, input, output, ark_task_id, error, created_at, updated_at
             FROM tasks ORDER BY created_at DESC LIMIT 20"
        )?;
        let recent_tasks = recent_stmt
            .query_map([], row_to_task)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .context("failed to collect recent tasks")?;

        Ok(UsageStats {
            total_tasks,
            images_generated,
            videos_generated,
            succeeded,
            failed,
            daily_counts,
            recent_tasks,
        })
    }
}

fn row_to_task(row: &rusqlite::Row) -> rusqlite::Result<TaskRow> {
    Ok(TaskRow {
        id: row.get(0)?,
        project_id: row.get(1)?,
        task_type: row.get(2)?,
        status: row.get(3)?,
        input: row.get(4)?,
        output: row.get(5)?,
        ark_task_id: row.get(6)?,
        error: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn row_to_asset(row: &rusqlite::Row) -> rusqlite::Result<AssetRow> {
    Ok(AssetRow {
        id: row.get(0)?,
        project_id: row.get(1)?,
        task_id: row.get(2)?,
        asset_type: row.get(3)?,
        file_path: row.get(4)?,
        file_name: row.get(5)?,
        prompt: row.get(6)?,
        model: row.get(7)?,
        width: row.get(8)?,
        height: row.get(9)?,
        file_size: row.get(10)?,
        source: row.get(11)?,
        created_at: row.get(12)?,
    })
}
