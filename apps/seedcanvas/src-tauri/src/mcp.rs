use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::*,
    tool, tool_handler, tool_router, ErrorData, ServerHandler,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot};

use crate::tasks::{ImageParams, TaskQueue, VideoParams};

// ---------------------------------------------------------------------------
// Canvas IPC — requests from MCP binary → Tauri app via Unix socket bridge
// ---------------------------------------------------------------------------

pub enum CanvasIpcRequest {
    Read {
        params: serde_json::Value,
        reply: oneshot::Sender<Result<String, String>>,
    },
    Batch {
        operations: serde_json::Value,
        reply: oneshot::Sender<Result<String, String>>,
    },
}

// ---------------------------------------------------------------------------
// Tool parameter schemas (derive JsonSchema for rmcp auto-schema)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, JsonSchema)]
pub struct CanvasReadParams {
    /// What to query: "all", "nodes", "edges", "selected".
    pub scope: Vec<String>,
    /// Node IDs to retrieve in detail (required when scope includes "nodes").
    #[serde(default)]
    pub node_ids: Option<Vec<String>>,
    /// Edge IDs to retrieve (required when scope includes "edges").
    #[serde(default)]
    pub edge_ids: Option<Vec<String>>,
}

/// Position on the canvas.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct CanvasPosition {
    pub x: f64,
    pub y: f64,
}

/// A single batch operation. The `op` field is the discriminator.
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum BatchOperation {
    /// Create a new canvas node.
    AddNode {
        /// Node type: "text", "image", or "video".
        #[serde(rename = "type")]
        node_type: String,
        /// Display title for the node.
        title: String,
        /// Canvas position. Defaults to viewport center if omitted.
        #[serde(default)]
        position: Option<CanvasPosition>,
        /// Initial text content (for text nodes).
        #[serde(default, rename = "initialContent")]
        initial_content: Option<String>,
        /// URL or local file path for image/video nodes.
        #[serde(default)]
        url: Option<String>,
        /// Width for image/video display.
        #[serde(default)]
        width: Option<u32>,
        /// Height for image/video display.
        #[serde(default)]
        height: Option<u32>,
        /// Temporary ref name, usable as source/target in add_edge within the same batch.
        #[serde(default, rename = "ref")]
        ref_name: Option<String>,
    },
    /// Update an existing node's title or push new content.
    UpdateNode {
        /// The ID of the node to update.
        #[serde(rename = "nodeId")]
        node_id: String,
        /// New display title.
        #[serde(default)]
        title: Option<String>,
        /// New position on canvas.
        #[serde(default)]
        position: Option<CanvasPosition>,
        /// New text content to push as a history entry.
        #[serde(default, rename = "newContent")]
        new_content: Option<String>,
        /// New image URL to push as a history entry.
        #[serde(default, rename = "newImageUrl")]
        new_image_url: Option<String>,
        /// New video URL to push as a history entry.
        #[serde(default, rename = "newVideoUrl")]
        new_video_url: Option<String>,
        /// Width for image/video display.
        #[serde(default)]
        width: Option<u32>,
        /// Height for image/video display.
        #[serde(default)]
        height: Option<u32>,
    },
    /// Delete nodes and/or edges by ID.
    Delete {
        /// Node IDs to delete.
        #[serde(default, rename = "nodeIds")]
        node_ids: Option<Vec<String>>,
        /// Edge IDs to delete.
        #[serde(default, rename = "edgeIds")]
        edge_ids: Option<Vec<String>>,
    },
    /// Connect two nodes with an edge.
    AddEdge {
        /// Source node ID or ref name from an add_node in this batch.
        source: String,
        /// Target node ID or ref name from an add_node in this batch.
        target: String,
    },
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct CanvasBatchParams {
    /// Ordered list of canvas operations to execute atomically.
    pub operations: Vec<BatchOperation>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct GenerateImageParams {
    /// Project ID to associate the generated image with.
    pub project_id: String,
    /// Text prompt describing the image to generate.
    pub prompt: String,
    /// Image model to use. Defaults to the latest Seedream model.
    #[serde(default)]
    pub model: Option<String>,
    /// Optional canvas node ID to attach the result to.
    #[serde(default)]
    pub node_id: Option<String>,
    /// Image size (e.g. "2K", "2048x2048"). Defaults to "2K".
    #[serde(default)]
    pub size: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct GenerateVideoParams {
    /// Project ID to associate the generated video with.
    pub project_id: String,
    /// Text prompt describing the video to generate.
    pub prompt: String,
    /// Video model to use. Defaults to the latest Seedance model.
    #[serde(default)]
    pub model: Option<String>,
    /// Optional canvas node ID to attach the result to.
    #[serde(default)]
    pub node_id: Option<String>,
    /// Video resolution: "480p", "720p", or "1080p". Defaults to "720p".
    #[serde(default)]
    pub resolution: Option<String>,
    /// Aspect ratio: "16:9", "9:16", "4:3", etc. Defaults to "16:9".
    #[serde(default)]
    pub ratio: Option<String>,
    /// Duration in seconds (2-12). Defaults to 5.
    #[serde(default)]
    pub duration: Option<i32>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct TaskStatusParams {
    /// The task ID to check status for.
    pub task_id: String,
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct SeedCanvasMcp {
    task_queue: Arc<TaskQueue>,
    canvas_tx: Option<mpsc::Sender<CanvasIpcRequest>>,
    tool_router: ToolRouter<Self>,
}

impl SeedCanvasMcp {
    pub fn new(
        task_queue: Arc<TaskQueue>,
        canvas_tx: Option<mpsc::Sender<CanvasIpcRequest>>,
    ) -> Self {
        Self {
            task_queue,
            canvas_tx,
            tool_router: Self::tool_router(),
        }
    }

    /// Return a reference to the canvas IPC sender, or an MCP error if the app isn't running.
    fn require_canvas_tx(&self) -> Result<&mpsc::Sender<CanvasIpcRequest>, ErrorData> {
        self.canvas_tx.as_ref().ok_or_else(|| {
            ErrorData::internal_error(
                "SeedCanvas app is not running. Please launch the desktop app first.",
                None,
            )
        })
    }
}

#[tool_router]
impl SeedCanvasMcp {
    #[tool(description = "Query the SeedCanvas canvas to get current nodes, edges, and selection state. \
        Scope options: 'all' (summary of all nodes/edges), 'nodes' (detail by IDs), \
        'edges' (by IDs), 'selected' (currently selected nodes). \
        Requires the SeedCanvas app to be running.")]
    async fn canvas_read(
        &self,
        Parameters(params): Parameters<CanvasReadParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let tx = self.require_canvas_tx()?;

        let payload = serde_json::json!({
            "scope": params.scope,
            "nodeIds": params.node_ids,
            "edgeIds": params.edge_ids,
        });

        let (reply_tx, reply_rx) = oneshot::channel();
        tx.send(CanvasIpcRequest::Read {
            params: payload,
            reply: reply_tx,
        })
        .await
        .map_err(|_| {
            ErrorData::internal_error("Failed to send request to SeedCanvas app", None)
        })?;

        let result = reply_rx.await.map_err(|_| {
            ErrorData::internal_error("SeedCanvas app did not respond", None)
        })?;

        match result {
            Ok(json) => Ok(CallToolResult::success(vec![Content::text(json)])),
            Err(e) => Ok(CallToolResult::error(vec![Content::text(e)])),
        }
    }

    #[tool(description = "Apply batch operations to the SeedCanvas canvas. \
        Operations: add_node, update_node, delete, add_edge. \
        Atomic — all succeed or all roll back. \
        Requires the SeedCanvas app to be running.")]
    async fn canvas_batch(
        &self,
        Parameters(params): Parameters<CanvasBatchParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let tx = self.require_canvas_tx()?;

        // Serialize the strongly-typed operations back to JSON Value for the frontend.
        let operations_value = serde_json::to_value(&params.operations).map_err(|e| {
            ErrorData::internal_error(format!("Failed to serialize operations: {e}"), None)
        })?;

        let (reply_tx, reply_rx) = oneshot::channel();
        tx.send(CanvasIpcRequest::Batch {
            operations: operations_value,
            reply: reply_tx,
        })
        .await
        .map_err(|_| {
            ErrorData::internal_error("Failed to send request to SeedCanvas app", None)
        })?;

        let result = reply_rx.await.map_err(|_| {
            ErrorData::internal_error("SeedCanvas app did not respond", None)
        })?;

        match result {
            Ok(json) => Ok(CallToolResult::success(vec![Content::text(json)])),
            Err(e) => Ok(CallToolResult::error(vec![Content::text(e)])),
        }
    }

    #[tool(description = "Generate an image using ByteDance Seed AI models. \
        Returns a task ID — poll with task_status until done, then place on canvas via canvas_batch. \
        Follow the Image Prompt Craft guidelines in server instructions. \
        Models: doubao-seedream-5-0-260128 (default), doubao-seedream-5-0-lite-260128, \
        doubao-seedream-4-5-251128, doubao-seedream-4-0-250828. \
        Sizes: 1K, 2K (default), 3K, 4K, or pixel dimensions like 2048x2048. \
        Requires the SeedCanvas app to be running.")]
    async fn generate_image(
        &self,
        Parameters(params): Parameters<GenerateImageParams>,
    ) -> Result<CallToolResult, ErrorData> {
        self.require_canvas_tx()?;

        let image_params = ImageParams {
            project_id: params.project_id,
            prompt: params.prompt,
            model: params.model,
            node_id: params.node_id,
            size: params.size,
        };

        match self.task_queue.submit_image(image_params) {
            Ok(task_id) => {
                let result = serde_json::json!({
                    "taskId": task_id,
                    "status": "submitted",
                    "message": "Image generation task submitted. Use task_status to check progress."
                });
                Ok(CallToolResult::success(vec![Content::text(
                    result.to_string(),
                )]))
            }
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Failed to submit image task: {e:#}"
            ))])),
        }
    }

    #[tool(description = "Generate a video using ByteDance Seed AI models. \
        Returns a task ID — poll with task_status until done (typically 1-5 min), then place on canvas via canvas_batch. \
        Follow the Video Prompt Craft guidelines in server instructions. \
        Models: doubao-seedance-1-5-pro-251215 (default), doubao-seedance-1-0-pro-250528. \
        Resolutions: 480p, 720p (default), 1080p. Ratios: 16:9 (default), 9:16, 4:3, 1:1. Duration: 2-12s. \
        Requires the SeedCanvas app to be running.")]
    async fn generate_video(
        &self,
        Parameters(params): Parameters<GenerateVideoParams>,
    ) -> Result<CallToolResult, ErrorData> {
        self.require_canvas_tx()?;

        let video_params = VideoParams {
            project_id: params.project_id,
            prompt: params.prompt,
            model: params.model,
            node_id: params.node_id,
            resolution: params.resolution,
            ratio: params.ratio,
            duration: params.duration,
        };

        match self.task_queue.submit_video(video_params) {
            Ok(task_id) => {
                let result = serde_json::json!({
                    "taskId": task_id,
                    "status": "submitted",
                    "message": "Video generation task submitted. Use task_status to check progress."
                });
                Ok(CallToolResult::success(vec![Content::text(
                    result.to_string(),
                )]))
            }
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Failed to submit video task: {e:#}"
            ))])),
        }
    }

    #[tool(description = "Check the status of a generation task (image or video). \
        Returns status (pending/running/done/failed), output details on completion, \
        or error message on failure. \
        Requires the SeedCanvas app to be running.")]
    async fn task_status(
        &self,
        Parameters(params): Parameters<TaskStatusParams>,
    ) -> Result<CallToolResult, ErrorData> {
        self.require_canvas_tx()?;

        match self.task_queue.get_task(&params.task_id) {
            Ok(Some(task)) => {
                let result = serde_json::json!({
                    "taskId": task.id,
                    "projectId": task.project_id,
                    "type": task.task_type,
                    "status": task.status,
                    "output": task.output.as_deref()
                        .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok()),
                    "error": task.error,
                    "createdAt": task.created_at,
                    "updatedAt": task.updated_at,
                });
                Ok(CallToolResult::success(vec![Content::text(
                    result.to_string(),
                )]))
            }
            Ok(None) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Task '{}' not found",
                params.task_id
            ))])),
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Failed to query task: {e:#}"
            ))])),
        }
    }
}

#[tool_handler]
impl ServerHandler for SeedCanvasMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            instructions: Some(SERVER_INSTRUCTIONS.into()),
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            ..Default::default()
        }
    }
}

// ---------------------------------------------------------------------------
// Server instructions — injected as domain knowledge for AI clients
// ---------------------------------------------------------------------------

const SERVER_INSTRUCTIONS: &str = "\
SeedCanvas MCP server — AI-powered infinite canvas for image and video generation.

# Workflow

1. **Read first**: Always call canvas_read(scope=[\"all\"]) to understand current canvas state before making changes.
2. **Generate media**: Use generate_image / generate_video to create assets. They return a taskId.
3. **Poll completion**: Call task_status with the taskId. Image takes ~10-20s, video takes 1-5min.
4. **Place on canvas**: Once done, use canvas_batch to add_node with the returned assetPath as the url field.
5. **Connect nodes**: Use add_edge in the same batch to link related nodes (e.g., source image → derived analysis).

# Canvas Layout Tips

- Space nodes ~300-400px apart to avoid overlap.
- Use canvas_read to check existing positions, then offset new nodes from them.
- Use ref names in add_node + add_edge within a single batch for atomic create-and-connect.
- Node types: \"text\" (analysis, notes), \"image\" (generated/imported images), \"video\" (generated videos).

# Image Prompt Craft — Golden Structure

Write prompts following this priority order (most important first):
Subject → Setting → Style → Lighting → Technical

Core principles:
- **Narrative first** — Drive with motion, emotion, tension. Don't stack parameters.
- **Specific > vague** — \"weathered oak table with coffee ring stains\" not \"table\".
- **Dynamic > static** — Even still scenes: describe wind, light flow, reflections.
- **Shorter is better** — If removing a phrase doesn't collapse the image, remove it.
- **Material = visual** — \"brushed stainless steel catching light\" not \"metal surface\".
- **Color = precise** — \"crimson\" / \"cobalt\" / \"emerald\" not \"red\" / \"blue\" / \"green\".
- **No quality tails** — Never append \"masterpiece, best quality, ultra-detailed\".
- **Trust the model** — Common scenes don't need exhaustive description.

Style keywords quick reference:
- Photography: cinematic, editorial portrait, documentary, shot on Kodak Portra 400
- Painting: oil painting impasto, watercolor wet-on-wet, digital painting
- 3D: photorealistic Unreal Engine, Pixar style clay render, isometric low poly
- Mood: film noir, golden hour, blue hour, Rembrandt lighting, rim light

Composition: rule of thirds, centered symmetrical, diagonal, leading lines, negative space, frame within frame.

Common pitfalls: hands (keep simple — holding, resting), multiple people (max 2-3, separate by clothing color), text (short uppercase English in quotes).

# Video Prompt Craft — Universal Formula

Subject + Action + Scene + Lighting + Camera + Style + Quality tags + Constraints

Priority: left to right, decreasing weight. Subject and action matter most.

Hard constraints:
- Character stability: append \"五官清晰，面部稳定，不扭曲\" for people; multi-shot add \"同一角色，服装一致\".
- Quality tags: append \"4K，超高清，细节丰富，锐度清晰，电影质感\" (anime: \"线条锐利，影院级渲染\").
- Each prompt ≤ 1000 chars.
- No negation words — only describe what IS in the frame.
- Prefer slow continuous motion (缓缓、轻轻、渐渐); split violent action into slow-mo multi-shots.
- Use composition for spatial layout (画面左侧/右侧/前景/背景), not orientation (面对面/背靠背).
- Avoid complex multi-person interaction (2+ people precise interaction fails easily).

Camera reliability matrix:
- Safe: push/pull + any shot size, slow-mo + any, orbit + medium shot
- Risky: close-up + pan (no content), extreme wide + orbit (no focus), close-up + tracking (no space)

Type profiles:
- Anime: fast-cut + slow-mo alternating, cel shading, impact frames
- Cinematic: long takes, medium-close shots, shallow DoF, film grain
- Product: steady rotation → macro detail → function demo → brand freeze
- Documentary: aerial → local → macro → time-lapse → aerial return
- MV: cut on beat, flash transitions on accent, jump cuts for compression
";


// ---------------------------------------------------------------------------
// Tests — verify BatchOperation serde matches frontend BatchOp format
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Serialize → JSON Value, assert key fields match what the frontend expects.
    fn ser(op: &BatchOperation) -> serde_json::Value {
        serde_json::to_value(op).expect("serialize")
    }

    /// Deserialize a JSON string into BatchOperation.
    fn de(json: &str) -> BatchOperation {
        serde_json::from_str(json).expect("deserialize")
    }

    // -- add_node ----------------------------------------------------------

    #[test]
    fn add_node_serializes_with_correct_op_tag() {
        let op = BatchOperation::AddNode {
            node_type: "image".into(),
            title: "Cat".into(),
            position: Some(CanvasPosition { x: 10.0, y: 20.0 }),
            initial_content: None,
            url: Some("/path/to/img.png".into()),
            width: Some(400),
            height: Some(300),
            ref_name: Some("myRef".into()),
        };

        let v = ser(&op);
        assert_eq!(v["op"], "add_node");
        assert_eq!(v["type"], "image");
        assert_eq!(v["title"], "Cat");
        assert_eq!(v["position"]["x"], 10.0);
        assert_eq!(v["position"]["y"], 20.0);
        assert_eq!(v["url"], "/path/to/img.png");
        assert_eq!(v["width"], 400);
        assert_eq!(v["height"], 300);
        assert_eq!(v["ref"], "myRef");
    }

    #[test]
    fn add_node_deserializes_from_frontend_format() {
        let json = r#"{
            "op": "add_node",
            "type": "text",
            "title": "Note",
            "initialContent": "hello"
        }"#;
        let op = de(json);
        match op {
            BatchOperation::AddNode {
                node_type, title, initial_content, ..
            } => {
                assert_eq!(node_type, "text");
                assert_eq!(title, "Note");
                assert_eq!(initial_content.as_deref(), Some("hello"));
            }
            _ => panic!("expected AddNode"),
        }
    }

    #[test]
    fn add_node_optional_fields_default_to_none() {
        let json = r#"{"op":"add_node","type":"video","title":"Clip"}"#;
        let op = de(json);
        match op {
            BatchOperation::AddNode {
                position,
                initial_content,
                url,
                width,
                height,
                ref_name,
                ..
            } => {
                assert!(position.is_none());
                assert!(initial_content.is_none());
                assert!(url.is_none());
                assert!(width.is_none());
                assert!(height.is_none());
                assert!(ref_name.is_none());
            }
            _ => panic!("expected AddNode"),
        }
    }

    // -- update_node -------------------------------------------------------

    #[test]
    fn update_node_round_trip() {
        let json = r#"{
            "op": "update_node",
            "nodeId": "abc-123",
            "title": "New Title",
            "newContent": "updated text"
        }"#;
        let op = de(json);
        let v = ser(&op);
        assert_eq!(v["op"], "update_node");
        assert_eq!(v["nodeId"], "abc-123");
        assert_eq!(v["title"], "New Title");
        assert_eq!(v["newContent"], "updated text");
    }

    #[test]
    fn update_node_image_and_video_urls() {
        let op = BatchOperation::UpdateNode {
            node_id: "n1".into(),
            title: None,
            position: None,
            new_content: None,
            new_image_url: Some("http://img.png".into()),
            new_video_url: Some("http://vid.mp4".into()),
            width: None,
            height: None,
        };
        let v = ser(&op);
        assert_eq!(v["newImageUrl"], "http://img.png");
        assert_eq!(v["newVideoUrl"], "http://vid.mp4");
    }

    // -- delete ------------------------------------------------------------

    #[test]
    fn delete_round_trip() {
        let json = r#"{
            "op": "delete",
            "nodeIds": ["n1", "n2"],
            "edgeIds": ["e1"]
        }"#;
        let op = de(json);
        let v = ser(&op);
        assert_eq!(v["op"], "delete");
        assert_eq!(v["nodeIds"], serde_json::json!(["n1", "n2"]));
        assert_eq!(v["edgeIds"], serde_json::json!(["e1"]));
    }

    #[test]
    fn delete_empty_arrays_default() {
        let json = r#"{"op":"delete"}"#;
        let op = de(json);
        match op {
            BatchOperation::Delete { node_ids, edge_ids } => {
                assert!(node_ids.is_none());
                assert!(edge_ids.is_none());
            }
            _ => panic!("expected Delete"),
        }
    }

    // -- add_edge ----------------------------------------------------------

    #[test]
    fn add_edge_round_trip() {
        let json = r#"{"op":"add_edge","source":"n1","target":"myRef"}"#;
        let op = de(json);
        let v = ser(&op);
        assert_eq!(v["op"], "add_edge");
        assert_eq!(v["source"], "n1");
        assert_eq!(v["target"], "myRef");
    }

    // -- batch params (array) ----------------------------------------------

    #[test]
    fn batch_params_deserializes_mixed_operations() {
        let json = r#"{
            "operations": [
                {"op":"add_node","type":"image","title":"Img","url":"/img.png","width":100,"height":100},
                {"op":"add_edge","source":"n1","target":"n2"},
                {"op":"delete","nodeIds":["n3"]}
            ]
        }"#;
        let params: CanvasBatchParams = serde_json::from_str(json).expect("deserialize batch");
        assert_eq!(params.operations.len(), 3);
        assert!(matches!(params.operations[0], BatchOperation::AddNode { .. }));
        assert!(matches!(params.operations[1], BatchOperation::AddEdge { .. }));
        assert!(matches!(params.operations[2], BatchOperation::Delete { .. }));
    }

    #[test]
    fn batch_params_rejects_unknown_op() {
        let json = r#"{"operations":[{"op":"unknown_op","foo":"bar"}]}"#;
        let result: Result<CanvasBatchParams, _> = serde_json::from_str(json);
        assert!(result.is_err(), "should reject unknown op variant");
    }

    // -- serialize round-trip: ensure frontend can consume our output -------

    #[test]
    fn full_round_trip_preserves_all_fields() {
        let original = vec![
            BatchOperation::AddNode {
                node_type: "image".into(),
                title: "Sunset Cat".into(),
                position: Some(CanvasPosition { x: -200.0, y: 58.5 }),
                initial_content: None,
                url: Some("/assets/cat.png".into()),
                width: Some(400),
                height: Some(400),
                ref_name: Some("cat".into()),
            },
            BatchOperation::AddEdge {
                source: "cat".into(),
                target: "existing-node".into(),
            },
        ];

        let json = serde_json::to_string(&original).unwrap();
        let restored: Vec<BatchOperation> = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.len(), 2);

        // Verify the JSON array can be parsed by frontend (op-based discriminator)
        let arr: Vec<serde_json::Value> = serde_json::from_str(&json).unwrap();
        assert_eq!(arr[0]["op"], "add_node");
        assert_eq!(arr[0]["type"], "image");
        assert_eq!(arr[0]["ref"], "cat");
        assert_eq!(arr[1]["op"], "add_edge");
        assert_eq!(arr[1]["source"], "cat");
    }
}
