/**
 * Unified Tauri IPC command layer.
 *
 * Every frontend-to-Rust call goes through this module.
 * Components should never import `invoke` directly — import typed
 * functions from here instead.
 */
import { invoke } from "@tauri-apps/api/core"

// ── Types ─────────────────────────────────────────────────────────────────

// -- Generation --

export interface GenerateImageParams {
  projectId: string
  prompt: string
  model?: string
  nodeId?: string
  size?: string
}

export interface GenerateVideoParams {
  projectId: string
  prompt: string
  model?: string
  nodeId?: string
  resolution?: string
  ratio?: string
  duration?: number
}

export interface TaskSubmitResult {
  taskId: string
  status: string
}

export interface TaskStatusResult {
  taskId: string
  projectId?: string
  type?: string
  status: string
  output?: Record<string, unknown> | null
  error?: string | null
  createdAt?: string
  updatedAt?: string
}

// -- Assets --

export interface AssetRow {
  id: string
  projectId: string
  taskId: string | null
  type: string
  filePath: string
  fileName: string
  prompt: string | null
  model: string | null
  width: number | null
  height: number | null
  fileSize: number | null
  source: string
  createdAt: string
}

export interface AssetStats {
  total: number
  images: number
  videos: number
  totalSize: number
}

export interface ListAssetsParams {
  projectId?: string
  assetType?: string
  query?: string
  limit?: number
  offset?: number
}

// -- Usage --

export interface DailyCount {
  date: string
  count: number
}

export interface TaskRow {
  id: string
  project_id: string
  type: string
  status: string
  input: string
  output: string | null
  ark_task_id: string | null
  error: string | null
  created_at: string
  updated_at: string
}

export interface UsageStats {
  totalTasks: number
  imagesGenerated: number
  videosGenerated: number
  succeeded: number
  failed: number
  dailyCounts: DailyCount[]
  recentTasks: TaskRow[]
}

// -- MCP --

export interface McpConfigStatus {
  configured: boolean
  currentPath: string | null
}

// -- Storage --

export interface DataDirInfo {
  dataDir: string
  dbSize: number
}

export interface OrphanProject {
  id: string
  path: string
  hasManifest: boolean
  hasAssets: boolean
  sizeBytes: number
}

export interface CleanupResult {
  deleted: number
  errors: string[]
}

// ── Generation ────────────────────────────────────────────────────────────

/** Submit an image generation task. */
export function generateImage(params: GenerateImageParams): Promise<TaskSubmitResult> {
  return invoke<TaskSubmitResult>("generate_image", {
    projectId: params.projectId,
    prompt: params.prompt,
    model: params.model ?? null,
    nodeId: params.nodeId ?? null,
    size: params.size ?? null,
  })
}

/** Submit a video generation task. */
export function generateVideo(params: GenerateVideoParams): Promise<TaskSubmitResult> {
  return invoke<TaskSubmitResult>("generate_video", {
    projectId: params.projectId,
    prompt: params.prompt,
    model: params.model ?? null,
    nodeId: params.nodeId ?? null,
    resolution: params.resolution ?? null,
    ratio: params.ratio ?? null,
    duration: params.duration ?? null,
  })
}

/** Poll the status of a generation task. */
export function getTaskStatus(taskId: string): Promise<TaskStatusResult> {
  return invoke<TaskStatusResult>("task_status", { taskId })
}

// ── Assets ────────────────────────────────────────────────────────────────

/** List asset records with optional filters. */
export function listAssets(params: ListAssetsParams = {}): Promise<AssetRow[]> {
  return invoke<AssetRow[]>("list_assets", {
    projectId: params.projectId ?? null,
    assetType: params.assetType ?? null,
    query: params.query ?? null,
    limit: params.limit ?? 50,
    offset: params.offset ?? 0,
  })
}

/** Get aggregate asset statistics. */
export function getAssetStats(): Promise<AssetStats> {
  return invoke<AssetStats>("get_asset_stats")
}

/** Register a locally-imported file as an asset in the DB. */
export function registerImportedAsset(
  projectId: string,
  filePath: string,
  fileName: string,
  assetType: string,
): Promise<{ id: string }> {
  return invoke<{ id: string }>("register_imported_asset", {
    projectId,
    filePath,
    fileName,
    assetType,
  })
}

// ── Usage ─────────────────────────────────────────────────────────────────

/** Get usage statistics (task counts, daily breakdown, recent tasks). */
export function getUsageStats(): Promise<UsageStats> {
  return invoke<UsageStats>("get_usage_stats")
}

// ── Project ───────────────────────────────────────────────────────────────

/** Delete SQLite data for a project (tasks + optionally assets). */
export function deleteProjectData(projectId: string, keepAssets: boolean): Promise<void> {
  return invoke("delete_project_data", { projectId, keepAssets })
}

// ── MCP ───────────────────────────────────────────────────────────────────

/** Resolve the absolute path to the bundled seedcanvas-mcp binary. */
export function resolveMcpBinaryPath(): Promise<string> {
  return invoke<string>("resolve_mcp_binary_path")
}

/** Check whether Claude Code's ~/.claude.json has a seedcanvas MCP entry. */
export function checkMcpConfig(): Promise<McpConfigStatus> {
  return invoke<McpConfigStatus>("check_mcp_config")
}

/** Write/overwrite the seedcanvas MCP entry in ~/.claude.json. */
export function injectMcpConfig(binaryPath: string): Promise<{ ok: true }> {
  return invoke<{ ok: true }>("inject_mcp_config", { binaryPath })
}

// ── Storage ───────────────────────────────────────────────────────────────

/** Get the app data directory path and database file size. */
export function getDataDirInfo(): Promise<DataDirInfo> {
  return invoke<DataDirInfo>("get_data_dir_info")
}

/** Scan for project directories that have no matching recent-projects entry. */
export function scanOrphanProjects(): Promise<OrphanProject[]> {
  return invoke<OrphanProject[]>("scan_orphan_projects")
}

/** Delete orphan project directories and their DB data. */
export function cleanupOrphanProjects(projectIds: string[]): Promise<CleanupResult> {
  return invoke<CleanupResult>("cleanup_orphan_projects", { projectIds })
}

/** Open the app data directory in the OS file manager. */
export function revealDataDir(): Promise<void> {
  return invoke("reveal_data_dir")
}
