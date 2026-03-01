import { join } from "@tauri-apps/api/path"
import { getDataDir, readJson, writeJson } from "./fs"

export interface AppSettings {
  apiKey: string
  baseURL: string
  model: string
}

const DEFAULTS: AppSettings = {
  apiKey: "",
  baseURL: "https://ark.cn-beijing.volces.com/api/v3",
  model: "doubao-seed-1-8-251228",
}

export const AVAILABLE_MODELS = [
  { id: "doubao-seed-1-8-251228", label: "Seed 1.8 (2025-12-28)" },
  { id: "doubao-1-5-thinking-pro-250415", label: "Doubao 1.5 Thinking Pro" },
  { id: "doubao-1-5-thinking-lite-250415", label: "Doubao 1.5 Thinking Lite" },
  { id: "doubao-1-5-pro-256k-250115", label: "Doubao 1.5 Pro 256K" },
] as const

async function settingsPath(): Promise<string> {
  const dataDir = await getDataDir()
  return join(dataDir, "settings.json")
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const path = await settingsPath()
    const stored = await readJson<Partial<AppSettings>>(path)
    return { ...DEFAULTS, ...stored }
  } catch {
    return { ...DEFAULTS }
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const path = await settingsPath()
  await writeJson(path, settings)
}
