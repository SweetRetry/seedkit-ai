import { screenshot, listDisplays, UnsupportedPlatformError, ScreenRecordingPermissionError } from '@seedkit-ai/tools';
import { storeMedia } from '../media-store.js';

export interface ListDisplaysResult {
  displays: Array<{ id: number; description: string; isMain: boolean }>;
  count: number;
}

export interface ScreenshotResult {
  /**
   * Opaque reference ID — the actual base64 data is stored in MediaStore.
   * ReplApp will inject the image into the next streamText call as a file
   * content part. This keeps the messages history free of large binary data.
   */
  mediaId: string;
  mediaType: 'image/jpeg';
  byteSize: number;
  /** Raw PNG size before compression, useful for logging compression ratio */
  rawByteSize: number;
  displayId: number;
}

export async function captureScreenshot(
  displayId: number,
): Promise<ScreenshotResult> {
  const result = await screenshot({ displayId });
  const mediaId = storeMedia({
    data: result.data,
    mediaType: result.mediaType,
    byteSize: result.byteSize,
  });
  return {
    mediaId,
    mediaType: result.mediaType,
    byteSize: result.byteSize,
    rawByteSize: result.rawByteSize,
    displayId,
  };
}

export async function getDisplayList(): Promise<ListDisplaysResult> {
  const displays = await listDisplays();
  return { displays, count: displays.length };
}

export { UnsupportedPlatformError, ScreenRecordingPermissionError };
