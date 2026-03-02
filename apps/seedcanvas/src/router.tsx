import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router"
import { RootLayout } from "./App"
import { StartPage } from "./project/StartPage"
import { CanvasLayout } from "./routes/CanvasLayout"

// ---------------------------------------------------------------------------
// Root — renders App.css + global chrome, then child via <Outlet />
// ---------------------------------------------------------------------------

const rootRoute = createRootRoute({
  component: RootLayout,
})

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: StartPage,
})

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

const routeTree = rootRoute.addChildren([indexRoute, canvasRoute])

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
