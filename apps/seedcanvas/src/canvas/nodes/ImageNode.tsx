import type { NodeProps } from "@xyflow/react"
import { useState } from "react"
import type { CanvasNodeData } from "../types"
import { NodeShell } from "./NodeShell"

export function ImageNode({ data, selected }: NodeProps) {
  const nodeData = data as CanvasNodeData
  const latestImage = nodeData.historys.find((h) => h.result.type === "image")
  const [error, setError] = useState(false)

  const src = latestImage?.result.type === "image" ? latestImage.result.url : null

  return (
    <NodeShell selected={selected} label={nodeData.uiInfo.title}>
      <div className="overflow-hidden rounded-b-xl h-full">
        {error || !src ? (
          <div className="flex h-full w-full items-center justify-center bg-muted/50 text-xs text-muted-foreground">
            {src ? "Failed to load image" : "No image"}
          </div>
        ) : (
          <img
            src={src}
            alt={nodeData.uiInfo.title}
            className="h-full w-full object-cover"
            onError={() => setError(true)}
            draggable={false}
          />
        )}
      </div>
    </NodeShell>
  )
}
