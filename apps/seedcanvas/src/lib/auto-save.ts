import { useCanvasStore } from "../canvas/store"
import { captureCover } from "./cover"
import { saveCanvas } from "./project"

const DEBOUNCE_MS = 500
const COVER_DEBOUNCE_MS = 3000

export function startAutoSave(): () => void {
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let coverTimer: ReturnType<typeof setTimeout> | null = null

  const unsubscribe = useCanvasStore.subscribe(
    (state) => ({ nodes: state.nodes, edges: state.edges, isDirty: state.isDirty }),
    (curr) => {
      if (!curr.isDirty) return

      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(async () => {
        const { projectId, toCanvasFile, markClean, markSaving, isDirty } =
          useCanvasStore.getState()
        if (!projectId || !isDirty) return

        try {
          markSaving(true)
          await saveCanvas(projectId, toCanvasFile())
          markClean()
        } catch (err) {
          console.error("Auto-save failed:", err)
        } finally {
          markSaving(false)
        }

        // Schedule cover capture with a longer debounce
        if (coverTimer) clearTimeout(coverTimer)
        coverTimer = setTimeout(() => {
          const { projectId: pid, nodes } = useCanvasStore.getState()
          if (pid) captureCover(pid, nodes)
        }, COVER_DEBOUNCE_MS)
      }, DEBOUNCE_MS)
    },
    { equalityFn: (a, b) => a.nodes === b.nodes && a.edges === b.edges && a.isDirty === b.isDirty }
  )

  return () => {
    if (saveTimer) clearTimeout(saveTimer)
    if (coverTimer) clearTimeout(coverTimer)
    unsubscribe()
  }
}
