import { Link, useMatchRoute } from "@tanstack/react-router"
import { BarChart3, FolderKanban, Image, Moon, Settings, Sun } from "lucide-react"
import { useTheme } from "@/hooks/useTheme"
import { Button } from "@/components/ui/button"

const NAV_ITEMS = [
  { to: "/", icon: FolderKanban, label: "Projects" },
  { to: "/assets", icon: Image, label: "Assets" },
  { to: "/usage", icon: BarChart3, label: "Usage" },
] as const

export function AppSidebar() {
  const matchRoute = useMatchRoute()
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar-background text-sidebar-foreground">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex size-7 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
          <span className="text-xs font-bold">S</span>
        </div>
        <span className="text-sm font-semibold tracking-tight">SeedCanvas</span>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-1 px-3">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => {
          const active = !!matchRoute({ to, fuzzy: false })
          return (
            <Link
              key={to}
              to={to}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              }`}
            >
              <Icon size={18} />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="flex flex-col gap-1 border-t border-sidebar-border px-3 py-3">
        <Link
          to="/settings"
          className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            matchRoute({ to: "/settings" })
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
          }`}
        >
          <Settings size={18} />
          Settings
        </Link>

        <div className="flex items-center justify-between px-3 py-1.5">
          <span className="text-xs text-sidebar-foreground/50">Theme</span>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            className="text-sidebar-foreground/60 hover:text-sidebar-foreground"
          >
            {resolvedTheme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          </Button>
        </div>
      </div>
    </aside>
  )
}
