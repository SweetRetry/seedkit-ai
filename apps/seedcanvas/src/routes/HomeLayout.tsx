import { Outlet } from "@tanstack/react-router"
import { AppSidebar } from "@/components/AppSidebar"

export function HomeLayout() {
  return (
    <div className="flex h-full w-full overflow-hidden">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto bg-background">
        <Outlet />
      </main>
    </div>
  )
}
