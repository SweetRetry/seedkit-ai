import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDiffStats } from './diffStats.js';
import type { DiffHunkLine } from './index.js';

test('counts added and removed lines', () => {
  const hunk: DiffHunkLine[] = [
    { kind: 'context', text: 'unchanged' },
    { kind: 'added', text: 'new line 1' },
    { kind: 'added', text: 'new line 2' },
    { kind: 'removed', text: 'old line' },
  ];
  assert.deepEqual(computeDiffStats(hunk), { added: 2, removed: 1 });
});

test('returns zeros for context-only hunk', () => {
  const hunk: DiffHunkLine[] = [
    { kind: 'context', text: 'line a' },
    { kind: 'context', text: 'line b' },
  ];
  assert.deepEqual(computeDiffStats(hunk), { added: 0, removed: 0 });
});

test('returns zeros for empty hunk', () => {
  assert.deepEqual(computeDiffStats([]), { added: 0, removed: 0 });
});

test('counts only added when no removals', () => {
  const hunk: DiffHunkLine[] = [
    { kind: 'added', text: 'line 1' },
    { kind: 'added', text: 'line 2' },
    { kind: 'added', text: 'line 3' },
  ];
  assert.deepEqual(computeDiffStats(hunk), { added: 3, removed: 0 });
});
