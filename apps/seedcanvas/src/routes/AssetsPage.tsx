import { Film, Image, Search } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { assetUrl } from "@/lib/fs"
import { listAssets, getAssetStats, type AssetRow, type AssetStats } from "@/lib/commands"
import { listRecentProjects } from "@/lib/project"
import type { RecentProject } from "@/project/types"

type TypeFilter = "all" | "image" | "video"

export function AssetsPage() {
  const [assets, setAssets] = useState<AssetRow[]>([])
  const [stats, setStats] = useState<AssetStats | null>(null)
  const [projects, setProjects] = useState<RecentProject[]>([])
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all")
  const [projectFilter, setProjectFilter] = useState<string>("")
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)

  const PAGE_SIZE = 48

  const fetchAssets = useCallback(async (reset = false) => {
    const newOffset = reset ? 0 : offset
    setLoading(true)
    try {
      const result = await listAssets({
        projectId: projectFilter || undefined,
        assetType: typeFilter === "all" ? undefined : typeFilter,
        query: search || undefined,
        limit: PAGE_SIZE,
        offset: newOffset,
      })
      if (reset) {
        setAssets(result)
        setOffset(PAGE_SIZE)
      } else {
        setAssets((prev) => [...prev, ...result])
        setOffset((prev) => prev + PAGE_SIZE)
      }
      setHasMore(result.length === PAGE_SIZE)
    } finally {
      setLoading(false)
    }
  }, [offset, projectFilter, typeFilter, search])

  // Initial load
  useEffect(() => {
    getAssetStats().then(setStats).catch(() => {})
    listRecentProjects().then(setProjects).catch(() => {})
  }, [])

  // Reload when filters change
  useEffect(() => {
    fetchAssets(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectFilter, typeFilter, search])

  const projectNameMap = new Map(projects.map((p) => [p.id, p.name]))

  return (
    <div className="h-full w-full px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Assets</h1>
          {stats && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {stats.total} total — {stats.images} images, {stats.videos} videos
              {stats.totalSize > 0 && ` — ${formatFileSize(stats.totalSize)}`}
            </p>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by prompt..."
            className="pl-9"
          />
        </div>

        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <div className="flex gap-1">
          {(["all", "image", "video"] as const).map((t) => (
            <Button
              key={t}
              variant={typeFilter === t ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setTypeFilter(t)}
              className="capitalize"
            >
              {t === "image" && <Image size={14} />}
              {t === "video" && <Film size={14} />}
              {t === "all" ? "All" : t === "image" ? "Images" : "Videos"}
            </Button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {assets.length === 0 && !loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Image size={40} className="text-muted-foreground/20 mb-3" />
          <p className="text-sm text-muted-foreground">
            {search || projectFilter || typeFilter !== "all"
              ? "No assets match your filters"
              : "No assets yet. Generate or import some!"}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4 lg:grid-cols-4 xl:grid-cols-5">
            {assets.map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                projectName={projectNameMap.get(asset.projectId)}
              />
            ))}
          </div>

          {hasMore && (
            <div className="flex justify-center mt-6">
              <Button variant="outline" onClick={() => fetchAssets(false)} disabled={loading}>
                {loading ? "Loading..." : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// AssetCard
// ---------------------------------------------------------------------------

function AssetCard({ asset, projectName }: { asset: AssetRow; projectName?: string }) {
  const src = assetUrl(asset.filePath)

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl bg-card">
      {/* Thumbnail */}
      <div className="relative aspect-square w-full overflow-hidden bg-muted">
        {asset.type === "image" ? (
          <img
            src={src}
            alt={asset.prompt || "Asset"}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Film size={32} className="text-muted-foreground/30" />
          </div>
        )}

        {/* Type badge */}
        <Badge
          variant="secondary"
          className="absolute top-2 left-2 text-[10px] uppercase"
        >
          {asset.type}
        </Badge>

        {/* Source badge */}
        {asset.source === "imported" && (
          <Badge
            variant="outline"
            className="absolute top-2 right-2 text-[10px] bg-background/80 backdrop-blur-sm"
          >
            Imported
          </Badge>
        )}
      </div>

      {/* Info */}
      <div className="flex flex-col gap-0.5 px-3 py-2">
        {asset.prompt && (
          <p className="text-xs text-foreground truncate" title={asset.prompt}>
            {asset.prompt}
          </p>
        )}
        <div className="flex items-center justify-between">
          {projectName && (
            <span className="text-[10px] text-muted-foreground truncate">{projectName}</span>
          )}
          <span className="text-[10px] text-muted-foreground">{formatDate(asset.createdAt)}</span>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffDays < 1) return "today"
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
