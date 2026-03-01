import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigSchema, DEFAULT_MODEL, type Config, type Plan } from './schema.js';

export interface CliFlags {
  model?: string;
  apiKey?: string;
  thinking?: boolean;
  plan?: Plan;
}

const CONFIG_DIR = path.join(os.homedir(), '.seedcode');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

type StoredConfig = Partial<Pick<Config, 'apiKey' | 'model' | 'thinking' | 'plan'>>;

function read(): StoredConfig {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function write(data: StoredConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

export function loadConfig(flags: CliFlags = {}): Config {
  const stored = read();
  const apiKey = flags.apiKey || process.env.ARK_API_KEY || stored.apiKey;

  return ConfigSchema.parse({
    apiKey: apiKey ?? undefined,
    model: flags.model ?? stored.model ?? DEFAULT_MODEL,
    thinking: flags.thinking ?? stored.thinking ?? false,
    plan: flags.plan ?? stored.plan ?? 'api',
  });
}

export function saveApiKey(apiKey: string): void {
  write({ ...read(), apiKey });
}
