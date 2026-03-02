import { join } from "@tauri-apps/api/path"
import { remove } from "@tauri-apps/plugin-fs"
import type { CanvasFile } from "../canvas/types"
import type { ProjectManifest, RecentProject } from "../project/types"
import { deleteProjectData } from "./commands"
import { ensureDir, getDataDir, getProjectDir, readJson, writeJson } from "./fs"
import { generateId } from "./id"

async function getProjectsIndexPath(): Promise<string> {
  const dataDir = await getDataDir()
  return join(dataDir, "projects.json")
}

export async function listRecentProjects(): Promise<RecentProject[]> {
  const indexPath = await getProjectsIndexPath()
  try {
    return await readJson<RecentProject[]>(indexPath)
  } catch {
    return []
  }
}

async function saveRecentProjects(projects: RecentProject[]): Promise<void> {
  const dataDir = await getDataDir()
  await ensureDir(dataDir)
  const indexPath = await getProjectsIndexPath()
  await writeJson(indexPath, projects)
}

export async function updateRecentProject(
  id: string,
  name: string,
  coverPath?: string
): Promise<void> {
  const projects = await listRecentProjects()
  const projectDir = await getProjectDir(id)
  const now = new Date().toISOString()

  const existing = projects.findIndex((p) => p.id === id)
  const entry: RecentProject = {
    id,
    name,
    updatedAt: now,
    path: projectDir,
    coverPath: coverPath ?? projects[existing]?.coverPath,
  }

  if (existing >= 0) {
    projects[existing] = entry
  } else {
    projects.unshift(entry)
  }

  // Keep most recent first, limit to 50
  projects.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  if (projects.length > 50) projects.length = 50

  await saveRecentProjects(projects)
}

export async function createProject(
  name: string
): Promise<{ id: string; manifest: ProjectManifest }> {
  const id = generateId()
  const projectDir = await getProjectDir(id)
  const assetsDir = await join(projectDir, "assets")
  await ensureDir(assetsDir)

  const now = new Date().toISOString()
  const manifest: ProjectManifest = {
    id,
    name,
    createdAt: now,
    updatedAt: now,
    version: 1,
    schemaVersion: "1.0",
  }

  const emptyCanvas: CanvasFile = {
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
  }

  const manifestPath = await join(projectDir, "manifest.json")
  const canvasPath = await join(projectDir, "canvas.json")
  await writeJson(manifestPath, manifest)
  await writeJson(canvasPath, emptyCanvas)

  await updateRecentProject(id, name)

  return { id, manifest }
}

export async function loadProject(
  id: string
): Promise<{ manifest: ProjectManifest; canvas: CanvasFile }> {
  const projectDir = await getProjectDir(id)
  const manifestPath = await join(projectDir, "manifest.json")
  const canvasPath = await join(projectDir, "canvas.json")

  const manifest = await readJson<ProjectManifest>(manifestPath)
  const canvas = await readJson<CanvasFile>(canvasPath)

  return { manifest, canvas }
}

export async function saveCanvas(id: string, canvas: CanvasFile): Promise<void> {
  const projectDir = await getProjectDir(id)
  const canvasPath = await join(projectDir, "canvas.json")
  const manifestPath = await join(projectDir, "manifest.json")

  await writeJson(canvasPath, canvas)

  // Bump manifest updatedAt and recent project entry
  try {
    const manifest = await readJson<ProjectManifest>(manifestPath)
    manifest.updatedAt = new Date().toISOString()
    manifest.version += 1
    await writeJson(manifestPath, manifest)
    await updateRecentProject(id, manifest.name)
  } catch {
    // Non-critical — canvas data is already saved
  }
}

export async function updateProjectCover(id: string, coverPath: string): Promise<void> {
  const projects = await listRecentProjects()
  const idx = projects.findIndex((p) => p.id === id)
  if (idx >= 0) {
    projects[idx].coverPath = coverPath
    await saveRecentProjects(projects)
  }
}

export async function deleteProject(
  id: string,
  options: { keepAssets?: boolean } = {}
): Promise<void> {
  const projectDir = await getProjectDir(id)

  if (options.keepAssets) {
    // Delete everything except the assets/ subdirectory
    const manifestPath = await join(projectDir, "manifest.json")
    const canvasPath = await join(projectDir, "canvas.json")
    const coverPath = await join(projectDir, "cover.png")
    for (const f of [manifestPath, canvasPath, coverPath]) {
      try { await remove(f) } catch { /* may not exist */ }
    }
  } else {
    try {
      await remove(projectDir, { recursive: true })
    } catch {
      // Directory may already be gone
    }
  }

  // Cleanup SQLite data for this project
  // When keeping assets, preserve asset DB records so files remain trackable
  deleteProjectData(id, options.keepAssets ?? false).catch(() => {})

  const projects = await listRecentProjects()
  const filtered = projects.filter((p) => p.id !== id)
  await saveRecentProjects(filtered)
}
