import fs from 'node:fs';
import path from 'node:path';

export interface MentionResult {
  /** Original text with successfully resolved @mentions replaced by [filename] */
  cleanText: string;
  /** Files that were successfully read */
  injected: Array<{ path: string; content: string; lineCount: number }>;
}

/**
 * Parse @path tokens from text, attempt to read each file, and return:
 * - `cleanText`: text with resolved mentions replaced by `[filename]`
 * - `injected`: list of successfully read files with their content
 *
 * Mentions that cannot be resolved (file not found / not a file) are left as-is in cleanText.
 */
export function resolveMentions(text: string, cwd: string): MentionResult {
  const injected: MentionResult['injected'] = [];
  // Track paths already injected to avoid duplicates
  const seen = new Set<string>();

  const cleanText = text.replace(/@([\S]+)/g, (match, rawPath: string) => {
    const abs = path.isAbsolute(rawPath)
      ? rawPath
      : path.join(cwd, rawPath);

    if (seen.has(abs)) {
      // Already injected — just strip the @mention
      return `[${path.basename(abs)}]`;
    }

    try {
      if (!fs.existsSync(abs)) return match;
      const stat = fs.statSync(abs);
      if (!stat.isFile()) return match;

      const content = fs.readFileSync(abs, 'utf-8');
      const lineCount = content.split('\n').length;
      injected.push({ path: abs, content, lineCount });
      seen.add(abs);
      return `[${path.basename(abs)}]`;
    } catch {
      // Unreadable — leave original mention untouched
      return match;
    }
  });

  return { cleanText, injected };
}
