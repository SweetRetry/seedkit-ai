import fs from 'node:fs';
import path from 'node:path';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);

export interface InjectedFile {
  path: string;
  content: string;
  lineCount: number;
}

export interface MentionResult {
  /** Original text with successfully resolved @mentions replaced by [filename] or image hint */
  cleanText: string;
  /** Text files that were successfully read */
  injected: InjectedFile[];
}

/**
 * Parse @path tokens from text, resolve files, and return:
 * - `cleanText`: text with resolved mentions replaced by `[filename]`
 * - `injected`: text files with their content
 *
 * Image files are NOT pre-loaded — a hint is embedded in cleanText so the
 * agent can call the `read` tool on demand (which routes through MediaStore,
 * same as the screenshot flow).
 *
 * Mentions that cannot be resolved are left as-is in cleanText.
 */
export function resolveMentions(text: string, cwd: string): MentionResult {
  const injected: InjectedFile[] = [];
  const seen = new Set<string>();

  const cleanText = text.replace(/@([\S]+)/g, (match, rawPath: string) => {
    const abs = path.isAbsolute(rawPath)
      ? rawPath
      : path.join(cwd, rawPath);

    if (seen.has(abs)) return `[${path.basename(abs)}]`;

    try {
      if (!fs.existsSync(abs)) return match;
      const stat = fs.statSync(abs);
      if (!stat.isFile()) return match;

      seen.add(abs);
      const ext = path.extname(abs).toLowerCase();

      if (IMAGE_EXTENSIONS.has(ext)) {
        // Image: embed a path hint — agent loads via read tool → MediaStore → auto-injected next turn
        return `[image: ${abs} — use read("${abs}") to view it]`;
      }

      const content = fs.readFileSync(abs, 'utf-8');
      const lineCount = content.split('\n').length;
      injected.push({ path: abs, content, lineCount });
      return `[${path.basename(abs)}]`;
    } catch {
      return match;
    }
  });

  return { cleanText, injected };
}
