import { useNavigate } from "@tanstack/react-router"
import { ArrowLeft, Check, Circle, Loader2, Moon, Settings, Sun } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useTheme } from "@/hooks/useTheme"
import { type AppSettings } from "@/lib/settings"
import { SettingsDialog } from "@/components/SettingsDialog"
import { useCanvasStore } from "./store"

// ---------------------------------------------------------------------------
// SaveIndicator
// ---------------------------------------------------------------------------

function SaveIndicator() {
  const isDirty = useCanvasStore((s) => s.isDirty)
  const isSaving = useCanvasStore((s) => s.isSaving)
  const [showSaved, setShowSaved] = useState(false)
  const [hasSaved, setHasSaved] = useState(false)

  useEffect(() => {
    if (isSaving) {
      setHasSaved(true)
      setShowSaved(false)
      return
    }
    if (hasSaved && !isDirty) {
      setShowSaved(true)
      const timer = setTimeout(() => setShowSaved(false), 1500)
      return () => clearTimeout(timer)
    }
    setShowSaved(false)
  }, [isSaving, isDirty, hasSaved])

  if (isSaving) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground animate-in fade-in">
        <Loader2 size={12} className="animate-spin" />
        Saving
      </span>
    )
  }

  if (isDirty) {
    return (
      <span
        className="flex items-center gap-1 text-xs text-muted-foreground"
        title="Unsaved changes"
      >
        <Circle size={6} className="fill-accent text-accent" />
      </span>
    )
  }

  if (showSaved) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground animate-in fade-in">
        <Check size={12} />
        Saved
      </span>
    )
  }

  return null
}

// ---------------------------------------------------------------------------
// CanvasToolbar
// ---------------------------------------------------------------------------

interface CanvasToolbarProps {
  onSettingsChange: (settings: AppSettings) => void
}

export function CanvasToolbar({ onSettingsChange }: CanvasToolbarProps) {
  const navigate = useNavigate()
  const { resolvedTheme, setTheme } = useTheme()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const projectName = useCanvasStore((s) => s.projectName)
  const saveNow = useCanvasStore((s) => s.saveNow)
  const isDirty = useCanvasStore((s) => s.isDirty)

  const handleClose = useCallback(async () => {
    if (isDirty) await saveNow()
    navigate({ to: "/" })
  }, [isDirty, saveNow, navigate])

  const handleSettingsChange = useCallback(
    (s: AppSettings) => {
      onSettingsChange(s)
    },
    [onSettingsChange]
  )

  return (
    <>
      {/* Left: project header */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2 rounded-lg border border-border bg-background/80 backdrop-blur-sm px-2 py-1 shadow-sm">
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" onClick={handleClose} title="Close project">
                <ArrowLeft size={14} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Back to projects</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <span className="text-sm font-semibold truncate max-w-48">
          {projectName ?? "SeedCanvas"}
        </span>
        <SaveIndicator />
      </div>

      {/* Right: settings & theme */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1 rounded-lg border border-border bg-background/80 backdrop-blur-sm p-1 shadow-sm">
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              >
                {resolvedTheme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" onClick={() => setSettingsOpen(true)}>
                <Settings size={14} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Settings</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSettingsChange={handleSettingsChange}
      />
    </>
  )
}
