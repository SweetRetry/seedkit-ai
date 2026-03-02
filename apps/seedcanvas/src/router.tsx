import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router"
import { RootLayout } from "./App"
import { HomeLayout } from "./routes/HomeLayout"
import { ProjectsPage } from "./routes/ProjectsPage"
import { AssetsPage } from "./routes/AssetsPage"
import { SettingsPage } from "./routes/SettingsPage"
import { UsagePage } from "./routes/UsagePage"
import { CanvasLayout } from "./routes/CanvasLayout"

// ---------------------------------------------------------------------------
// Root — renders App.css + global chrome, then child via <Outlet />
// ---------------------------------------------------------------------------

const rootRoute = createRootRoute({
  component: RootLayout,
})

// ---------------------------------------------------------------------------
// Home layout — sidebar + content area
// ---------------------------------------------------------------------------

const homeLayoutRoute = createRoute({
  id: "home",
  getParentRoute: () => rootRoute,
  component: HomeLayout,
})

// ---------------------------------------------------------------------------
// Home child routes
// ---------------------------------------------------------------------------

const projectsRoute = createRoute({
  getParentRoute: () => homeLayoutRoute,
  path: "/",
  component: ProjectsPage,
})

const assetsRoute = createRoute({
  getParentRoute: () => homeLayoutRoute,
  path: "/assets",
  component: AssetsPage,
})

const settingsRoute = createRoute({
  getParentRoute: () => homeLayoutRoute,
  path: "/settings",
  component: SettingsPage,
})

const usageRoute = createRoute({
  getParentRoute: () => homeLayoutRoute,
  path: "/usage",
  component: UsagePage,
})

// ---------------------------------------------------------------------------
// Canvas route (no sidebar)
// ---------------------------------------------------------------------------

const canvasRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/canvas/$projectId",
  component: CanvasLayout,
  validateSearch: (search: Record<string, unknown>) => ({
    firstRun: search.firstRun === true || search.firstRun === "true",
  }),
})

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const routeTree = rootRoute.addChildren([
  homeLayoutRoute.addChildren([projectsRoute, assetsRoute, settingsRoute, usageRoute]),
  canvasRoute,
])

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
})

// ---------------------------------------------------------------------------
// Type-safe registration
// ---------------------------------------------------------------------------

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
