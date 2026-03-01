import { render } from 'markdansi';

/**
 * Render a Markdown string to ANSI-coloured terminal text.
 * Uses markdansi — zero-dependency GFM renderer with proper nested lists,
 * code block highlighting, tables, and link support.
 * Falls back to the raw string if parsing throws.
 */
export function renderMarkdown(text: string): string {
  try {
    return render(text, { width: process.stdout.columns || 80 });
  } catch {
    return text;
  }
}
