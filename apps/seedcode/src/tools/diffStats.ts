import type { DiffHunkLine } from './index.js';

export function computeDiffStats(hunk: DiffHunkLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of hunk) {
    if (line.kind === 'added') added++;
    else if (line.kind === 'removed') removed++;
  }
  return { added, removed };
}
