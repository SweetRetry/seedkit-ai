import { convertFileSrc } from "@tauri-apps/api/core"
import type { NodeProps } from "@xyflow/react"
import { useMemo, useState } from "react"
import type { CanvasNodeData } from "../types"
import { NodeShell } from "./NodeShell"

/** Convert a raw URL to one the WebView can display. */
function resolveImageSrc(raw: string): string {
  // Already an asset:// or http(s):// URL — use as-is
  if (raw.startsWith("asset://") || raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw
  }
  // Local absolute path — convert via Tauri asset protocol
  return convertFileSrc(raw)
}

export function ImageNode({ data, selected }: NodeProps) {
  const nodeData = data as CanvasNodeData
  const latestImage = nodeData.historys.find((h) => h.result.type === "image")
  const [error, setError] = useState(false)

  const rawUrl = latestImage?.result.type === "image" ? latestImage.result.url : null
  const src = useMemo(() => (rawUrl ? resolveImageSrc(rawUrl) : null), [rawUrl])

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
