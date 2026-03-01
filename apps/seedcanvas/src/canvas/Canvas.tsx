import {
  Background,
  BackgroundVariant,
  type OnSelectionChangeFunc,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  type Viewport,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import "./canvas.css"
import { listen } from "@tauri-apps/api/event"
import { useCallback, useEffect, useState } from "react"
import { importImageFile, importVideoFile, isImageFile, isVideoFile } from "@/lib/assets"
import { ContextMenu } from "./ContextMenu"
import { nodeTypes } from "./nodes"
import { useCanvasStore } from "./store"

interface ContextMenuState {
  x: number
  y: number
  canvasPosition: { x: number; y: number }
}

function CanvasInner() {
  const {
    nodes,
    edges,
    viewport,
    projectId,
    onNodesChange,
    onEdgesChange,
    onConnect,
    onViewportChange,
    addNode,
    setSelectedNodes,
  } = useCanvasStore()

  const { screenToFlowPosition } = useReactFlow()
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  const handlePaneContextMenu = useCallback(
    (event: MouseEvent | React.MouseEvent) => {
      event.preventDefault()
      const canvasPos = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        canvasPosition: canvasPos,
      })
    },
    [screenToFlowPosition]
  )

  const handlePaneClick = useCallback(() => {
    setContextMenu(null)
  }, [])

  const handleSelectionChange: OnSelectionChangeFunc = useCallback(
    ({ nodes: selectedNodes }) => {
      setSelectedNodes(selectedNodes.map((n) => n.id))
    },
    [setSelectedNodes]
  )

  const handleViewportChange = useCallback(
    (vp: Viewport) => {
      onViewportChange(vp)
    },
    [onViewportChange]
  )

  // Tauri drag-drop handler for OS file drops
  useEffect(() => {
    if (!projectId) return

    const unlisten = listen<{ paths: string[]; position: { x: number; y: number } }>(
      "tauri://drag-drop",
      async (event) => {
        for (const filePath of event.payload.paths) {
          const canvasPos = screenToFlowPosition(event.payload.position)

          if (isImageFile(filePath)) {
            const node = await importImageFile(projectId, filePath, canvasPos)
            addNode(node)
          } else if (isVideoFile(filePath)) {
            const node = await importVideoFile(projectId, filePath, canvasPos)
            addNode(node)
          }
        }
      }
    )

    return () => {
      unlisten.then((fn) => fn())
    }
  }, [projectId, screenToFlowPosition, addNode])

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        defaultViewport={viewport}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onViewportChange={handleViewportChange}
        onPaneContextMenu={handlePaneContextMenu}
        onPaneClick={handlePaneClick}
        onSelectionChange={handleSelectionChange}
        fitView={nodes.length === 0}
        deleteKeyCode={["Backspace", "Delete"]}
        selectNodesOnDrag
        selectionOnDrag
        selectionMode={SelectionMode.Partial}
        panOnDrag={false}
        panOnScroll
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
      </ReactFlow>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          canvasPosition={contextMenu.canvasPosition}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  )
}

export function Canvas() {
  return (
    <div className="flex-1 h-full">
      <ReactFlowProvider>
        <CanvasInner />
      </ReactFlowProvider>
    </div>
  )
}
