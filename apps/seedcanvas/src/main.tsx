import { RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@fontsource/geist-sans/400.css"
import "@fontsource/geist-sans/500.css"
import "@fontsource/geist-sans/600.css"
import "@fontsource/geist-sans/700.css"
import "@fontsource/geist-mono/400.css"
import "@fontsource/geist-mono/700.css"
import { ThemeProvider } from "./providers/ThemeProvider"
import { router } from "./router"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  </StrictMode>
)
