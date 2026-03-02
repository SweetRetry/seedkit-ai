use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Image generation
// POST {baseURL}/images/generations
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct ImageGenRequest {
    pub model: String,
    pub prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub n: Option<u32>,
    pub response_format: String, // always "b64_json"
    /// Always false — we never want watermarks on generated images.
    #[serde(default)]
    pub watermark: bool,
}

#[derive(Debug, Deserialize)]
pub struct ImageGenResponse {
    pub data: Vec<ImageGenItem>,
}

#[derive(Debug, Deserialize)]
pub struct ImageGenItem {
    pub b64_json: Option<String>,
    pub url: Option<String>,
    pub size: Option<String>,
}

// ---------------------------------------------------------------------------
// Video generation — async task pattern
// POST {baseURL}/contents/generations/tasks  → task id
// GET  {baseURL}/contents/generations/tasks/{id}  → status + content
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct VideoGenRequest {
    pub model: String,
    pub content: Vec<VideoContentItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ratio: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<i32>,
    /// Always false — we never want watermarks on generated videos.
    #[serde(default)]
    pub watermark: bool,
}

#[derive(Debug, Serialize)]
pub struct VideoContentItem {
    #[serde(rename = "type")]
    pub content_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct VideoCreateResponse {
    pub id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct VideoTaskStatus {
    pub id: Option<String>,
    pub status: Option<String>, // queued | running | succeeded | failed | expired | cancelled
    pub content: Option<VideoTaskContent>,
    pub error: Option<VideoTaskError>,
}

#[derive(Debug, Deserialize)]
pub struct VideoTaskContent {
    pub video_url: Option<String>,
    pub last_frame_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct VideoTaskError {
    pub code: Option<String>,
    pub message: Option<String>,
}
