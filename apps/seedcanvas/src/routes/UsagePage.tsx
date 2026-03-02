import { BarChart3, CheckCircle2, Film, Image, XCircle } from "lucide-react"
import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { getUsageStats, type UsageStats } from "@/lib/commands"

export function UsagePage() {
  const [stats, setStats] = useState<UsageStats | null>(null)

  useEffect(() => {
    getUsageStats().then(setStats).catch(() => {})
  }, [])

  if (!stats) return null

  const successRate = stats.totalTasks > 0
    ? Math.round((stats.succeeded / stats.totalTasks) * 100)
    : 0

  const maxDailyCount = Math.max(1, ...stats.dailyCounts.map((d) => d.count))

  return (
    <div className="h-full w-full px-8 py-8">
      <h1 className="text-2xl font-bold tracking-tight mb-8">API Usage</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 mb-8">
        <StatCard
          icon={<BarChart3 size={18} />}
          label="Total Generations"
          value={stats.totalTasks}
        />
        <StatCard
          icon={<Image size={18} />}
          label="Images"
          value={stats.imagesGenerated}
        />
        <StatCard
          icon={<Film size={18} />}
          label="Videos"
          value={stats.videosGenerated}
        />
        <StatCard
          icon={<CheckCircle2 size={18} />}
          label="Success Rate"
          value={`${successRate}%`}
        />
      </div>

      {/* Daily chart — last 30 days */}
      {stats.dailyCounts.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-medium text-muted-foreground mb-3">
            Daily generations (last 30 days)
          </h2>
          <div className="flex items-end gap-1 h-32">
            {stats.dailyCounts.map((day) => (
              <div
                key={day.date}
                className="group relative flex-1 min-w-0"
                title={`${day.date}: ${day.count}`}
              >
                <div
                  className="w-full rounded-t bg-primary/80 transition-colors group-hover:bg-primary"
                  style={{ height: `${(day.count / maxDailyCount) * 100}%`, minHeight: day.count > 0 ? 4 : 0 }}
                />
                {/* Tooltip on hover */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block whitespace-nowrap bg-popover text-popover-foreground text-[10px] px-1.5 py-0.5 rounded shadow-sm border">
                  {day.date}: {day.count}
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-[10px] text-muted-foreground">
              {stats.dailyCounts[0]?.date}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {stats.dailyCounts[stats.dailyCounts.length - 1]?.date}
            </span>
          </div>
        </div>
      )}

      {/* Recent tasks */}
      {stats.recentTasks.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">Recent tasks</h2>
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Type</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Prompt</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Date</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentTasks.map((task) => {
                  let prompt = ""
                  try {
                    prompt = JSON.parse(task.input)?.prompt || ""
                  } catch { /* empty */ }

                  return (
                    <tr key={task.id} className="border-b last:border-b-0">
                      <td className="px-4 py-2.5">
                        <Badge variant="outline" className="capitalize text-[10px]">
                          {task.type === "image" ? <Image size={10} className="mr-1" /> : <Film size={10} className="mr-1" />}
                          {task.type}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusBadge status={task.status} />
                      </td>
                      <td className="px-4 py-2.5 max-w-xs truncate text-muted-foreground" title={prompt}>
                        {prompt || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                        {formatDate(task.created_at)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {stats.totalTasks === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <BarChart3 size={40} className="text-muted-foreground/20 mb-3" />
          <p className="text-sm text-muted-foreground">
            No generation history yet. Start creating!
          </p>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-4">
      <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold tracking-tight">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "done":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-green-600">
          <CheckCircle2 size={12} /> Done
        </span>
      )
    case "failed":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-destructive">
          <XCircle size={12} /> Failed
        </span>
      )
    case "running":
      return <span className="text-xs text-blue-500">Running</span>
    default:
      return <span className="text-xs text-muted-foreground capitalize">{status}</span>
  }
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

  return date.toLocaleDateString()
}
