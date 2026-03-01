import { useNavigate } from "@tanstack/react-router"
import { ArrowLeft, Check, Circle, Loader2, Moon, Settings, Sun, Trash2 } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { useCanvasStore } from "@/canvas/store"
import { useChatStore } from "@/canvas/chat/store"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useTheme } from "@/hooks/useTheme"
import { type AppSettings, loadSettings } from "@/lib/settings"
import { ChatPanel } from "./ChatPanel"
import { SettingsDialog } from "./SettingsDialog"

// ---------------------------------------------------------------------------
// SaveIndicator (unchanged)
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
// Sidebar
// ---------------------------------------------------------------------------

export function Sidebar() {
  const navigate = useNavigate()
  const { resolvedTheme, setTheme } = useTheme()
  const projectName = useCanvasStore((s) => s.projectName)
  const saveNow = useCanvasStore((s) => s.saveNow)
  const isDirty = useCanvasStore((s) => s.isDirty)
  const clearMessages = useChatStore((s) => s.clearMessages)
  const messageCount = useChatStore((s) => s.messages.length)

  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Load settings on mount
  useEffect(() => {
    loadSettings().then(setSettings)
  }, [])

  const handleClose = useCallback(async () => {
    if (isDirty) await saveNow()
    navigate({ to: "/" })
  }, [isDirty, saveNow, navigate])

  const handleSettingsChange = useCallback((s: AppSettings) => {
    setSettings(s)
  }, [])

  return (
    <aside className="w-80 border-r border-sidebar-border bg-sidebar-background text-sidebar-foreground flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-xs" onClick={handleClose} title="Close project">
            <ArrowLeft size={16} />
          </Button>
          <h2 className="text-sm font-semibold text-sidebar-primary truncate flex-1">
            {projectName ?? "SeedCanvas"}
          </h2>
          <SaveIndicator />
        </div>
      </div>

      {/* Chat Area */}
      {settings ? (
        <ChatPanel settings={settings} />
      ) : (
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-xs text-muted-foreground">Loading settings...</p>
        </div>
      )}

      {/* Footer */}
      <div className="p-2 border-t border-sidebar-border flex items-center gap-1">
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
            <TooltipContent side="top">
              {resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" onClick={() => setSettingsOpen(true)}>
                <Settings size={14} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Settings</TooltipContent>
          </Tooltip>

          {messageCount > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-xs" onClick={clearMessages}>
                  <Trash2 size={14} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Clear chat</TooltipContent>
            </Tooltip>
          )}
        </TooltipProvider>
      </div>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSettingsChange={handleSettingsChange}
      />
    </aside>
  )
}
