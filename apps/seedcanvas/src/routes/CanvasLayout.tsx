import { useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { listen } from "@tauri-apps/api/event"
import { useCallback, useEffect, useRef, useState } from "react"
import { Canvas } from "@/canvas/Canvas"
import { CanvasToolbar } from "@/canvas/CanvasToolbar"
import { FirstImageCelebration } from "@/canvas/FirstImageCelebration"
import { GeneratingOverlay } from "@/canvas/GeneratingOverlay"
import { setupMcpBridge } from "@/canvas/mcp-bridge"
import { useCanvasStore } from "@/canvas/store"
import { startAutoSave } from "@/lib/auto-save"
import { assetUrl } from "@/lib/fs"
import { type AppSettings, loadSettings } from "@/lib/settings"
import { generateId } from "@/lib/id"

const MIN_DISPLAY_SIDE = 400

function fitDisplaySize(w: number, h: number): { width: number; height: number } {
  if (w <= 0 || h <= 0) return { width: MIN_DISPLAY_SIDE, height: MIN_DISPLAY_SIDE }
  const ratio = w / h
  if (w >= h) {
    return { width: Math.round(MIN_DISPLAY_SIDE * ratio), height: MIN_DISPLAY_SIDE }
  }
  return { width: MIN_DISPLAY_SIDE, height: Math.round(MIN_DISPLAY_SIDE / ratio) }
}

export function CanvasLayout() {
  const { projectId } = useParams({ from: "/canvas/$projectId" })
  const { firstRun } = useSearch({ from: "/canvas/$projectId" })
  const navigate = useNavigate()
  const storeProjectId = useCanvasStore((s) => s.projectId)
  const openProject = useCanvasStore((s) => s.openProject)
  const closeProject = useCanvasStore((s) => s.closeProject)
  const [error, setError] = useState(false)

  // Latch firstRun from URL — persists even after URL cleanup
  const [isFirstRun, setIsFirstRun] = useState(false)
  const [showCelebration, setShowCelebration] = useState(false)
  const celebrationTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (firstRun) setIsFirstRun(true)
  }, [firstRun])

  const handleSettingsChange = useCallback((_s: AppSettings) => {
    // Settings saved — the MCP binary reads settings.json directly,
    // so no runtime propagation needed.
  }, [])

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

  // MCP bridge — proxy canvas operations from external MCP binary
  useEffect(() => {
    if (!storeProjectId) return
    return setupMcpBridge()
  }, [storeProjectId])

  // Listen for task:complete events from Rust backend
  useEffect(() => {
    if (!storeProjectId) return

    const unlisten = listen<{
      taskId: string
      projectId: string
      type: string
      status: string
      output?: { assetPath: string; width: number; height: number }
      error?: string
      nodeId?: string
    }>("task:complete", (event) => {
      const data = event.payload
      if (data.projectId !== storeProjectId || data.status !== "done" || !data.output) return

      // Trigger celebration on first image during first-run
      if (isFirstRun) {
        setShowCelebration(true)
        setIsFirstRun(false)
        celebrationTimerRef.current = setTimeout(() => setShowCelebration(false), 6000)
      }

      const { assetPath, width, height } = data.output
      const url = assetUrl(assetPath)
      const store = useCanvasStore.getState()

      // Compute a reasonable display size (short side = 400, preserve aspect ratio)
      const displayStyle = fitDisplaySize(width, height)

      if (data.nodeId) {
        // Push result to existing node + resize to fit
        store.pushHistory(data.nodeId, {
          id: generateId(),
          parameters: { taskId: data.taskId },
          result:
            data.type === "image"
              ? { type: "image", url, width, height }
              : { type: "video", url, width, height },
          createdAt: new Date().toISOString(),
        })
        store.updateNodeStyle(data.nodeId, displayStyle)
      } else {
        // Create a new node for the result
        const vp = store.viewport
        store.addNode({
          id: generateId(),
          type: data.type === "image" ? "image" : "video",
          position: {
            x: Math.round(-vp.x / vp.zoom) + Math.random() * 100,
            y: Math.round(-vp.y / vp.zoom) + Math.random() * 100,
          },
          style: displayStyle,
          data: {
            uiInfo: { title: `Generated ${data.type}` },
            historys: [
              {
                id: generateId(),
                parameters: { taskId: data.taskId },
                result:
                  data.type === "image"
                    ? { type: "image", url, width, height }
                    : { type: "video", url, width, height },
                createdAt: new Date().toISOString(),
              },
            ],
          },
        })
      }
    })

    return () => {
      unlisten.then((fn) => fn())
    }
  }, [storeProjectId, isFirstRun])

  // Cleanup store on unmount (navigating away)
  useEffect(() => {
    return () => {
      clearTimeout(celebrationTimerRef.current)
      closeProject()
    }
  }, [closeProject])

  const handleDismissCelebration = useCallback(() => {
    clearTimeout(celebrationTimerRef.current)
    setShowCelebration(false)
  }, [])

  // Loading state while store hydrates
  if (!storeProjectId) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading project…</p>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full">
      <CanvasToolbar onSettingsChange={handleSettingsChange} />
      <Canvas />
      <GeneratingOverlay />
      <FirstImageCelebration show={showCelebration} onDismiss={handleDismissCelebration} />
    </div>
  )
}
