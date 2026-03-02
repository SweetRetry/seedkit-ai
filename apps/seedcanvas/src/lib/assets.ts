import { join } from "@tauri-apps/api/path"
import type { CanvasNode } from "../canvas/types"
import { assetUrl, getProjectDir, importAsset } from "./fs"
import { registerImportedAsset } from "./commands"
import { generateId } from "./id"

function getExtension(filePath: string): string {
  const parts = filePath.split(".")
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : ""
}

export async function importImageFile(
  projectId: string,
  filePath: string,
  position: { x: number; y: number }
): Promise<CanvasNode> {
  const ext = getExtension(filePath)
  const assetFileName = await importAsset(projectId, filePath, ext || "png")
  const projectDir = await getProjectDir(projectId)
  const absPath = await join(projectDir, "assets", assetFileName)
  const url = assetUrl(absPath)

  // Register in asset DB for global browsing
  registerImportedAsset(projectId, absPath, assetFileName, "image").catch(() => {})

  const initWidth = Math.max(300, 250)
  const initHeight = Math.max(200, 250)

  return {
    id: generateId(),
    type: "image",
    position,
    style: { width: initWidth, height: initHeight },
    data: {
      uiInfo: { title: "Image" },
      historys: [
        {
          id: generateId(),
          parameters: { source: filePath },
          result: { type: "image", url, width: initWidth, height: initHeight },
          createdAt: new Date().toISOString(),
        },
      ],
    },
  }
}

export async function importVideoFile(
  projectId: string,
  filePath: string,
  position: { x: number; y: number }
): Promise<CanvasNode> {
  const ext = getExtension(filePath)
  const assetFileName = await importAsset(projectId, filePath, ext || "mp4")
  const projectDir = await getProjectDir(projectId)
  const absPath = await join(projectDir, "assets", assetFileName)
  const url = assetUrl(absPath)

  // Register in asset DB for global browsing
  registerImportedAsset(projectId, absPath, assetFileName, "video").catch(() => {})

  const initWidth = Math.max(400, 250)
  const initHeight = Math.max(300, 250)

  return {
    id: generateId(),
    type: "video",
    position,
    style: { width: initWidth, height: initHeight },
    data: {
      uiInfo: { title: "Video" },
      historys: [
        {
          id: generateId(),
          parameters: { source: filePath },
          result: { type: "video", url, width: initWidth, height: initHeight },
          createdAt: new Date().toISOString(),
        },
      ],
    },
  }
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"])
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "avi", "mkv"])

export function isImageFile(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(getExtension(filePath))
}

export function isVideoFile(filePath: string): boolean {
  return VIDEO_EXTENSIONS.has(getExtension(filePath))
}
