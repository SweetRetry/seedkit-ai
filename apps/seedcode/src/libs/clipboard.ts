import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { storeMedia } from '../media-store.js';

export interface ClipboardImageResult {
  mediaId: string;
  byteSize: number;
  tmpPath: string;
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

function mediaTypeForExt(ext: string): string {
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.bmp') return 'image/bmp';
  return 'image/png';
}

/**
 * Load an image from a file path into MediaStore.
 * Returns ClipboardImageResult or null if the path is not a readable image file.
 */
export function loadImageFromPath(filePath: string): ClipboardImageResult | null {
  try {
    const normalized = filePath.trim();
    const ext = path.extname(normalized).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) return null;
    if (!fs.existsSync(normalized)) return null;
    const stat = fs.statSync(normalized);
    if (!stat.isFile() || stat.size === 0) return null;
    const buffer = fs.readFileSync(normalized);
    const mediaId = storeMedia({
      data: buffer.toString('base64'),
      mediaType: mediaTypeForExt(ext),
      byteSize: buffer.length,
    });
    return { mediaId, byteSize: buffer.length, tmpPath: normalized };
  } catch {
    return null;
  }
}

/**
 * Check if the macOS clipboard contains an image and store it.
 * Returns null if clipboard has no image or platform is not macOS.
 *
 * Uses osascript to write clipboard image to a temp PNG file.
 */
export function pasteImageFromClipboard(): ClipboardImageResult | null {
  if (process.platform !== 'darwin') return null;

  const tmpPath = path.join(os.tmpdir(), `seedcode_paste_${Date.now()}.png`);

  try {
    // Write clipboard image to temp file via osascript
    execSync(
      `osascript -e 'set theFile to (open for access POSIX file "${tmpPath}" with write permission)' \
       -e 'write (the clipboard as «class PNGf») to theFile' \
       -e 'close access theFile'`,
      { timeout: 5_000, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    if (!fs.existsSync(tmpPath)) return null;
    const stat = fs.statSync(tmpPath);
    if (stat.size === 0) {
      fs.unlinkSync(tmpPath);
      return null;
    }

    const buffer = fs.readFileSync(tmpPath);
    const mediaId = storeMedia({
      data: buffer.toString('base64'),
      mediaType: 'image/png',
      byteSize: buffer.length,
    });

    // Clean up temp file — data is now in MediaStore
    fs.unlinkSync(tmpPath);

    return { mediaId, byteSize: buffer.length, tmpPath };
  } catch {
    // Clipboard has no image, or osascript unavailable
    try { fs.existsSync(tmpPath) && fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    return null;
  }
}
