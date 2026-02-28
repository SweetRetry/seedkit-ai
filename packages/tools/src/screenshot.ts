/**
 * screenshot — capture the screen (or a specific display) on macOS using the
 * built-in `screencapture` command-line tool and return the result as a
 * base64-encoded data-URL, ready to pass to AI SDK v6 as a `file` content part.
 *
 * Requirements:
 *  - macOS only (throws `UnsupportedPlatformError` on other platforms)
 *  - The calling process must have **Screen Recording** permission granted in
 *    System Settings → Privacy & Security → Screen Recording.
 *    Without the permission `screencapture` silently produces a blank image.
 *
 * Example usage with streamText:
 *
 *   const shot = await screenshot({ displayId: 1 });
 *   await streamText({
 *     model: seed.chat('doubao-seed-1-6-vision-250815'),
 *     messages: [{
 *       role: 'user',
 *       content: [
 *         { type: 'text', text: 'What do you see on my screen?' },
 *         { type: 'file', mediaType: shot.mediaType, data: shot.data },
 *       ],
 *     }],
 *   });
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class UnsupportedPlatformError extends Error {
  constructor() {
    super('screenshot() is only supported on macOS');
    this.name = 'UnsupportedPlatformError';
  }
}

export class ScreenRecordingPermissionError extends Error {
  constructor() {
    super(
      'Screen Recording permission is required. ' +
        'Go to System Settings → Privacy & Security → Screen Recording and enable access for your terminal.',
    );
    this.name = 'ScreenRecordingPermissionError';
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScreenshotOptions {
  /**
   * 1-based display index. 1 = main display, 2 = second display, etc.
   * Omit to capture the main display.
   */
  displayId?: number;
  /**
   * Max pixel length of the longer edge after downscaling.
   * Retina displays capture at 2x (e.g. 2560px wide); scaling to 1280
   * reduces token count by ~75% with negligible information loss.
   * Defaults to 1280. Set to 0 to disable scaling.
   */
  maxEdge?: number;
}

export interface ScreenshotOutput {
  /**
   * File content as a base64-encoded data-URL string,
   * e.g. "data:image/jpeg;base64,/9j/..."
   * Ready to pass as `data` in an AI SDK v6 `file` content part.
   */
  data: string;
  /** Always image/jpeg — screenshots are compressed to JPEG after capture */
  mediaType: 'image/jpeg';
  /** Byte size of the compressed image before base64 encoding */
  byteSize: number;
  /** Byte size of the raw PNG from screencapture, for comparison */
  rawByteSize: number;
  /** The display index that was captured */
  displayId: number;
}

export interface DisplayInfo {
  /** 1-based display index, matches the `-D` argument to screencapture */
  id: number;
  /** Human-readable description from system_profiler */
  description: string;
  /** Whether this is the main display */
  isMain: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertMacOS(): void {
  if (process.platform !== 'darwin') {
    throw new UnsupportedPlatformError();
  }
}

/**
 * Heuristic: `screencapture` returns exit code 0 even when Screen Recording
 * permission is denied — it just writes an all-black PNG. We detect this by
 * checking whether the output file is suspiciously small (a solid black image
 * compresses to a few hundred bytes; a real screenshot is typically hundreds of
 * kilobytes).
 */
const BLANK_IMAGE_MAX_BYTES = 2048;

function detectBlankImage(buf: Buffer): boolean {
  return buf.byteLength < BLANK_IMAGE_MAX_BYTES;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Capture a screenshot on macOS, compress it (resize + JPEG), and return as
 * a base64 data-URL.
 *
 * Pipeline:
 *   screencapture → raw PNG → sips (resize long-edge + convert to JPEG) → base64
 *
 * @throws {UnsupportedPlatformError}        When called on a non-macOS platform.
 * @throws {ScreenRecordingPermissionError}  When Screen Recording permission is
 *                                           denied (detected via blank image heuristic).
 * @throws {Error}                           When `screencapture` is not found or
 *                                           exits with a non-zero status.
 */
export async function screenshot(options: ScreenshotOptions = {}): Promise<ScreenshotOutput> {
  assertMacOS();

  const { displayId = 1, maxEdge = 1280 } = options;

  const tmpDir = await mkdtemp(join(tmpdir(), 'seedkit-screenshot-'));
  const rawFile = join(tmpDir, 'capture.png');
  const outFile = join(tmpDir, 'capture.jpg');

  try {
    // Step 1: capture raw PNG
    await execFileAsync('screencapture', [
      '-x',             // no sound
      `-D${displayId}`, // display selection
      '-tpng',          // always capture as PNG first
      rawFile,
    ]);

    const rawBuf = await readFile(rawFile);

    if (detectBlankImage(rawBuf)) {
      throw new ScreenRecordingPermissionError();
    }

    // Step 2: resize + convert to JPEG via sips (macOS built-in, zero deps)
    // -Z <n>: fit within n×n box preserving aspect ratio (long-edge constraint)
    // --setProperty format jpeg: convert to JPEG
    const sipsArgs: string[] = [
      '--setProperty', 'format', 'jpeg',
      rawFile,
      '--out', outFile,
    ];
    if (maxEdge > 0) {
      // -Z must come before the input file
      sipsArgs.unshift('-Z', String(maxEdge));
    }
    await execFileAsync('sips', sipsArgs);

    const buf = await readFile(outFile);
    const b64 = buf.toString('base64');

    return {
      data: `data:image/jpeg;base64,${b64}`,
      mediaType: 'image/jpeg',
      byteSize: buf.byteLength,
      rawByteSize: rawBuf.byteLength,
      displayId,
    };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * List available displays by parsing `system_profiler SPDisplaysDataType`.
 * Returns at least `[{ id: 1, description: 'Main Display', isMain: true }]`
 * when parsing fails, so callers always get a usable default.
 */
export async function listDisplays(): Promise<DisplayInfo[]> {
  assertMacOS();

  try {
    const { stdout } = await execFileAsync('system_profiler', ['SPDisplaysDataType'], {
      timeout: 10_000,
    });

    const displays: DisplayInfo[] = [];
    let id = 1;

    // system_profiler output puts each display's attributes as indented key-value
    // pairs under a display name header (e.g. "      Built-in Retina Display:").
    // We split on those header lines (6+ spaces + word chars + colon at line end).
    const blocks = stdout.split(/\n[ \t]{6,}\S[^\n]*:\s*\n/);

    for (const block of blocks) {
      // Only blocks that contain a Resolution line describe a physical display
      if (!block.includes('Resolution:')) continue;

      const isMain = block.includes('Main Display: Yes');
      const typeMatch = block.match(/Display Type:\s*(.+)/);
      const resMatch = block.match(/Resolution:\s*(\d+ x \d+[^\n]*)/);
      const description = [typeMatch?.[1]?.trim(), resMatch?.[1]?.trim()]
        .filter(Boolean)
        .join(' — ');

      displays.push({
        id: id++,
        description: description || `Display ${id - 1}`,
        isMain,
      });
    }

    return displays.length > 0 ? displays : [{ id: 1, description: 'Main Display', isMain: true }];
  } catch {
    // Gracefully degrade — screencapture -D1 always works for the main display
    return [{ id: 1, description: 'Main Display', isMain: true }];
  }
}
