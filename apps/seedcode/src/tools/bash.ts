import { execSync } from 'node:child_process';

const DENYLIST_PATTERNS = [
  /rm\s+-rf\s+\/(?:\s|$)/,
  /rm\s+-rf\s+~(?:\s|$)/,
  /rm\s+-rf\s+\$HOME(?:\s|$)/,
  /curl[^|]+\|\s*(?:ba)?sh/,
  /wget[^|]+\|\s*(?:ba)?sh/,
  /:\s*\(\s*\)\s*\{.*:\|:&?\s*\}.*:/, // fork bomb
  />\s*\/dev\/sd[a-z]/,
  /mkfs\./,
  /dd\s+if=.+of=\/dev\//,
];

const TRUNCATE_HEAD = 100;
const TRUNCATE_TAIL = 50;

/**
 * Truncate bash output to keep first 100 + last 50 lines.
 * Injects a marker showing how many lines were dropped.
 */
export function truncateBashOutput(output: string): string {
  if (!output) return output;
  const lines = output.split('\n');
  const total = lines.length;
  if (total <= TRUNCATE_HEAD + TRUNCATE_TAIL) return output;

  const dropped = total - TRUNCATE_HEAD - TRUNCATE_TAIL;
  return [
    ...lines.slice(0, TRUNCATE_HEAD),
    `... ${dropped} lines truncated ...`,
    ...lines.slice(total - TRUNCATE_TAIL),
  ].join('\n');
}

export interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function runBash(command: string, cwd?: string): BashResult {
  const baseCwd = cwd ?? process.cwd();

  // Denylist check — catastrophic-only patterns
  for (const pattern of DENYLIST_PATTERNS) {
    if (pattern.test(command)) {
      throw new Error(`Command blocked by security policy: ${command}`);
    }
  }

  try {
    const stdout = execSync(command, {
      cwd: baseCwd,
      encoding: 'utf-8',
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024, // 10 MB
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number; message?: string };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message ?? String(err),
      exitCode: e.status ?? 1,
    };
  }
}
