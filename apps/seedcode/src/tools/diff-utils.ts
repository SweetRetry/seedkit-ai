import { structuredPatch } from 'diff';
import type { DiffHunkLine } from './index.js';

/**
 * Convert a structured patch into an array of hunk lines for display.
 * Shared by edit.ts and write.ts for confirmation prompt rendering.
 */
export function buildHunkFromPatch(patch: ReturnType<typeof structuredPatch>): DiffHunkLine[] {
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
      }
    }
  }

  return lines;
}
