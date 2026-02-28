import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must use vi.hoisted() so the factories can reference them
// ---------------------------------------------------------------------------

const { mockExecFileAsync, mockMkdtemp, mockReadFile, mockRm } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
  mockMkdtemp: vi.fn(),
  mockReadFile: vi.fn(),
  mockRm: vi.fn(),
}));

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

vi.mock('node:fs/promises', () => ({
  mkdtemp: mockMkdtemp,
  readFile: mockReadFile,
  rm: mockRm,
}));

vi.mock('node:os', () => ({ tmpdir: () => '/tmp' }));

// promisify returns our mockExecFileAsync regardless of what fn is passed
vi.mock('node:util', () => ({
  promisify: () => mockExecFileAsync,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  ScreenRecordingPermissionError,
  UnsupportedPlatformError,
  listDisplays,
  screenshot,
} from './screenshot.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeImageBuffer(bytes: number): Buffer {
  return Buffer.alloc(bytes, 0xab);
}

const BLANK_BUF = Buffer.alloc(512, 0x00);

function setupHappyPath(rawBuf: Buffer = makeImageBuffer(100_000), compressedBuf: Buffer = makeImageBuffer(30_000)): void {
  mockMkdtemp.mockResolvedValue('/tmp/seedkit-screenshot-abc');
  // screencapture call, then sips call — two sequential execFileAsync invocations
  mockExecFileAsync
    .mockResolvedValueOnce({ stdout: '', stderr: '' })  // screencapture
    .mockResolvedValueOnce({ stdout: '', stderr: '' }); // sips
  // readFile called twice: rawFile (blank-check), then outFile (compressed)
  mockReadFile
    .mockResolvedValueOnce(rawBuf)
    .mockResolvedValueOnce(compressedBuf);
  mockRm.mockResolvedValue(undefined);
}

// ---------------------------------------------------------------------------
// Tests: screenshot()
// ---------------------------------------------------------------------------

describe('screenshot()', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('throws UnsupportedPlatformError on non-macOS', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    await expect(screenshot()).rejects.toThrow(UnsupportedPlatformError);
  });

  it('returns a valid JPEG data-URL', async () => {
    const rawBuf = makeImageBuffer(200_000);
    const compressedBuf = makeImageBuffer(50_000);
    setupHappyPath(rawBuf, compressedBuf);

    const result = await screenshot({ displayId: 1 });

    expect(result.mediaType).toBe('image/jpeg');
    expect(result.data).toMatch(/^data:image\/jpeg;base64,/);
    expect(result.byteSize).toBe(compressedBuf.byteLength);
    expect(result.rawByteSize).toBe(rawBuf.byteLength);
    expect(result.displayId).toBe(1);
  });

  it('defaults to displayId=1', async () => {
    setupHappyPath();

    const result = await screenshot();

    expect(result.displayId).toBe(1);
    expect(result.mediaType).toBe('image/jpeg');
  });

  it('passes -D<displayId> arg to screencapture', async () => {
    setupHappyPath();
    await screenshot({ displayId: 2 });

    const [cmd, args] = mockExecFileAsync.mock.calls[0] as [string, string[]];
    expect(cmd).toBe('screencapture');
    expect(args).toContain('-D2');
  });

  it('passes -x (no sound) flag', async () => {
    setupHappyPath();
    await screenshot();

    const [, args] = mockExecFileAsync.mock.calls[0] as [string, string[]];
    expect(args).toContain('-x');
  });

  it('throws ScreenRecordingPermissionError for blank raw image', async () => {
    mockMkdtemp.mockResolvedValue('/tmp/seedkit-screenshot-abc');
    mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });
    mockReadFile.mockResolvedValueOnce(BLANK_BUF); // raw PNG is blank
    mockRm.mockResolvedValue(undefined);

    await expect(screenshot()).rejects.toThrow(ScreenRecordingPermissionError);
  });

  it('always removes temp dir even on screencapture error', async () => {
    mockMkdtemp.mockResolvedValue('/tmp/seedkit-screenshot-abc');
    mockExecFileAsync.mockRejectedValue(new Error('screencapture: command not found'));
    mockRm.mockResolvedValue(undefined);

    await expect(screenshot()).rejects.toThrow('screencapture');
    expect(mockRm).toHaveBeenCalledWith('/tmp/seedkit-screenshot-abc', {
      recursive: true,
      force: true,
    });
  });

  it('always removes temp dir even on sips error', async () => {
    mockMkdtemp.mockResolvedValue('/tmp/seedkit-screenshot-abc');
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: '', stderr: '' }) // screencapture ok
      .mockRejectedValueOnce(new Error('sips: command not found')); // sips fails
    mockReadFile.mockResolvedValueOnce(makeImageBuffer(100_000));
    mockRm.mockResolvedValue(undefined);

    await expect(screenshot()).rejects.toThrow('sips');
    expect(mockRm).toHaveBeenCalledWith('/tmp/seedkit-screenshot-abc', {
      recursive: true,
      force: true,
    });
  });

  it('base64-encodes the compressed image correctly', async () => {
    const compressedBuf = Buffer.from('FAKE_JPEG_DATA'.repeat(200));
    setupHappyPath(makeImageBuffer(100_000), compressedBuf);

    const result = await screenshot();
    const decoded = Buffer.from(result.data.split(',')[1]!, 'base64');

    expect(decoded.toString()).toBe(compressedBuf.toString());
  });

  it('passes -Z maxEdge to sips when maxEdge > 0', async () => {
    setupHappyPath();
    await screenshot({ maxEdge: 800 });

    const [, sipsArgs] = mockExecFileAsync.mock.calls[1] as [string, string[]];
    expect(sipsArgs).toContain('-Z');
    expect(sipsArgs).toContain('800');
  });

  it('skips -Z flag when maxEdge is 0', async () => {
    setupHappyPath();
    await screenshot({ maxEdge: 0 });

    const [, sipsArgs] = mockExecFileAsync.mock.calls[1] as [string, string[]];
    expect(sipsArgs).not.toContain('-Z');
  });
});

// ---------------------------------------------------------------------------
// Tests: listDisplays()
// ---------------------------------------------------------------------------

describe('listDisplays()', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('throws UnsupportedPlatformError on non-macOS', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    await expect(listDisplays()).rejects.toThrow(UnsupportedPlatformError);
  });

  it('returns fallback when system_profiler fails', async () => {
    mockExecFileAsync.mockRejectedValue(new Error('not found'));

    const displays = await listDisplays();
    expect(displays).toEqual([{ id: 1, description: 'Main Display', isMain: true }]);
  });

  it('parses two displays from system_profiler output', async () => {
    const stdout = `
Graphics/Displays:

    Displays:

      Built-in Liquid Retina Display:
      Display Type: Built-in Liquid Retina Display
      Resolution: 2560 x 1664 Retina
      Main Display: Yes

      LG UltraFine:
      Display Type: External Display
      Resolution: 1920 x 1080
`;
    mockExecFileAsync.mockResolvedValue({ stdout, stderr: '' });

    const displays = await listDisplays();
    expect(displays.length).toBeGreaterThanOrEqual(1);
    const main = displays.find((d) => d.isMain);
    expect(main).toBeDefined();
  });
});
