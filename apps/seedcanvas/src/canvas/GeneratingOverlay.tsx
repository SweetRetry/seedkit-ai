import { listen } from "@tauri-apps/api/event"
import { AnimatePresence, motion } from "motion/react"
import { Loader2 } from "lucide-react"
import { useEffect, useState } from "react"
import { useCanvasStore } from "./store"

interface ActiveTask {
  taskId: string
  type: "image" | "video"
}

export function GeneratingOverlay() {
  const projectId = useCanvasStore((s) => s.projectId)
  const [activeTasks, setActiveTasks] = useState<ActiveTask[]>([])

  useEffect(() => {
    if (!projectId) return

    const unlisteners = [
      listen<{ taskId: string; projectId: string; type: string }>(
        "task:submitted",
        (event) => {
          const data = event.payload
          if (data.projectId !== projectId) return
          setActiveTasks((prev) => [
            ...prev,
            { taskId: data.taskId, type: data.type as "image" | "video" },
          ])
        }
      ),
      listen<{ taskId: string; projectId: string; status: string }>(
        "task:complete",
        (event) => {
          const data = event.payload
          if (data.projectId !== projectId) return
          setActiveTasks((prev) => prev.filter((t) => t.taskId !== data.taskId))
        }
      ),
    ]

    return () => {
      for (const p of unlisteners) {
        p.then((fn) => fn())
      }
    }
  }, [projectId])

  const generating = activeTasks[0]

  const label = generating?.type === "video" ? "Generating video" : "Generating image"
  const estimate = generating?.type === "video" ? "~1-2 min" : "~30s"

  return (
    <AnimatePresence>
      {generating && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.2 }}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50"
        >
          <div className="flex items-center gap-2.5 rounded-full bg-card border border-border px-4 py-2 shadow-lg">
            <Loader2 size={14} className="animate-spin text-primary" />
            <span className="text-sm font-medium">{label}…</span>
            <span className="text-xs text-muted-foreground">{estimate}</span>
            {activeTasks.length > 1 && (
              <span className="text-xs text-muted-foreground">
                +{activeTasks.length - 1} more
              </span>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
