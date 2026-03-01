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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { type AppSettings, AVAILABLE_MODELS, loadSettings, saveSettings } from "@/lib/settings"

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSettingsChange: (settings: AppSettings) => void
}

export function SettingsDialog({ open, onOpenChange, onSettingsChange }: SettingsDialogProps) {
  const [apiKey, setApiKey] = useState("")
  const [baseURL, setBaseURL] = useState("")
  const [model, setModel] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    loadSettings().then((s) => {
      setApiKey(s.apiKey)
      setBaseURL(s.baseURL)
      setModel(s.model)
    })
  }, [open])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const settings: AppSettings = { apiKey, baseURL, model }
      await saveSettings(settings)
      onSettingsChange(settings)
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }, [apiKey, baseURL, model, onSettingsChange, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Configure your AI provider credentials.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="api-key">API Key</Label>
            <Input
              id="api-key"
              type="password"
              placeholder="Enter your ARK API key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="base-url">Base URL</Label>
            <Input
              id="base-url"
              type="url"
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="model">Model</Label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger id="model" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AVAILABLE_MODELS.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
