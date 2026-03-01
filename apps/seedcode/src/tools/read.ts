import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { minimatch } from 'minimatch';
import { storeMedia } from '../media-store.js';

const DENY_LIST = [
  '**/.ssh/**',
  '**/.aws/**',
  '**/.config/**',
  '**/.env*',
];

function isDenied(filePath: string): boolean {
  const home = os.homedir();
  const abs = path.resolve(filePath);
  const rel = abs.startsWith(home) ? abs.slice(home.length + 1) : abs;
  return DENY_LIST.some((pattern) => minimatch(rel, pattern, { dot: true }));
}

/** Default: read up to 2000 lines from the start */
const DEFAULT_LIMIT = 2000;
/** Truncate any single line longer than this */
const MAX_LINE_CHARS = 2000;

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);

function mediaTypeForExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif':  return 'image/gif';
    case '.webp': return 'image/webp';
    case '.bmp':  return 'image/bmp';
    case '.svg':  return 'image/svg+xml';
    default:      return 'image/png';
  }
}

export interface ReadResult {
  content: string;
  /** Total lines in the file (not just what was returned) */
  lineCount: number;
  warning?: string;
}

export interface ReadImageResult {
  mediaId: string;
  mediaType: string;
  byteSize: number;
}

/**
 * Read a file with optional offset/limit pagination.
 *
 * - Default: returns up to 2000 lines from line 1, in cat -n format.
 * - offset: 0-based line offset to start from.
 * - limit: max number of lines to return.
 * - Lines longer than 2000 chars are truncated.
 */
export function readFile(
  filePath: string,
  offset?: number,
  limit?: number,
): ReadResult | ReadImageResult {
  const abs = path.resolve(filePath);

  if (isDenied(abs)) {
    throw new Error(`Access denied: ${filePath} is in the restricted path list.`);
  }

  if (!fs.existsSync(abs)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stat = fs.statSync(abs);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }

  const ext = path.extname(abs).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) {
    const buffer = fs.readFileSync(abs);
    const mediaType = mediaTypeForExt(ext);
    const mediaId = storeMedia({ data: buffer.toString('base64'), mediaType, byteSize: buffer.length });
    return { mediaId, mediaType, byteSize: buffer.length };
  }

  const raw = fs.readFileSync(abs, 'utf-8');
  const allLines = raw.split('\n');
  const totalLineCount = allLines.length;

  const startOffset = offset ?? 0;
  const maxLines = limit ?? DEFAULT_LIMIT;
  const sliced = allLines.slice(startOffset, startOffset + maxLines);

  // cat -n format with per-line truncation
  const numbered = sliced
    .map((line, i) => {
      const lineNo = startOffset + i + 1;
      const truncatedLine = line.length > MAX_LINE_CHARS
        ? line.slice(0, MAX_LINE_CHARS) + '… [line truncated]'
        : line;
      return `${String(lineNo).padStart(6, ' ')}\t${truncatedLine}`;
    })
    .join('\n');

  const returnedEnd = Math.min(startOffset + maxLines, totalLineCount);
  const hasMore = returnedEnd < totalLineCount;

  let warning: string | undefined;
  if (hasMore) {
    warning = `Showing lines ${startOffset + 1}-${returnedEnd} of ${totalLineCount}. Use offset=${returnedEnd} to read more.`;
  }

  return { content: numbered, lineCount: totalLineCount, warning };
}
