import { type NodeProps, useNodeId } from "@xyflow/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { generateId } from "@/lib/id"
import { useCanvasStore } from "../store"
import type { CanvasNodeData } from "../types"
import { NodeShell } from "./NodeShell"

export function TextNode({ data, selected }: NodeProps) {
  const nodeId = useNodeId() as string
  const nodeData = data as CanvasNodeData
  const pushHistory = useCanvasStore((s) => s.pushHistory)

  const latestText = nodeData.historys.find((h) => h.result.type === "text")
  const content = latestText?.result.type === "text" ? latestText.result.content : ""

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(content)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.select()
    }
  }, [editing])

  const commitEdit = useCallback(() => {
    setEditing(false)
    if (draft !== content) {
      pushHistory(nodeId, {
        id: generateId(),
        parameters: {},
        result: { type: "text", content: draft },
        createdAt: new Date().toISOString(),
      })
    }
  }, [draft, content, nodeId, pushHistory])

  const handleDoubleClick = useCallback(() => {
    setDraft(content)
    setEditing(true)
  }, [content])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        setDraft(content)
        setEditing(false)
      }
    },
    [content]
  )

  return (
    <NodeShell selected={selected} label={nodeData.uiInfo.title}>
      <div className="px-3 pb-3 pt-1" onDoubleClick={handleDoubleClick}>
        {editing ? (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            className="nodrag nowheel w-full resize-none bg-transparent text-sm leading-relaxed outline-none"
            rows={Math.max(2, draft.split("\n").length)}
          />
        ) : (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-card-foreground/80">
            {content || "Double-click to edit\u2026"}
          </p>
        )}
      </div>
    </NodeShell>
  )
}
