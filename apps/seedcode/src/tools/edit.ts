import fs from 'node:fs';
import path from 'node:path';
import { structuredPatch } from 'diff';
import type { DiffHunkLine } from './index.js';
import { buildHunkFromPatch } from './diff-utils.js';

export interface EditDiff {
  hunk: DiffHunkLine[];
}

export interface EditResult {
  success: true;
  message: string;
}

export interface EditError {
  error: string;
}

const CONTEXT_LINES = 3;

/**
 * Compute a unified diff hunk to show in the confirmation prompt.
 */
export function computeEditDiff(
  filePath: string,
  oldString: string,
  newString: string
): EditDiff | EditError {
  const abs = path.resolve(filePath);

  if (!fs.existsSync(abs)) {
    return { error: `File not found: ${filePath}` };
  }

  const content = fs.readFileSync(abs, 'utf-8');

  const occurrences = content.split(oldString).length - 1;
  if (occurrences === 0) {
    return { error: `old_string not found in ${filePath}` };
  }
  if (occurrences > 1) {
    return {
      error: `old_string matches ${occurrences} locations in ${filePath} — must match exactly once. Add more context around the target section.`,
    };
  }

  const newContent = content.replace(oldString, newString);
  const patch = structuredPatch(
    path.basename(abs),
    path.basename(abs),
    content,
    newContent,
    undefined,
    undefined,
    { context: CONTEXT_LINES }
  );

  return { hunk: buildHunkFromPatch(patch) };
}

/**
 * Apply the edit to disk (call only after user confirms).
 */
export function applyEdit(filePath: string, oldString: string, newString: string): EditResult | EditError {
  const abs = path.resolve(filePath);

  if (!fs.existsSync(abs)) {
    return { error: `File not found: ${filePath}` };
  }

  const content = fs.readFileSync(abs, 'utf-8');
  const occurrences = content.split(oldString).length - 1;

  if (occurrences !== 1) {
    return { error: `Patch cannot be applied: old_string matches ${occurrences} location(s).` };
  }

  const newContent = content.replace(oldString, newString);
  fs.writeFileSync(abs, newContent, 'utf-8');

  const removed = oldString.split('\n').length;
  const added = newString.split('\n').length;

  return {
    success: true,
    message: `Edited ${filePath} (+${added} / -${removed} lines)`,
  };
}
