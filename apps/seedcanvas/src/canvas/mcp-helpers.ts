import { useCanvasStore } from "@/canvas/store"
import type { HistoryEntry, HistoryResult } from "@/canvas/types"

export { generateId } from "@/lib/id"

export function getStore() {
  return useCanvasStore.getState()
}

// ---------------------------------------------------------------------------
// History serialization — make results LLM-readable
// ---------------------------------------------------------------------------

export function serializeResult(result: HistoryResult): Record<string, unknown> {
  switch (result.type) {
    case "text":
      return { type: "text", content: result.content }
    case "image":
      return {
        type: "image",
        description: `Image (${result.width}×${result.height})`,
        width: result.width,
        height: result.height,
        hint: "Use read_content with this node's id to see the image.",
      }
    case "video":
      return {
        type: "video",
        description: `Video (${result.width}×${result.height})`,
        width: result.width,
        height: result.height,
        hint: "Use read_content with this node's id to see the video.",
      }
  }
}

export function serializeHistory(h: HistoryEntry) {
  return {
    id: h.id,
    result: serializeResult(h.result),
    source: (h.parameters as Record<string, unknown>).source ?? null,
    createdAt: h.createdAt,
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
