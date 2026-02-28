import fs from 'node:fs';
import path from 'node:path';
import { structuredPatch } from 'diff';
import type { DiffHunkLine } from './index.js';

export interface WriteDiff {
  added: number;
  removed: number;
  oldContent: string | null;
  /** Unified diff hunk lines for display in confirmation prompt */
  hunk: DiffHunkLine[];
}

const CONTEXT_LINES = 3;
const MAX_HUNK_LINES = 80;

function buildHunkFromPatch(patch: ReturnType<typeof structuredPatch>): DiffHunkLine[] {
  const lines: DiffHunkLine[] = [];

  for (const hunk of patch.hunks) {
    if (lines.length > 0) {
      lines.push({ kind: 'context', text: '⋮' });
    }

    let lineNo = hunk.oldStart;
    for (const line of hunk.lines) {
      const prefix = line[0];
      const text = line.slice(1);
      if (prefix === ' ') {
        lines.push({ kind: 'context', text, lineNo });
        lineNo++;
      } else if (prefix === '-') {
        lines.push({ kind: 'removed', text, lineNo });
        lineNo++;
      } else if (prefix === '+') {
        lines.push({ kind: 'added', text });
        // lineNo not incremented — this line doesn't exist in old file
      }
    }
  }

  return lines;
}

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
