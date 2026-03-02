import { AlertTriangle, Check, CircleAlert, ClipboardCopy, FolderOpen, HardDrive, Loader2, Monitor, Moon, Sun, Trash2 } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  type AssetStats,
  type OrphanProject,
  checkMcpConfig,
  cleanupOrphanProjects,
  getAssetStats,
  getDataDirInfo,
  injectMcpConfig,
  resolveMcpBinaryPath,
  revealDataDir,
  scanOrphanProjects,
} from "@/lib/commands"
import { type AppSettings, loadSettings, saveSettings } from "@/lib/settings"
import { type Theme, useTheme } from "@/hooks/useTheme"

// Model options — kept in sync with Rust constants
const IMAGE_MODELS = [
  "doubao-seedream-5-0-260128",
  "doubao-seedream-5-0-lite-260128",
  "doubao-seedream-4-5-251128",
  "doubao-seedream-4-0-250828",
]

const VIDEO_MODELS = [
  "doubao-seedance-1-5-pro-251215",
  "doubao-seedance-1-0-pro-250528",
  "doubao-seedance-1-0-pro-fast-251015",
  "doubao-seedance-1-0-lite-t2v-250428",
  "doubao-seedance-1-0-lite-i2v-250428",
]

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    loadSettings().then(setSettings)
  }, [])

  const handleSave = useCallback(async () => {
    if (!settings) return
    setSaving(true)
    try {
      await saveSettings(settings)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }, [settings])

  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => prev ? { ...prev, ...patch } : prev)
    setSaved(false)
  }, [])

  if (!settings) return null

  return (
    <div className="h-full w-full px-8 py-8 max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight mb-8">Settings</h1>

      <div className="flex flex-col gap-8">
        {/* API Configuration */}
        <Section title="API Configuration" description="VolcEngine ARK credentials for image and video generation.">
          <div className="grid gap-4">
            <Field label="API Key">
              <Input
                type="password"
                placeholder="Enter your ARK API key"
                value={settings.apiKey}
                onChange={(e) => update({ apiKey: e.target.value })}
              />
            </Field>
            <Field label="Base URL">
              <Input
                type="url"
                value={settings.baseURL}
                onChange={(e) => update({ baseURL: e.target.value })}
              />
            </Field>
            <Field label="Default Image Model">
              <select
                value={settings.defaultImageModel || IMAGE_MODELS[0]}
                onChange={(e) => update({ defaultImageModel: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {IMAGE_MODELS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </Field>
            <Field label="Default Video Model">
              <select
                value={settings.defaultVideoModel || VIDEO_MODELS[0]}
                onChange={(e) => update({ defaultVideoModel: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {VIDEO_MODELS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </Field>
          </div>
        </Section>

        <Separator />

        {/* MCP Configuration */}
        <McpSection />

        <Separator />

        {/* Appearance */}
        <AppearanceSection />

        <Separator />

        {/* Storage */}
        <StorageSection />
      </div>

      {/* Save bar */}
      <div className="sticky bottom-0 flex items-center gap-3 py-6 bg-background">
        <Button onClick={handleSave} disabled={saving || saved}>
          {saving ? (
            <><Loader2 size={14} className="animate-spin" /> Saving...</>
          ) : saved ? (
            <><Check size={14} /> Saved</>
          ) : (
            "Save changes"
          )}
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section components
// ---------------------------------------------------------------------------

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">{title}</h2>
      {description && <p className="text-sm text-muted-foreground mb-4">{description}</p>}
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-sm">{label}</Label>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// MCP Configuration
// ---------------------------------------------------------------------------

function McpSection() {
  const [binaryPath, setBinaryPath] = useState("")
  const [mcpConfigured, setMcpConfigured] = useState(false)
  const [mcpCurrentPath, setMcpCurrentPath] = useState<string | null>(null)
  const [injecting, setInjecting] = useState(false)
  const [injected, setInjected] = useState(false)
  const [mcpError, setMcpError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    resolveMcpBinaryPath().then(setBinaryPath).catch(() => {})
    checkMcpConfig()
      .then((status) => {
        setMcpConfigured(status.configured)
        setMcpCurrentPath(status.currentPath)
      })
      .catch(() => {})
  }, [])

  const mcpSnippet = JSON.stringify(
    { mcpServers: { seedcanvas: { command: binaryPath || "/path/to/seedcanvas-mcp", args: [] } } },
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
      await injectMcpConfig(binaryPath)
      setInjected(true)
      setMcpConfigured(true)
    } catch (e) {
      setMcpError(String(e))
    } finally {
      setInjecting(false)
    }
  }, [binaryPath])

  return (
    <Section title="MCP Configuration" description="Connect SeedCanvas to Claude Code as an MCP server.">
      <div className="grid gap-4">
        {/* Status */}
        {mcpConfigured && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Check size={14} className="text-green-500 shrink-0" />
            Configured
            {mcpCurrentPath && <span className="truncate text-xs">({mcpCurrentPath})</span>}
          </div>
        )}

        {/* Snippet */}
        <div className="relative">
          <pre className="rounded-md bg-muted p-3 text-xs font-mono overflow-x-auto max-h-32 leading-relaxed">
            {mcpSnippet}
          </pre>
          <Button
            variant="ghost"
            size="icon-xs"
            className="absolute top-2 right-2"
            onClick={handleCopySnippet}
          >
            {copied ? <Check size={12} className="text-green-500" /> : <ClipboardCopy size={12} />}
          </Button>
        </div>

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

        {!injected && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleAutoConfig}
            disabled={injecting || !binaryPath}
            className="w-fit"
          >
            {injecting && <Loader2 size={14} className="animate-spin" />}
            {injecting ? "Configuring..." : "Auto-configure"}
          </Button>
        )}
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

function AppearanceSection() {
  const { theme, setTheme } = useTheme()

  const options: { value: Theme; label: string; icon: React.ReactNode }[] = [
    { value: "system", label: "System", icon: <Monitor size={14} /> },
    { value: "light", label: "Light", icon: <Sun size={14} /> },
    { value: "dark", label: "Dark", icon: <Moon size={14} /> },
  ]

  return (
    <Section title="Appearance" description="Choose how SeedCanvas looks.">
      <div className="flex gap-2">
        {options.map(({ value, label, icon }) => (
          <Button
            key={value}
            variant={theme === value ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setTheme(value)}
          >
            {icon}
            {label}
          </Button>
        ))}
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function StorageSection() {
  const [dataDir, setDataDir] = useState("")
  const [dbSize, setDbSize] = useState(0)
  const [assetStats, setAssetStats] = useState<AssetStats | null>(null)
  const [orphans, setOrphans] = useState<OrphanProject[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const [cleaning, setCleaning] = useState(false)

  useEffect(() => {
    getDataDirInfo()
      .then((info) => {
        setDataDir(info.dataDir)
        setDbSize(info.dbSize)
      })
      .catch(() => {})
    getAssetStats().then(setAssetStats).catch(() => {})
  }, [])

  const handleScan = useCallback(async () => {
    setScanning(true)
    try {
      const result = await scanOrphanProjects()
      setOrphans(result)
    } catch {
      setOrphans([])
    } finally {
      setScanning(false)
    }
  }, [])

  const handleCleanup = useCallback(async () => {
    if (!orphans || orphans.length === 0) return
    setCleaning(true)
    try {
      await cleanupOrphanProjects(orphans.map((o) => o.id))
      setOrphans([])
    } catch {
      // ignore
    } finally {
      setCleaning(false)
    }
  }, [orphans])

  const totalOrphanSize = orphans?.reduce((sum, o) => sum + o.sizeBytes, 0) ?? 0

  return (
    <Section title="Storage" description="All generated and imported assets are stored locally. Large projects can consume significant disk space.">
      <div className="grid gap-3">
        <div className="flex items-center gap-3 text-sm">
          <HardDrive size={16} className="text-muted-foreground shrink-0" />
          <span className="text-muted-foreground">Data directory:</span>
          <code className="text-xs bg-muted px-2 py-0.5 rounded truncate">{dataDir}</code>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <HardDrive size={16} className="text-muted-foreground shrink-0" />
          <span className="text-muted-foreground">Database size:</span>
          <span className="text-sm">{formatFileSize(dbSize)}</span>
        </div>
        {assetStats && (
          <div className="flex items-center gap-3 text-sm">
            <HardDrive size={16} className="text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">Assets:</span>
            <span className="text-sm">
              {assetStats.total} files ({assetStats.images} images, {assetStats.videos} videos)
              {assetStats.totalSize > 0 && ` — ${formatFileSize(assetStats.totalSize)}`}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2 mt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => revealDataDir().catch(() => {})}
          >
            <FolderOpen size={14} />
            Open in Finder
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleScan}
            disabled={scanning}
          >
            {scanning ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />}
            {scanning ? "Scanning..." : "Scan orphan directories"}
          </Button>
        </div>

        {/* Orphan scan results */}
        {orphans !== null && (
          <div className="mt-2 rounded-md border p-3 space-y-2">
            {orphans.length === 0 ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Check size={14} className="text-green-500" />
                No orphan directories found.
              </p>
            ) : (
              <>
                <p className="text-sm font-medium flex items-center gap-2">
                  <AlertTriangle size={14} className="text-amber-500" />
                  Found {orphans.length} orphan {orphans.length === 1 ? "directory" : "directories"} ({formatFileSize(totalOrphanSize)})
                </p>
                <div className="space-y-1">
                  {orphans.map((o) => (
                    <div key={o.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <code className="bg-muted px-1.5 py-0.5 rounded">{o.id}</code>
                      <span>{formatFileSize(o.sizeBytes)}</span>
                      {o.hasAssets && <span className="text-amber-600">has assets</span>}
                    </div>
                  ))}
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleCleanup}
                  disabled={cleaning}
                  className="mt-1"
                >
                  {cleaning ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  {cleaning ? "Cleaning up..." : `Delete ${orphans.length} orphan ${orphans.length === 1 ? "directory" : "directories"}`}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
