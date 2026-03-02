import { useNavigate } from "@tanstack/react-router"
import { LayoutGrid, Plus, Sparkles, Trash2 } from "lucide-react"
import { motion } from "motion/react"
import { useCallback, useEffect, useState } from "react"
import { DeleteProjectDialog } from "@/components/DeleteProjectDialog"
import { OnboardingDialog } from "@/components/OnboardingDialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { checkMcpConfig } from "@/lib/commands"
import { assetUrl } from "@/lib/fs"
import { createProject, deleteProject, listRecentProjects } from "@/lib/project"
import type { RecentProject } from "@/project/types"

// Shared easing — smooth deceleration
const ease = [0.16, 1, 0.3, 1] as const

// ---------------------------------------------------------------------------
// ProjectCard — 16:9 cover + footer
// ---------------------------------------------------------------------------

function ProjectCard({
  project,
  index,
  onOpen,
  onDelete,
}: {
  project: RecentProject
  index: number
  onOpen: (id: string) => void
  onDelete: (e: React.MouseEvent, id: string) => void
}) {
  const coverSrc = project.coverPath ? assetUrl(project.coverPath) : null

  return (
    <motion.button
      type="button"
      className="group relative flex flex-col overflow-hidden rounded-xl bg-card text-left transition-[box-shadow] duration-200 hover:ring-2 hover:ring-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
      onClick={() => onOpen(project.id)}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease, delay: 0.06 * Math.min(index, 5) }}
    >
      {/* 16:9 cover */}
      <div className="relative aspect-video w-full overflow-hidden">
        {coverSrc ? (
          <img
            src={coverSrc}
            alt={`${project.name} cover`}
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
            draggable={false}
          />
        ) : (
          <CoverPlaceholder id={project.id} />
        )}

        {/* Delete — hover reveal */}
        <Button
          variant="ghost"
          size="icon-xs"
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-background/70 backdrop-blur-sm hover:bg-destructive/10 hover:text-destructive"
          onClick={(e) => onDelete(e, project.id)}
          title="Delete project"
        >
          <Trash2 size={14} />
        </Button>
      </div>

      {/* Footer */}
      <div className="flex flex-col gap-0.5 px-3 py-2.5">
        <span className="text-sm font-medium truncate">{project.name}</span>
        <span className="text-xs text-muted-foreground">{formatDate(project.updatedAt)}</span>
      </div>
    </motion.button>
  )
}

/** Empty cover — subtle dot grid that echoes the ReactFlow canvas background */
function CoverPlaceholder({ id }: { id: string }) {
  const patternId = `cover-dots-${id}`
  return (
    <div className="relative h-full w-full bg-muted">
      <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
        <pattern id={patternId} x="0" y="0" width="16" height="16" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.75" className="fill-muted-foreground/10" />
        </pattern>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <LayoutGrid size={28} className="text-muted-foreground/20" />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty state — first-time user
// ---------------------------------------------------------------------------

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <motion.div
      className="flex flex-col items-center justify-center gap-4 py-20 text-center"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease }}
    >
      <div className="flex items-center justify-center size-12 rounded-xl bg-primary/10">
        <Sparkles size={24} className="text-primary" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-lg font-semibold">Start your first canvas</h2>
        <p className="text-sm text-muted-foreground max-w-xs mx-auto">
          Create a project to begin designing with AI
        </p>
      </div>
      <Button size="lg" onClick={onCreate} className="mt-2">
        <Plus size={18} />
        Create Project
      </Button>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// ProjectsPage
// ---------------------------------------------------------------------------

export function ProjectsPage() {
  const navigate = useNavigate()
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([])
  const [newName, setNewName] = useState("")
  const [creating, setCreating] = useState(false)
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<RecentProject | null>(null)

  const refreshProjects = useCallback(async () => {
    const projects = await listRecentProjects()
    setRecentProjects(projects)
  }, [])

  useEffect(() => {
    refreshProjects()
    // Show onboarding if MCP is not configured
    checkMcpConfig().then((status) => {
      if (!status.configured) setOnboardingOpen(true)
    }).catch(() => {
      // Ignore — don't block the UI
    })
  }, [refreshProjects])

  const handleOnboardingComplete = useCallback(async () => {
    setOnboardingOpen(false)
    const { id } = await createProject("My First Canvas")
    navigate({
      to: "/canvas/$projectId",
      params: { projectId: id },
      search: { firstRun: true },
    })
  }, [navigate])

  const handleCreate = useCallback(async () => {
    const name = newName.trim() || "Untitled"
    setCreating(true)
    try {
      const { id } = await createProject(name)
      navigate({ to: "/canvas/$projectId", params: { projectId: id }, search: { firstRun: false } })
    } finally {
      setCreating(false)
    }
  }, [newName, navigate])

  const handleOpen = useCallback(
    (id: string) => {
      navigate({ to: "/canvas/$projectId", params: { projectId: id }, search: { firstRun: false } })
    },
    [navigate]
  )

  const handleDeleteClick = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation()
      const project = recentProjects.find((p) => p.id === id)
      if (project) setDeleteTarget(project)
    },
    [recentProjects]
  )

  const handleDeleteConfirm = useCallback(
    async (options: { keepAssets: boolean }) => {
      if (!deleteTarget) return
      await deleteProject(deleteTarget.id, { keepAssets: options.keepAssets })
      setDeleteTarget(null)
      await refreshProjects()
    },
    [deleteTarget, refreshProjects]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleCreate()
    },
    [handleCreate]
  )

  const hasProjects = recentProjects.length > 0

  return (
    <div className="h-full w-full px-8 py-8">
      {/* Header + Create */}
      <div className="flex items-center justify-between gap-4 mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
        <div className="flex gap-2 max-w-sm w-full">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Project name..."
            className="flex-1"
            autoFocus
          />
          <Button onClick={handleCreate} disabled={creating}>
            <Plus size={16} />
            Create
          </Button>
        </div>
      </div>

      {/* Projects grid or empty state */}
      {hasProjects ? (
        <div className="grid grid-cols-2 gap-5 lg:grid-cols-3 xl:grid-cols-4">
          {recentProjects.map((project, i) => (
            <ProjectCard
              key={project.id}
              project={project}
              index={i}
              onOpen={handleOpen}
              onDelete={handleDeleteClick}
            />
          ))}
        </div>
      ) : (
        <EmptyState onCreate={handleCreate} />
      )}

      <OnboardingDialog
        open={onboardingOpen}
        onOpenChange={setOnboardingOpen}
        onComplete={handleOnboardingComplete}
      />

      <DeleteProjectDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        projectName={deleteTarget?.name ?? ""}
        onConfirm={handleDeleteConfirm}
      />
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
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`

  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`

  return date.toLocaleDateString()
}
