import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

export type Theme = "system" | "light" | "dark"
type ResolvedTheme = "light" | "dark"

interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
  resolvedTheme: ResolvedTheme
}

const STORAGE_KEY = "seedcanvas-theme"
const MEDIA_QUERY = "(prefers-color-scheme: dark)"

const ThemeContext = createContext<ThemeContextValue | null>(null)

function getStoredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === "light" || stored === "dark" || stored === "system") return stored
  return "system"
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia(MEDIA_QUERY).matches ? "dark" : "light"
}

function applyThemeToDOM(resolved: ResolvedTheme) {
  document.documentElement.classList.toggle("dark", resolved === "dark")
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme)
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme)

  // Listen for OS preference changes
  useEffect(() => {
    const mq = window.matchMedia(MEDIA_QUERY)
    const handler = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? "dark" : "light")
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  const resolvedTheme: ResolvedTheme = theme === "system" ? systemTheme : theme

  // Apply class + persist whenever resolved theme changes
  useEffect(() => {
    applyThemeToDOM(resolvedTheme)
  }, [resolvedTheme])

  const setTheme = useCallback((next: Theme) => {
    localStorage.setItem(STORAGE_KEY, next)
    setThemeState(next)
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, resolvedTheme }),
    [theme, setTheme, resolvedTheme]
  )

  return <ThemeContext value={value}>{children}</ThemeContext>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used within <ThemeProvider>")
  return ctx
}
