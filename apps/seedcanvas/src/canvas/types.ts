import type { Node, Edge } from '@xyflow/react'

// --- Node Data ---

export interface TextNodeData extends Record<string, unknown> {
  content: string
  label?: string
}

export interface ImageNodeData extends Record<string, unknown> {
  assetPath: string
  width: number
  height: number
  label?: string
}

export interface VideoNodeData extends Record<string, unknown> {
  assetPath: string
  width: number
  height: number
  label?: string
}

export type CanvasNodeData = TextNodeData | ImageNodeData | VideoNodeData

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
