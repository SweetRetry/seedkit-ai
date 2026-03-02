import { join } from '@tauri-apps/api/path';
import { getDataDir, readJson, writeJson } from './fs';

export interface AppSettings {
  apiKey: string;
  baseURL: string;
}

const DEFAULTS: AppSettings = {
  apiKey: '',
  baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
};

async function settingsPath(): Promise<string> {
  const dataDir = await getDataDir();
  return join(dataDir, 'settings.json');
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const path = await settingsPath();
    const stored = await readJson<Partial<AppSettings>>(path);
    return { ...DEFAULTS, ...stored };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const path = await settingsPath();
  await writeJson(path, settings);
}
