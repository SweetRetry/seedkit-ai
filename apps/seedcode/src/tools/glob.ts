import { glob as globAsync } from 'glob';
import path from 'node:path';
import { execFile } from 'node:child_process';

const MAX_FILES = 200;

export interface GlobResult {
  files: string[];
  count: number;
  totalCount: number;
  truncated: boolean;
}

export async function globFiles(pattern: string, cwd?: string): Promise<GlobResult> {
  const baseCwd = cwd ?? process.cwd();
  const files = await globAsync(pattern, {
    cwd: baseCwd,
    dot: false,
    nodir: true,
  });

  const sorted = files.sort().map((f) => path.join(baseCwd, f));
  const totalCount = sorted.length;
  const truncated = totalCount > MAX_FILES;
  return {
    files: truncated ? sorted.slice(0, MAX_FILES) : sorted,
    count: Math.min(totalCount, MAX_FILES),
    totalCount,
    truncated,
  };
}

/**
 * Search tracked (non-gitignored) files matching a substring.
 * Uses `git ls-files` so .gitignore rules are automatically respected.
 * Falls back to basic glob with a hardcoded ignore list outside git repos.
 */
export async function searchTrackedFiles(query: string, cwd: string, limit = 8): Promise<string[]> {
  try {
    const files = await gitLsFiles(cwd);
    const lowerQuery = query.toLowerCase();
    return files
      .filter((f) => f.toLowerCase().includes(lowerQuery))
      .slice(0, limit);
  } catch {
    // Not a git repo — fall back to glob with common excludes
    const FALLBACK_IGNORE = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/.next/**', '**/coverage/**', '**/.turbo/**'];
    const files = await globAsync(`**/*${query}*`, { cwd, ignore: FALLBACK_IGNORE, dot: false, nodir: true });
    return files.sort().slice(0, limit);
  }
}

function gitLsFiles(cwd: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout.split('\n').filter(Boolean));
    });
  });
}
