import { invoke } from "@tauri-apps/api/core"
import { Check, CircleAlert, ClipboardCopy, Loader2 } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface OnboardingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onComplete: () => void
}

export function OnboardingDialog({
  open,
  onOpenChange,
  onComplete,
}: OnboardingDialogProps) {
  const [binaryPath, setBinaryPath] = useState("")
  const [mcpConfigured, setMcpConfigured] = useState(false)
  const [mcpCurrentPath, setMcpCurrentPath] = useState<string | null>(null)
  const [injecting, setInjecting] = useState(false)
  const [injected, setInjected] = useState(false)
  const [mcpError, setMcpError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Reset & probe when dialog opens
  useEffect(() => {
    if (!open) return
    setInjected(false)
    setMcpError(null)
    setCopied(false)

    let cancelled = false

    async function probe() {
      try {
        const path = await invoke<string>("resolve_mcp_binary_path")
        if (!cancelled) setBinaryPath(path)
      } catch {
        if (!cancelled) setBinaryPath("")
      }

      try {
        const status = await invoke<{
          configured: boolean
          currentPath: string | null
        }>("check_mcp_config")
        if (!cancelled) {
          setMcpConfigured(status.configured)
          setMcpCurrentPath(status.currentPath)
        }
      } catch {
        // ignore — will show as unconfigured
      }
    }

    probe()
    return () => {
      cancelled = true
    }
  }, [open])

  const mcpSnippet = JSON.stringify(
    {
      mcpServers: {
        seedcanvas: {
          command: binaryPath || "/path/to/seedcanvas-mcp",
          args: [],
        },
      },
    },
    null,
    2
  )

  const handleCopySnippet = useCallback(async () => {
    await navigator.clipboard.writeText(mcpSnippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [mcpSnippet])

  const handleAutoConfig = useCallback(async () => {
    setInjecting(true)
    setMcpError(null)
    try {
      await invoke("inject_mcp_config", { binaryPath })
      setInjected(true)
      setMcpConfigured(true)
    } catch (e) {
      setMcpError(String(e))
    } finally {
      setInjecting(false)
    }
  }, [binaryPath])

  const handleDone = useCallback(() => {
    onOpenChange(false)
    onComplete()
  }, [onOpenChange, onComplete])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Welcome to SeedCanvas</DialogTitle>
          <DialogDescription>
            Configure Claude Code to use SeedCanvas as an MCP server for AI-powered canvas operations.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Config snippet */}
          <div className="grid gap-2">
            <p className="text-sm font-medium">Configuration snippet</p>
            <div className="relative">
              <pre className="rounded-md bg-muted p-3 text-xs font-mono overflow-x-auto max-h-40 leading-relaxed">
                {mcpSnippet}
              </pre>
              <Button
                variant="ghost"
                size="icon-xs"
                className="absolute top-2 right-2"
                onClick={handleCopySnippet}
                title="Copy to clipboard"
              >
                {copied ? (
                  <Check size={12} className="text-green-500" />
                ) : (
                  <ClipboardCopy size={12} />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Add this to <code className="text-xs">~/.claude.json</code> or
              click below to auto-configure.
            </p>
          </div>

          {/* Status & auto-config */}
          {mcpConfigured && !injected && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Check size={14} className="text-green-500 shrink-0" />
              Already configured
              {mcpCurrentPath && (
                <span className="truncate">({mcpCurrentPath})</span>
              )}
            </div>
          )}

          {injected && (
            <div className="flex items-center gap-2 text-xs text-green-600">
              <Check size={14} className="shrink-0" />
              Successfully configured in ~/.claude.json
            </div>
          )}

          {mcpError && (
            <div className="flex items-start gap-2 text-xs text-destructive">
              <CircleAlert size={14} className="mt-0.5 shrink-0" />
              {mcpError}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleDone}>
            Skip
          </Button>
          {!injected && (
            <Button
              variant="outline"
              onClick={handleAutoConfig}
              disabled={injecting || !binaryPath}
            >
              {injecting && <Loader2 size={14} className="animate-spin" />}
              {injecting ? "Configuring..." : "Auto-configure"}
            </Button>
          )}
          <Button onClick={handleDone}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
