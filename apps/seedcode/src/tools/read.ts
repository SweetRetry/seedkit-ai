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

const LARGE_FILE_WARN_LINES = 500;
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
  lineCount: number;
  warning?: string;
}

export interface ReadImageResult {
  mediaId: string;
  mediaType: string;
  byteSize: number;
}

export function readFile(filePath: string): ReadResult | ReadImageResult {
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

  const content = fs.readFileSync(abs, 'utf-8');
  const lineCount = content.split('\n').length;

  const warning =
    lineCount > LARGE_FILE_WARN_LINES
      ? `Large file: ${lineCount} lines. Consider reading a specific line range if you only need part of it.`
      : undefined;

  return { content, lineCount, warning };
}
