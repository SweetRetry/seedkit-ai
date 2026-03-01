import fs from 'node:fs';
import path from 'node:path';
import { structuredPatch } from 'diff';
import type { DiffHunkLine } from './index.js';
import { buildHunkFromPatch } from './diff-utils.js';

export interface WriteDiff {
  added: number;
  removed: number;
  oldContent: string | null;
  /** Unified diff hunk lines for display in confirmation prompt */
  hunk: DiffHunkLine[];
}

const CONTEXT_LINES = 3;
const MAX_HUNK_LINES = 80;

export function computeDiff(filePath: string, newContent: string): WriteDiff {
  const abs = path.resolve(filePath);

  if (!fs.existsSync(abs)) {
    const lines = newContent.split('\n');
    // New file: show first MAX_HUNK_LINES lines as "added"
    const shown = lines.slice(0, MAX_HUNK_LINES);
    const hunk: DiffHunkLine[] = shown.map((text) => ({ kind: 'added' as const, text }));
    if (lines.length > MAX_HUNK_LINES) {
      hunk.push({ kind: 'context', text: `⋮ … ${lines.length - MAX_HUNK_LINES} more lines` });
    }
    return { added: lines.length, removed: 0, oldContent: null, hunk };
  }

  const oldContent = fs.readFileSync(abs, 'utf-8');

  const patch = structuredPatch(
    path.basename(abs),
    path.basename(abs),
    oldContent,
    newContent,
    undefined,
    undefined,
    { context: CONTEXT_LINES }
  );

  let hunk = buildHunkFromPatch(patch);
  if (hunk.length > MAX_HUNK_LINES) {
    hunk = hunk.slice(0, MAX_HUNK_LINES);
    hunk.push({ kind: 'context', text: '⋮ … diff truncated' });
  }

  // Count true added/removed lines (not context)
  const removed = hunk.filter((l) => l.kind === 'removed').length;
  const added = hunk.filter((l) => l.kind === 'added').length;

  return { added, removed, oldContent, hunk };
}

export function writeFile(filePath: string, content: string): void {
  const abs = path.resolve(filePath);
  const dir = path.dirname(abs);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}
