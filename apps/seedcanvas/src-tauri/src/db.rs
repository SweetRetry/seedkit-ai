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
// Chat row models
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSessionRow {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageRow {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub reasoning: Option<String>,
    pub tool_calls: Option<String>,
    pub created_at: String,
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

            CREATE TABLE IF NOT EXISTS chat_sessions (
                id          TEXT PRIMARY KEY,
                project_id  TEXT NOT NULL,
                title       TEXT NOT NULL DEFAULT 'New Chat',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_chat_sessions_project ON chat_sessions(project_id);

            CREATE TABLE IF NOT EXISTS chat_messages (
                id          TEXT PRIMARY KEY,
                session_id  TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
                role        TEXT NOT NULL,
                content     TEXT NOT NULL DEFAULT '',
                reasoning   TEXT,
                tool_calls  TEXT,
                created_at  TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);",
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
    // Chat session CRUD
    // -------------------------------------------------------------------

    pub fn create_chat_session(&self, id: &str, project_id: &str, title: &str) -> Result<ChatSessionRow> {
        let now = chrono::Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT INTO chat_sessions (id, project_id, title, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, project_id, title, now, now],
        )?;
        Ok(ChatSessionRow {
            id: id.to_string(),
            project_id: project_id.to_string(),
            title: title.to_string(),
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn list_chat_sessions(&self, project_id: &str) -> Result<Vec<ChatSessionRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, project_id, title, created_at, updated_at
             FROM chat_sessions WHERE project_id=?1 ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map(params![project_id], row_to_chat_session)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .context("failed to collect chat sessions")
    }

    pub fn update_chat_session_title(&self, session_id: &str, title: &str) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.conn.execute(
            "UPDATE chat_sessions SET title=?2, updated_at=?3 WHERE id=?1",
            params![session_id, title, now],
        )?;
        Ok(())
    }

    pub fn touch_chat_session(&self, session_id: &str) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.conn.execute(
            "UPDATE chat_sessions SET updated_at=?2 WHERE id=?1",
            params![session_id, now],
        )?;
        Ok(())
    }

    pub fn delete_chat_session(&self, session_id: &str) -> Result<()> {
        // Messages are deleted via ON DELETE CASCADE
        self.conn.execute(
            "DELETE FROM chat_sessions WHERE id=?1",
            params![session_id],
        )?;
        Ok(())
    }

    // -------------------------------------------------------------------
    // Chat message CRUD
    // -------------------------------------------------------------------

    pub fn insert_chat_message(&self, msg: &ChatMessageRow) -> Result<()> {
        self.conn.execute(
            "INSERT INTO chat_messages (id, session_id, role, content, reasoning, tool_calls, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                msg.id,
                msg.session_id,
                msg.role,
                msg.content,
                msg.reasoning,
                msg.tool_calls,
                msg.created_at,
            ],
        )?;
        Ok(())
    }

    pub fn get_chat_messages(&self, session_id: &str) -> Result<Vec<ChatMessageRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, session_id, role, content, reasoning, tool_calls, created_at
             FROM chat_messages WHERE session_id=?1 ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![session_id], row_to_chat_message)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .context("failed to collect chat messages")
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

fn row_to_chat_session(row: &rusqlite::Row) -> rusqlite::Result<ChatSessionRow> {
    Ok(ChatSessionRow {
        id: row.get(0)?,
        project_id: row.get(1)?,
        title: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

fn row_to_chat_message(row: &rusqlite::Row) -> rusqlite::Result<ChatMessageRow> {
    Ok(ChatMessageRow {
        id: row.get(0)?,
        session_id: row.get(1)?,
        role: row.get(2)?,
        content: row.get(3)?,
        reasoning: row.get(4)?,
        tool_calls: row.get(5)?,
        created_at: row.get(6)?,
    })
}
