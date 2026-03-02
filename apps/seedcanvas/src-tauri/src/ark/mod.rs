#[allow(dead_code)]
pub mod types;

use anyhow::{bail, Context, Result};
use reqwest::Client;
use types::{
    ImageGenRequest, ImageGenResponse, VideoCreateResponse, VideoGenRequest, VideoTaskStatus,
};

pub struct ArkClient {
    base_url: String,
    api_key: String,
    http: Client,
}

impl ArkClient {
    pub fn new(base_url: String, api_key: String) -> Self {
        Self {
            base_url,
            api_key,
            http: Client::new(),
        }
    }

    /// POST /images/generations — synchronous (~30s), returns base64 image(s).
    pub async fn generate_image(&self, req: &ImageGenRequest) -> Result<ImageGenResponse> {
        let url = format!("{}/images/generations", self.base_url);
        let resp = self
            .http
            .post(&url)
            .bearer_auth(&self.api_key)
            .json(req)
            .send()
            .await
            .context("image generation request failed")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            bail!("ARK image API error {status}: {body}");
        }

        resp.json::<ImageGenResponse>()
            .await
            .context("failed to parse image generation response")
    }

    /// POST /contents/generations/tasks — returns the async task ID.
    pub async fn create_video_task(&self, req: &VideoGenRequest) -> Result<String> {
        let url = format!("{}/contents/generations/tasks", self.base_url);
        let resp = self
            .http
            .post(&url)
            .bearer_auth(&self.api_key)
            .json(req)
            .send()
            .await
            .context("video task creation request failed")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            bail!("ARK video create API error {status}: {body}");
        }

        let body = resp
            .json::<VideoCreateResponse>()
            .await
            .context("failed to parse video create response")?;

        body.id
            .ok_or_else(|| anyhow::anyhow!("no task ID in video create response"))
    }

    /// GET /contents/generations/tasks/{task_id} — poll task status.
    pub async fn get_video_task(&self, task_id: &str) -> Result<VideoTaskStatus> {
        let url = format!(
            "{}/contents/generations/tasks/{}",
            self.base_url, task_id
        );
        let resp = self
            .http
            .get(&url)
            .bearer_auth(&self.api_key)
            .send()
            .await
            .context("video task status request failed")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            bail!("ARK video status API error {status}: {body}");
        }

        resp.json::<VideoTaskStatus>()
            .await
            .context("failed to parse video task status response")
    }
}
