/**
 * Batch canvas operations — pure functions, no Zustand dependency.
 *
 * executeBatch() takes a snapshot of nodes/edges, applies all operations
 * against the local copies, and returns the new arrays + results.
 * The caller (store.batchApply) decides whether to commit via set().
 */

import { generateId } from "@/lib/id"
import type { CanvasEdge, CanvasNode, CanvasViewport, HistoryEntry, HistoryResult } from "./types"
import { MAX_HISTORYS } from "./types"

// ---------------------------------------------------------------------------
// Operation types
// ---------------------------------------------------------------------------

export type BatchOp =
  | {
      op: "add_node"
      type: "text" | "image" | "video"
      title: string
      position?: { x: number; y: number }
      initialContent?: string
      url?: string
      width?: number
      height?: number
      ref?: string
    }
  | {
      op: "update_node"
      nodeId: string
      title?: string
      position?: { x: number; y: number }
      newContent?: string
      newImageUrl?: string
      newVideoUrl?: string
      width?: number
      height?: number
    }
  | {
      op: "delete"
      nodeIds?: string[]
      edgeIds?: string[]
    }
  | {
      op: "add_edge"
      source: string
      target: string
    }

export interface BatchResult {
  ok: boolean
  results: Array<Record<string, unknown>>
  error?: string
}

// ---------------------------------------------------------------------------
// Pure execution engine
// ---------------------------------------------------------------------------

interface BatchInput {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  viewport: CanvasViewport
}

interface BatchOutput {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  results: Array<Record<string, unknown>>
}

/** Apply a list of batch operations against immutable copies. Never mutates input. */
export function executeBatch(operations: BatchOp[], input: BatchInput): BatchOutput {
  let { nodes, edges } = input
  const { viewport: vp } = input
  const refs = new Map<string, string>()
  const results: Array<Record<string, unknown>> = []

  const resolveRef = (idOrRef: string): string => refs.get(idOrRef) ?? idOrRef

  for (const op of operations) {
    switch (op.op) {
      case "add_node": {
        const pos = op.position ?? {
          x: Math.round(-vp.x / vp.zoom),
          y: Math.round(-vp.y / vp.zoom),
        }

        const result = buildHistoryResult(op)
        const node: CanvasNode = {
          id: generateId(),
          type: op.type,
          position: pos,
          data: {
            uiInfo: { title: op.title },
            historys: [makeEntry(result)],
          },
        }

        // Set display size: text nodes get fixed max-width, media nodes scale by aspect ratio
        if (op.type === "text") {
          node.style = { width: MIN_DISPLAY_SIDE }
        } else if (op.width && op.height) {
          node.style = fitDisplayStyle(op.width, op.height)
        }

        nodes = [...nodes, node]
        if (op.ref) refs.set(op.ref, node.id)
        results.push({ op: "add_node", id: node.id, ref: op.ref ?? null, title: op.title })
        break
      }

      case "update_node": {
        const idx = nodes.findIndex((n) => n.id === op.nodeId)
        if (idx === -1) {
          results.push({ op: "update_node", error: `Node "${op.nodeId}" not found` })
          break
        }

        let node = nodes[idx]

        if (op.position) {
          node = { ...node, position: op.position }
        }

        if (op.title) {
          node = { ...node, data: { ...node.data, uiInfo: { title: op.title } } }
        }

        if (op.newContent) {
          node = pushEntry(node, { type: "text", content: op.newContent })
        } else if (op.newImageUrl) {
          const w = op.width ?? 300
          const h = op.height ?? 250
          node = pushEntry(node, { type: "image", url: op.newImageUrl, width: w, height: h })
          node = { ...node, style: { ...node.style, ...fitDisplayStyle(w, h) } }
        } else if (op.newVideoUrl) {
          const w = op.width ?? 400
          const h = op.height ?? 300
          node = pushEntry(node, { type: "video", url: op.newVideoUrl, width: w, height: h })
          node = { ...node, style: { ...node.style, ...fitDisplayStyle(w, h) } }
        }

        nodes = nodes.map((n, i) => (i === idx ? node : n))
        results.push({ op: "update_node", id: op.nodeId })
        break
      }

      case "delete": {
        if (!op.nodeIds?.length && !op.edgeIds?.length) {
          results.push({ op: "delete", error: "At least one of nodeIds or edgeIds required" })
          break
        }
        if (op.nodeIds?.length) {
          const idSet = new Set(op.nodeIds)
          nodes = nodes.filter((n) => !idSet.has(n.id))
          edges = edges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target))
        }
        if (op.edgeIds?.length) {
          const idSet = new Set(op.edgeIds)
          edges = edges.filter((e) => !idSet.has(e.id))
        }
        results.push({ op: "delete", deletedNodes: op.nodeIds ?? [], deletedEdges: op.edgeIds ?? [] })
        break
      }

      case "add_edge": {
        const source = resolveRef(op.source)
        const target = resolveRef(op.target)
        const edge: CanvasEdge = { id: `e-${source}-${target}`, source, target }
        edges = [...edges, edge]
        results.push({ op: "add_edge", id: edge.id, source, target })
        break
      }
    }
  }

  return { nodes, edges, results }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimum display side length for media nodes on canvas. */
const MIN_DISPLAY_SIDE = 400

/**
 * Compute a display style that fits the original aspect ratio within a
 * reasonable canvas size. The shorter side is clamped to MIN_DISPLAY_SIDE.
 */
function fitDisplayStyle(origW: number, origH: number): { width: number; height: number } {
  if (origW <= 0 || origH <= 0) return { width: MIN_DISPLAY_SIDE, height: MIN_DISPLAY_SIDE }
  const ratio = origW / origH
  if (origW >= origH) {
    // Landscape or square — height = MIN_DISPLAY_SIDE, width scales
    const h = MIN_DISPLAY_SIDE
    return { width: Math.round(h * ratio), height: h }
  }
  // Portrait — width = MIN_DISPLAY_SIDE, height scales
  const w = MIN_DISPLAY_SIDE
  return { width: w, height: Math.round(w / ratio) }
}

function buildHistoryResult(op: Extract<BatchOp, { op: "add_node" }>): HistoryResult {
  if (op.type === "text") return { type: "text", content: op.initialContent ?? "" }
  if (op.type === "image") return { type: "image", url: op.url ?? "", width: op.width ?? 300, height: op.height ?? 250 }
  return { type: "video", url: op.url ?? "", width: op.width ?? 400, height: op.height ?? 300 }
}

function makeEntry(result: HistoryResult): HistoryEntry {
  return { id: generateId(), parameters: {}, result, createdAt: new Date().toISOString() }
}

function pushEntry(node: CanvasNode, result: HistoryResult): CanvasNode {
  const historys = [makeEntry(result), ...node.data.historys].slice(0, MAX_HISTORYS)
  return { ...node, data: { ...node.data, historys } }
}
