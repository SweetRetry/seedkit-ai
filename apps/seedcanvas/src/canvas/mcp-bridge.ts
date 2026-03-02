/**
 * MCP Bridge — listens for Tauri events from the Unix socket bridge (mcp_bridge.rs)
 * and executes canvas operations against the Zustand store, then sends results back.
 *
 * Events:
 * - mcp:canvas_read  → executeCanvasQuery → mcp:response
 * - mcp:canvas_batch → store.batchApply   → mcp:response
 */

import { listen, emit, type UnlistenFn } from "@tauri-apps/api/event"
import { useCanvasStore } from "@/canvas/store"
import { executeCanvasQuery } from "./mcp-query"

interface CanvasReadEvent {
  requestId: string
  scope: string[]
  nodeIds?: string[]
  edgeIds?: string[]
}

interface CanvasBatchEvent {
  requestId: string
  operations: unknown[]
}

/**
 * Set up MCP bridge event listeners.
 * Call once when a project is loaded; returns a cleanup function.
 */
export function setupMcpBridge(): () => void {
  const unlisteners: Promise<UnlistenFn>[] = []

  // Handle canvas_read requests from the MCP binary
  unlisteners.push(
    listen<CanvasReadEvent>("mcp:canvas_read", (event) => {
      const { requestId, scope, nodeIds, edgeIds } = event.payload
      try {
        const store = useCanvasStore.getState()
        const result = executeCanvasQuery(
          {
            scope: scope as Array<"all" | "nodes" | "edges" | "selected">,
            nodeIds,
            edgeIds,
          },
          store
        )
        emit("mcp:response", {
          id: requestId,
          result: JSON.stringify(result),
        })
      } catch (e) {
        emit("mcp:response", {
          id: requestId,
          result: JSON.stringify({
            error: e instanceof Error ? e.message : String(e),
          }),
        })
      }
    })
  )

  // Handle canvas_batch requests from the MCP binary
  unlisteners.push(
    listen<CanvasBatchEvent>("mcp:canvas_batch", (event) => {
      const { requestId, operations } = event.payload
      try {
        const store = useCanvasStore.getState()
        const result = store.batchApply(operations as Parameters<typeof store.batchApply>[0])
        emit("mcp:response", {
          id: requestId,
          result: JSON.stringify(result),
        })
      } catch (e) {
        emit("mcp:response", {
          id: requestId,
          result: JSON.stringify({
            ok: false,
            results: [],
            error: e instanceof Error ? e.message : String(e),
          }),
        })
      }
    })
  )

  // Return cleanup function
  return () => {
    for (const p of unlisteners) {
      p.then((fn) => fn())
    }
  }
}
