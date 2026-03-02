import type { CanvasState } from "@/canvas/store"
import { serializeHistory, serializeResult } from "./mcp-helpers"

export interface QueryParams {
  scope: Array<"all" | "nodes" | "edges" | "selected">
  nodeIds?: string[]
  edgeIds?: string[]
}

/**
 * Execute a canvas query against the given store state.
 * Used by the MCP bridge to serve canvas_read requests.
 */
export function executeCanvasQuery(
  params: QueryParams,
  store: Pick<CanvasState, "nodes" | "edges" | "selectedNodeIds">
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const s of params.scope) {
    switch (s) {
      case "all": {
        result.nodes = store.nodes.map((n) => {
          const latest = n.data.historys[0]
          return {
            id: n.id,
            type: n.type,
            title: n.data.uiInfo.title,
            position: n.position,
            historyCount: n.data.historys.length,
            latestResult: latest ? serializeResult(latest.result) : null,
          }
        })
        result.edges = store.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
        }))
        break
      }

      case "nodes": {
        if (!params.nodeIds?.length) {
          result.nodeErrors = "nodeIds required when scope includes 'nodes'"
          break
        }
        const idSet = new Set(params.nodeIds)
        const found = store.nodes.filter((n) => idSet.has(n.id))
        const missing = params.nodeIds.filter((id) => !found.some((n) => n.id === id))
        result.nodes = found.map((n) => ({
          id: n.id,
          type: n.type,
          position: n.position,
          title: n.data.uiInfo.title,
          historys: n.data.historys.map(serializeHistory),
        }))
        if (missing.length) result.missingNodes = missing
        break
      }

      case "edges": {
        if (!params.edgeIds?.length) {
          result.edgeErrors = "edgeIds required when scope includes 'edges'"
          break
        }
        const idSet = new Set(params.edgeIds)
        const found = store.edges.filter((e) => idSet.has(e.id))
        const missing = params.edgeIds.filter((id) => !found.some((e) => e.id === id))
        result.edges = found.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
        }))
        if (missing.length) result.missingEdges = missing
        break
      }

      case "selected": {
        const { selectedNodeIds } = store
        if (selectedNodeIds.length === 0) {
          result.selected = []
          break
        }
        const selected = store.nodes.filter((n) => selectedNodeIds.includes(n.id))
        result.selected = selected.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.data.uiInfo.title,
          position: n.position,
          latestHistory: n.data.historys[0] ? serializeHistory(n.data.historys[0]) : null,
        }))
        break
      }
    }
  }

  return result
}
