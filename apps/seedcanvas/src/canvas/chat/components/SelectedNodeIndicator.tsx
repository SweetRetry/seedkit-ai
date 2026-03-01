import { BoxSelectIcon } from "lucide-react"
import { useCanvasStore } from "@/canvas/store"

export function SelectedNodeIndicator() {
  const selectedNodeIds = useCanvasStore((s) => s.selectedNodeIds)
  const nodes = useCanvasStore((s) => s.nodes)

  if (selectedNodeIds.length === 0) return null

  const selected = nodes.filter((n) => selectedNodeIds.includes(n.id))
  const label =
    selected.length === 1
      ? `${selected[0].type ?? "node"}: ${selected[0].data.uiInfo.title}`
      : `${selected.length} nodes selected`

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground truncate max-w-[200px]">
      <BoxSelectIcon size={12} className="shrink-0" />
      <span className="truncate">{label}</span>
    </div>
  )
}
