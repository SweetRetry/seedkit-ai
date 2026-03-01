import { open } from "@tauri-apps/plugin-dialog"
import { ImageIcon, Type, VideoIcon } from "lucide-react"
import { useCallback } from "react"
import { Button } from "@/components/ui/button"
import { importImageFile, importVideoFile } from "@/lib/assets"
import { generateId } from "@/lib/id"
import { useCanvasStore } from "./store"

interface ContextMenuProps {
  x: number
  y: number
  canvasPosition: { x: number; y: number }
  onClose: () => void
}

export function ContextMenu({ x, y, canvasPosition, onClose }: ContextMenuProps) {
  const addNode = useCanvasStore((s) => s.addNode)
  const projectId = useCanvasStore((s) => s.projectId)

  const handleAddText = useCallback(() => {
    addNode({
      id: generateId(),
      type: "text",
      position: canvasPosition,
      data: { uiInfo: { title: "Text" }, historys: [] },
    })
    onClose()
  }, [addNode, canvasPosition, onClose])

  const handleAddImage = useCallback(async () => {
    onClose()
    if (!projectId) return

    const file = await open({
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] }],
    })
    if (!file) return

    const node = await importImageFile(projectId, file, canvasPosition)
    addNode(node)
  }, [addNode, projectId, canvasPosition, onClose])

  const handleAddVideo = useCallback(async () => {
    onClose()
    if (!projectId) return

    const file = await open({
      multiple: false,
      filters: [{ name: "Videos", extensions: ["mp4", "webm", "mov", "avi", "mkv"] }],
    })
    if (!file) return

    const node = await importVideoFile(projectId, file, canvasPosition)
    addNode(node)
  }, [addNode, projectId, canvasPosition, onClose])

  return (
    <div
      className="fixed z-50 min-w-[160px] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      style={{ left: x, top: y }}
    >
      <Button variant="ghost" size="sm" className="w-full justify-start" onClick={handleAddText}>
        <Type size={14} />
        Add Text
      </Button>
      <Button variant="ghost" size="sm" className="w-full justify-start" onClick={handleAddImage}>
        <ImageIcon size={14} />
        Add Image
      </Button>
      <Button variant="ghost" size="sm" className="w-full justify-start" onClick={handleAddVideo}>
        <VideoIcon size={14} />
        Add Video
      </Button>
    </div>
  )
}
