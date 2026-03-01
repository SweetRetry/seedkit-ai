import type { Edge, Node } from "@xyflow/react"

// --- History Entry (LRU, max 20) ---

export type HistoryResult =
  | { type: "text"; content: string }
  | { type: "image"; url: string; width: number; height: number }
  | { type: "video"; url: string; width: number; height: number }

export interface HistoryEntry {
  id: string
  parameters: Record<string, unknown>
  result: HistoryResult
  createdAt: string
}

export const MAX_HISTORYS = 20

// --- Node Data (unified) ---

export interface CanvasNodeData extends Record<string, unknown> {
  uiInfo: { title: string }
  historys: HistoryEntry[]
}

// --- Typed ReactFlow Nodes & Edges ---

export type CanvasNode = Node<CanvasNodeData>
export type CanvasEdge = Edge

// --- Canvas Persistence ---

export interface CanvasViewport {
  x: number
  y: number
  zoom: number
}

export interface CanvasFile {
  viewport: CanvasViewport
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}
