import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface DiagnosticResult {
  tool: string;
  output: string;
  exitCode: number;
}

function run(cmd: string, cwd: string): { output: string; exitCode: number } {
  try {
    const stdout = execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { output: stdout.trim(), exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    const output = [e.stdout, e.stderr].filter(Boolean).join('\n').trim();
    return { output, exitCode: e.status ?? 1 };
  }
}

function truncate(s: string, maxLines = 50): string {
  const lines = s.split('\n');
  if (lines.length <= maxLines) return s;
  return lines.slice(0, maxLines).join('\n') + `\n… (${lines.length - maxLines} more lines)`;
}

/**
 * Detect and run available diagnostics for the changed file.
 * Returns only tools that are available AND produced output (errors/warnings).
 * Silent on success to avoid spamming the model with no-op results.
 */
export function runDiagnostics(changedFile: string, cwd: string): DiagnosticResult[] {
  const results: DiagnosticResult[] = [];
  const ext = path.extname(changedFile);
  const isTS = ext === '.ts' || ext === '.tsx';
  const isJS = ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs';

  // ── TypeScript ────────────────────────────────────────────────────────
  if (isTS && fs.existsSync(path.join(cwd, 'tsconfig.json'))) {
    const { output, exitCode } = run('pnpm exec tsc --noEmit --pretty false 2>&1 || true', cwd);
    if (exitCode !== 0 || output) {
      results.push({ tool: 'tsc', output: truncate(output) || '(no output)', exitCode });
    }
  }

  // ── ESLint ────────────────────────────────────────────────────────────
  const hasEslint =
    fs.existsSync(path.join(cwd, '.eslintrc.js')) ||
    fs.existsSync(path.join(cwd, '.eslintrc.cjs')) ||
    fs.existsSync(path.join(cwd, '.eslintrc.json')) ||
    fs.existsSync(path.join(cwd, '.eslintrc.yaml')) ||
    fs.existsSync(path.join(cwd, 'eslint.config.js')) ||
    fs.existsSync(path.join(cwd, 'eslint.config.mjs'));

  if ((isTS || isJS) && hasEslint) {
    const rel = path.relative(cwd, changedFile);
    const { output, exitCode } = run(`pnpm exec eslint --max-warnings=0 "${rel}" 2>&1 || true`, cwd);
    if (exitCode !== 0 || output) {
      results.push({ tool: 'eslint', output: truncate(output) || '(no output)', exitCode });
    }
  }

  return results;
}

/**
 * Format diagnostic results into a compact summary appended to tool output.
 * Returns empty string if there are no issues.
 */
export function formatDiagnostics(results: DiagnosticResult[]): string {
  if (results.length === 0) return '';
  const lines = ['\n\n--- Diagnostics ---'];
  for (const r of results) {
    const status = r.exitCode === 0 ? '✓' : '✗';
    lines.push(`${status} ${r.tool}:\n${r.output}`);
  }
  return lines.join('\n');
}
