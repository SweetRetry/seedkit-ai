import { useNavigate, useParams } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { Canvas } from "@/canvas/Canvas"
import { useCanvasStore } from "@/canvas/store"
import { startAutoSave } from "@/lib/auto-save"
import { Sidebar } from "@/canvas/chat/components/Sidebar"

export function CanvasLayout() {
  const { projectId } = useParams({ from: "/canvas/$projectId" })
  const navigate = useNavigate()
  const storeProjectId = useCanvasStore((s) => s.projectId)
  const openProject = useCanvasStore((s) => s.openProject)
  const closeProject = useCanvasStore((s) => s.closeProject)
  const [error, setError] = useState(false)

  // Bridge URL param → Zustand store
  useEffect(() => {
    let cancelled = false

    openProject(projectId).catch(() => {
      if (!cancelled) setError(true)
    })

    return () => {
      cancelled = true
    }
  }, [projectId, openProject])

  // Navigate home on load failure
  useEffect(() => {
    if (error) navigate({ to: "/" })
  }, [error, navigate])

  // Auto-save lifecycle
  useEffect(() => {
    if (!storeProjectId) return
    return startAutoSave()
  }, [storeProjectId])

  // Cleanup store on unmount (navigating away)
  useEffect(() => {
    return () => closeProject()
  }, [closeProject])

  // Loading state while store hydrates
  if (!storeProjectId) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading project…</p>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full">
      <Sidebar />
      <Canvas />
    </div>
  )
}
