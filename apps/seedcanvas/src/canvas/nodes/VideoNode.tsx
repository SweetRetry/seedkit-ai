import type { NodeProps } from "@xyflow/react"
import { useState } from "react"
import type { CanvasNodeData } from "../types"
import { NodeShell } from "./NodeShell"

export function VideoNode({ data, selected }: NodeProps) {
  const nodeData = data as CanvasNodeData
  const latestVideo = nodeData.historys.find((h) => h.result.type === "video")
  const [error, setError] = useState(false)

  const src = latestVideo?.result.type === "video" ? latestVideo.result.url : null

  return (
    <NodeShell selected={selected} label={nodeData.uiInfo.title}>
      <div className="overflow-hidden rounded-b-xl h-full">
        {error || !src ? (
          <div className="flex h-full w-full items-center justify-center bg-muted/50 text-xs text-muted-foreground">
            {src ? "Failed to load video" : "No video"}
          </div>
        ) : (
          <video
            src={src}
            muted
            className="nowheel h-full w-full object-contain"
            onError={() => setError(true)}
          />
        )}
      </div>
    </NodeShell>
  )
}
