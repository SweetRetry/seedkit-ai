import { convertFileSrc } from "@tauri-apps/api/core"
import { appDataDir, join } from "@tauri-apps/api/path"
import { copyFile, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs"
import { generateId } from "./id"

let cachedDataDir: string | null = null

export async function getDataDir(): Promise<string> {
  if (cachedDataDir) return cachedDataDir
  cachedDataDir = await appDataDir()
  return cachedDataDir
}

export async function getProjectDir(projectId: string): Promise<string> {
  const dataDir = await getDataDir()
  return join(dataDir, "projects", projectId)
}

export async function ensureDir(path: string): Promise<void> {
  try {
    await mkdir(path, { recursive: true })
  } catch {
    // Already exists — mkdir with recursive may still throw on some platforms
  }
}

export async function readJson<T>(path: string): Promise<T> {
  const text = await readTextFile(path)
  return JSON.parse(text) as T
}

export async function writeJson(path: string, data: unknown): Promise<void> {
  await writeTextFile(path, JSON.stringify(data, null, 2))
}

export async function importAsset(
  projectId: string,
  sourcePath: string,
  extension: string
): Promise<string> {
  const projectDir = await getProjectDir(projectId)
  const assetsDir = await join(projectDir, "assets")
  await ensureDir(assetsDir)

  const assetId = generateId()
  const fileName = `${assetId}.${extension}`
  const destPath = await join(assetsDir, fileName)

  await copyFile(sourcePath, destPath)
  return fileName
}

export function assetUrl(absolutePath: string): string {
  return convertFileSrc(absolutePath)
}
