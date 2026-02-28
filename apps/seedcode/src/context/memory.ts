import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SEEDCODE_DIR = path.join(os.homedir(), '.seedcode');
const MAX_MEMORY_CHARS = 32_000; // ~8k tokens

/** Convert an absolute CWD path to the directory slug, e.g. /Users/foo/proj → -Users-foo-proj */
function cwdSlug(cwd: string): string {
  return cwd.replace(/\//g, '-');
}

export function memoryDir(cwd: string): string {
  return path.join(SEEDCODE_DIR, 'projects', cwdSlug(cwd), 'memory');
}

export function memoryFilePath(cwd: string): string {
  return path.join(memoryDir(cwd), 'MEMORY.md');
}

export interface MemoryResult {
  content: string | null;
  filePath: string;
}

/**
 * Load the project memory file (~/.seedcode/projects/{cwd-slug}/memory/MEMORY.md).
 * Returns null content if the file doesn't exist.
 * Truncates at MAX_MEMORY_CHARS to keep token budget bounded.
 */
export function loadMemory(cwd: string): MemoryResult {
  const filePath = memoryFilePath(cwd);
  try {
    let content = fs.readFileSync(filePath, 'utf-8');
    if (content.length > MAX_MEMORY_CHARS) {
      content = content.slice(0, MAX_MEMORY_CHARS) + '\n\n[Memory truncated — file exceeds 8k token budget.]';
    }
    return { content, filePath };
  } catch {
    return { content: null, filePath };
  }
}

/** Ensure the memory directory exists (called before writing). */
export function ensureMemoryDir(cwd: string): void {
  fs.mkdirSync(memoryDir(cwd), { recursive: true });
}
