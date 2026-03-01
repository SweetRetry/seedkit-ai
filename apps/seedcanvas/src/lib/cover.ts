import { toPng } from "html-to-image"
import { getNodesBounds, getViewportForBounds } from "@xyflow/react"
import { join } from "@tauri-apps/api/path"
import { writeFile } from "@tauri-apps/plugin-fs"
import type { CanvasNode } from "../canvas/types"
import { getProjectDir } from "./fs"
import { updateProjectCover } from "./project"

const COVER_WIDTH = 640
const COVER_HEIGHT = 360

/**
 * Capture the current ReactFlow canvas as a PNG cover image.
 * Returns the absolute path to the saved cover file, or null on failure.
 */
export async function captureCover(
  projectId: string,
  nodes: CanvasNode[]
): Promise<string | null> {
  if (nodes.length === 0) return null

  const viewportEl = document.querySelector<HTMLElement>(".react-flow__viewport")
  if (!viewportEl) return null

  try {
    const bounds = getNodesBounds(nodes)
    // Add padding around the bounds
    const padding = 50
    const paddedBounds = {
      x: bounds.x - padding,
      y: bounds.y - padding,
      width: bounds.width + padding * 2,
      height: bounds.height + padding * 2,
    }

    const viewport = getViewportForBounds(
      paddedBounds,
      COVER_WIDTH,
      COVER_HEIGHT,
      0.5,
      2,
      0
    )

    const dataUrl = await toPng(viewportEl, {
      backgroundColor: getComputedStyle(document.documentElement)
        .getPropertyValue("--background")
        .trim()
        || "#ffffff",
      width: COVER_WIDTH,
      height: COVER_HEIGHT,
      style: {
        width: `${COVER_WIDTH}px`,
        height: `${COVER_HEIGHT}px`,
        transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
      },
    })

    // Convert data URL to Uint8Array
    const base64 = dataUrl.split(",")[1]
    const binaryStr = atob(base64)
    const bytes = new Uint8Array(binaryStr.length)
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i)
    }

    const projectDir = await getProjectDir(projectId)
    const coverPath = await join(projectDir, "cover.png")
    await writeFile(coverPath, bytes)
    await updateProjectCover(projectId, coverPath)

    return coverPath
  } catch (err) {
    console.error("Cover capture failed:", err)
    return null
  }
}
