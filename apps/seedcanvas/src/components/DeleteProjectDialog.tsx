import { AlertTriangle } from "lucide-react"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface DeleteProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectName: string
  onConfirm: (options: { keepAssets: boolean }) => void
}

export function DeleteProjectDialog({
  open,
  onOpenChange,
  projectName,
  onConfirm,
}: DeleteProjectDialogProps) {
  const [confirmText, setConfirmText] = useState("")
  const [keepAssets, setKeepAssets] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const isMatch = confirmText === projectName

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setConfirmText("")
      setKeepAssets(false)
      setDeleting(false)
    }
  }, [open])

  const handleDelete = useCallback(async () => {
    if (!isMatch) return
    setDeleting(true)
    try {
      onConfirm({ keepAssets })
    } finally {
      setDeleting(false)
    }
  }, [isMatch, keepAssets, onConfirm])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && isMatch) handleDelete()
    },
    [isMatch, handleDelete]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-destructive" />
            Delete project
          </DialogTitle>
          <DialogDescription>
            This action cannot be undone. All project data including canvas state
            and generation history will be permanently removed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Type-to-confirm */}
          <div className="space-y-2">
            <Label htmlFor="confirm-name">
              Type <span className="font-semibold text-foreground">{projectName}</span> to confirm
            </Label>
            <Input
              id="confirm-name"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={projectName}
              autoComplete="off"
              autoFocus
            />
          </div>

          {/* Keep assets toggle */}
          <label className="flex items-start gap-3 cursor-pointer select-none group">
            <input
              type="checkbox"
              checked={keepAssets}
              onChange={(e) => setKeepAssets(e.target.checked)}
              className="mt-0.5 size-4 rounded border-border accent-primary cursor-pointer"
            />
            <div className="space-y-0.5">
              <span className="text-sm font-medium">Keep generated assets</span>
              <p className="text-xs text-muted-foreground">
                Preserve image and video files on disk. Only project metadata and
                database records will be deleted.
              </p>
            </div>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!isMatch || deleting}
            onClick={handleDelete}
          >
            {deleting ? "Deleting..." : "Delete project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
