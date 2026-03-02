import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type Viewport,
} from "@xyflow/react"
import { create } from "zustand"
import { subscribeWithSelector } from "zustand/middleware"
import {
  createProject as createProjectOnDisk,
  loadProject,
  saveCanvas as saveCanvasOnDisk,
} from "../lib/project"
import { type BatchOp, type BatchResult, executeBatch } from "./batch-ops"
import type {
  CanvasEdge,
  CanvasFile,
  CanvasNode,
  CanvasNodeData,
  CanvasViewport,
  HistoryEntry,
} from "./types"
import { MAX_HISTORYS } from "./types"

// Re-export so existing consumers don't break
export type { BatchOp, BatchResult }

export interface CanvasState {
  // Project
  projectId: string | null
  projectName: string | null
  isDirty: boolean
  isSaving: boolean
  viewport: CanvasViewport

  // Canvas data
  nodes: CanvasNode[]
  edges: CanvasEdge[]

  // Selection
  selectedNodeIds: string[]
  setSelectedNodes: (ids: string[]) => void

  // ReactFlow handlers
  onNodesChange: (changes: NodeChange<CanvasNode>[]) => void
  onEdgesChange: (changes: EdgeChange<CanvasEdge>[]) => void
  onConnect: (connection: Connection) => void
  onViewportChange: (viewport: Viewport) => void

  // Node CRUD
  addNode: (node: CanvasNode) => void
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void
  updateNodeStyle: (nodeId: string, style: Record<string, unknown>) => void
  pushHistory: (nodeId: string, entry: HistoryEntry) => void
  deleteNodes: (nodeIds: string[]) => void
  deleteEdges: (edgeIds: string[]) => void

  // Batch operations (atomic, snapshot/rollback)
  batchApply: (operations: BatchOp[]) => BatchResult

  // Project persistence
  openProject: (id: string) => Promise<void>
  createProject: (name: string) => Promise<string>
  closeProject: () => void
  toCanvasFile: () => CanvasFile
  markClean: () => void
  markSaving: (saving: boolean) => void
  saveNow: () => Promise<void>
}

export const useCanvasStore = create<CanvasState>()(
  subscribeWithSelector((set, get) => ({
    // Project state
    projectId: null,
    projectName: null,
    isDirty: false,
    isSaving: false,
    viewport: { x: 0, y: 0, zoom: 1 },

    // Canvas data
    nodes: [],
    edges: [],

    // Selection
    selectedNodeIds: [],
    setSelectedNodes: (ids) => set({ selectedNodeIds: ids }),

    // ReactFlow handlers
    onNodesChange: (changes) => {
      const hasDataChange = changes.some((c) => c.type !== "dimensions" && c.type !== "select")
      set({
        nodes: applyNodeChanges(changes, get().nodes),
        ...(hasDataChange ? { isDirty: true } : {}),
      })
    },

    onEdgesChange: (changes) => {
      const hasDataChange = changes.some((c) => c.type !== "select")
      set({
        edges: applyEdgeChanges(changes, get().edges),
        ...(hasDataChange ? { isDirty: true } : {}),
      })
    },

    onConnect: (connection) => set({ edges: addEdge(connection, get().edges), isDirty: true }),

    onViewportChange: (viewport) => set({ viewport }),

    // Node CRUD
    addNode: (node) => set({ nodes: [...get().nodes, node], isDirty: true }),

    updateNodeData: (nodeId, data) =>
      set({
        nodes: get().nodes.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, ...data } as CanvasNodeData } : n
        ),
        isDirty: true,
      }),

    updateNodeStyle: (nodeId, style) =>
      set({
        nodes: get().nodes.map((n) =>
          n.id === nodeId ? { ...n, style: { ...n.style, ...style } } : n
        ),
        isDirty: true,
      }),

    pushHistory: (nodeId, entry) =>
      set({
        nodes: get().nodes.map((n) => {
          if (n.id !== nodeId) return n
          const historys = [entry, ...n.data.historys].slice(0, MAX_HISTORYS)
          return { ...n, data: { ...n.data, historys } }
        }),
        isDirty: true,
      }),

    deleteNodes: (nodeIds) => {
      const idSet = new Set(nodeIds)
      set({
        nodes: get().nodes.filter((n) => !idSet.has(n.id)),
        edges: get().edges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target)),
        isDirty: true,
      })
    },

    deleteEdges: (edgeIds) => {
      const idSet = new Set(edgeIds)
      set({
        edges: get().edges.filter((e) => !idSet.has(e.id)),
        isDirty: true,
      })
    },

    // Batch — delegate to pure function, commit or rollback
    batchApply: (operations) => {
      try {
        const { nodes, edges, results } = executeBatch(operations, {
          nodes: [...get().nodes],
          edges: [...get().edges],
          viewport: get().viewport,
        })
        set({ nodes, edges, isDirty: true })
        return { ok: true, results }
      } catch (e) {
        return { ok: false, results: [], error: e instanceof Error ? e.message : String(e) }
      }
    },

    // Persistence
    openProject: async (id) => {
      const { manifest, canvas } = await loadProject(id)
      set({
        projectId: id,
        projectName: manifest.name,
        nodes: canvas.nodes,
        edges: canvas.edges,
        viewport: canvas.viewport,
        isDirty: false,
        isSaving: false,
      })
    },

    createProject: async (name) => {
      const { id } = await createProjectOnDisk(name)
      return id
    },

    closeProject: () =>
      set({
        projectId: null,
        projectName: null,
        nodes: [],
        edges: [],
        selectedNodeIds: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        isDirty: false,
        isSaving: false,
      }),

    toCanvasFile: () => ({
      viewport: get().viewport,
      nodes: get().nodes,
      edges: get().edges,
    }),

    markClean: () => set({ isDirty: false }),
    markSaving: (saving) => set({ isSaving: saving }),

    saveNow: async () => {
      const { projectId } = get()
      if (!projectId) return
      await saveCanvasOnDisk(projectId, get().toCanvasFile())
      set({ isDirty: false })
    },
  }))
)
