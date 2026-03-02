import { describe, expect, it, vi } from 'vitest';
import { SeedVideoModel } from './seed-video-model';

const BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
const prompt = 'A futuristic city with flying cars';

const defaultOptions = {
  prompt,
  n: 1,
  image: undefined,
  aspectRatio: undefined,
  resolution: undefined,
  duration: undefined,
  fps: undefined,
  seed: undefined,
  providerOptions: {},
  headers: undefined,
  abortSignal: undefined,
} as const;

function createMockFetch(
  createBody: unknown,
  statusBody: unknown = {
    id: 'task-id-123',
    model: 'doubao-seedance-1-0-pro-250528',
    status: 'succeeded',
    content: { video_url: 'https://cdn.seed.com/output.mp4' },
    seed: 42,
    resolution: '1080p',
    ratio: '16:9',
    duration: 5,
    frames: 125,
    framespersecond: 25,
    generate_audio: true,
    draft: false,
    usage: { completion_tokens: 100, total_tokens: 100 },
  },
) {
  return vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const isCreate =
      url.endsWith('/contents/generations/tasks') && init?.method === 'POST';

    const body = isCreate ? createBody : statusBody;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

function createModel(fetchMock?: ReturnType<typeof vi.fn>, modelId = 'doubao-seedance-1-0-pro-250528') {
  return new SeedVideoModel(modelId, {
    provider: 'seed.video',
    baseURL: BASE_URL,
    headers: () => ({ Authorization: 'Bearer test-key' }),
    fetch: fetchMock as typeof fetch,
  });
}

async function getCreateRequestBody(fetchMock: ReturnType<typeof vi.fn>) {
  const createCall = (fetchMock.mock.calls as [string, RequestInit][]).find(
    ([, init]) => init?.method === 'POST',
  );
  return JSON.parse((createCall![1] as RequestInit).body as string);
}

// ─── Constructor ────────────────────────────────────────────────────────────

describe('SeedVideoModel', () => {
  describe('constructor', () => {
    it('exposes correct provider, modelId, specificationVersion', () => {
      const model = createModel();
      expect(model.provider).toBe('seed.video');
      expect(model.modelId).toBe('doubao-seedance-1-0-pro-250528');
      expect(model.specificationVersion).toBe('v3');
    });

    it('exposes maxVideosPerCall of 1', () => {
      expect(createModel().maxVideosPerCall).toBe(1);
    });

    it('supports custom model IDs', () => {
      const model = createModel(undefined, 'doubao-seedance-1-5-pro-251215');
      expect(model.modelId).toBe('doubao-seedance-1-5-pro-251215');
    });
  });

  // ─── Request body ─────────────────────────────────────────────────────────

  describe('doGenerate – request body', () => {
    it('sends model and prompt in content array', async () => {
      const fetch = createMockFetch({ id: 'task-id-123' });
      await createModel(fetch).doGenerate({ ...defaultOptions });

      const body = await getCreateRequestBody(fetch);
      expect(body).toMatchObject({
        model: 'doubao-seedance-1-0-pro-250528',
        content: [{ type: 'text', text: prompt }],
      });
    });

    it('sends aspectRatio as ratio field', async () => {
      const fetch = createMockFetch({ id: 'task-id-123' });
      await createModel(fetch).doGenerate({
        ...defaultOptions,
        aspectRatio: '16:9',
      });

      const body = await getCreateRequestBody(fetch);
      expect(body.ratio).toBe('16:9');
    });

    it('sends duration when provided', async () => {
      const fetch = createMockFetch({ id: 'task-id-123' });
      await createModel(fetch).doGenerate({
        ...defaultOptions,
        duration: 8,
      });

      const body = await getCreateRequestBody(fetch);
      expect(body.duration).toBe(8);
    });

    it('sends seed when provided', async () => {
      const fetch = createMockFetch({ id: 'task-id-123' });
      await createModel(fetch).doGenerate({
        ...defaultOptions,
        seed: 99,
      });

      const body = await getCreateRequestBody(fetch);
      expect(body.seed).toBe(99);
    });

    it('omits ratio, duration, seed when not provided', async () => {
      const fetch = createMockFetch({ id: 'task-id-123' });
      await createModel(fetch).doGenerate({ ...defaultOptions });

      const body = await getCreateRequestBody(fetch);
      expect(body).not.toHaveProperty('ratio');
      expect(body).not.toHaveProperty('duration');
      expect(body).not.toHaveProperty('seed');
    });
  });

  // ─── Image-to-Video ───────────────────────────────────────────────────────

  describe('doGenerate – image input (i2v)', () => {
    it('sends image_url with file data URI', async () => {
      const fetch = createMockFetch({ id: 'task-id-123' });
      const imageData = new Uint8Array([137, 80, 78, 71]); // PNG magic bytes

      await createModel(fetch).doGenerate({
        ...defaultOptions,
        image: { type: 'file', data: imageData, mediaType: 'image/png' },
      });

      const body = await getCreateRequestBody(fetch);
      expect(body.content).toContainEqual({
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,iVBORw==' },
      });
    });

    it('sends image_url with URL-based image', async () => {
      const fetch = createMockFetch({ id: 'task-id-123' });

      await createModel(fetch).doGenerate({
        ...defaultOptions,
        image: {
          type: 'url',
          url: 'https://example.com/input-image.png',
        },
      });

      const body = await getCreateRequestBody(fetch);
      expect(body.content).toContainEqual({
        type: 'image_url',
        image_url: { url: 'https://example.com/input-image.png' },
      });
    });

    it('content array has text then image when both are provided', async () => {
      const fetch = createMockFetch({ id: 'task-id-123' });

      await createModel(fetch).doGenerate({
        ...defaultOptions,
        image: {
          type: 'url',
          url: 'https://example.com/input-image.png',
        },
      });

      const body = await getCreateRequestBody(fetch);
      expect(body.content[0].type).toBe('text');
      expect(body.content[1].type).toBe('image_url');
    });
  });

  // ─── Provider options ─────────────────────────────────────────────────────

  describe('doGenerate – provider options', () => {
    it('sends resolution option', async () => {
      const fetch = createMockFetch({ id: 'task-id-123' });
      await createModel(fetch).doGenerate({
        ...defaultOptions,
        providerOptions: { seed: { resolution: '1080p' } },
      });

      const body = await getCreateRequestBody(fetch);
      expect(body.resolution).toBe('1080p');
    });

    it('sends ratio from provider options (overrides aspectRatio)', async () => {
      const fetch = createMockFetch({ id: 'task-id-123' });
      await createModel(fetch).doGenerate({
        ...defaultOptions,
        aspectRatio: '16:9',
        providerOptions: { seed: { ratio: '9:16' } },
      });

      const body = await getCreateRequestBody(fetch);
      // provider ratio overrides AI SDK aspectRatio
      expect(body.ratio).toBe('9:16');
    });

    it('sends watermark option', async () => {
      const fetch = createMockFetch({ id: 'task-id-123' });
      await createModel(fetch).doGenerate({
        ...defaultOptions,
        providerOptions: { seed: { watermark: true } },
      });

      const body = await getCreateRequestBody(fetch);
      expect(body.watermark).toBe(true);
    });

    it('sends generate_audio option', async () => {
      const fetch = createMockFetch({ id: 'task-id-123' });
      await createModel(fetch).doGenerate({
        ...defaultOptions,
        providerOptions: { seed: { generate_audio: false } },
      });

      const body = await getCreateRequestBody(fetch);
      expect(body.generate_audio).toBe(false);
    });

    it('sends camera_fixed option', async () => {
      const fetch = createMockFetch({ id: 'task-id-123' });
      await createModel(fetch).doGenerate({
        ...defaultOptions,
        providerOptions: { seed: { camera_fixed: true } },
      });

      const body = await getCreateRequestBody(fetch);
      expect(body.camera_fixed).toBe(true);
    });

    it('sends return_last_frame option', async () => {
      const fetch = createMockFetch({ id: 'task-id-123' });
      await createModel(fetch).doGenerate({
        ...defaultOptions,
        providerOptions: { seed: { return_last_frame: true } },
      });

      const body = await getCreateRequestBody(fetch);
      expect(body.return_last_frame).toBe(true);
    });

    it('sends service_tier option', async () => {
      const fetch = createMockFetch({ id: 'task-id-123' });
      await createModel(fetch).doGenerate({
        ...defaultOptions,
        providerOptions: { seed: { service_tier: 'flex' } },
      });

      const body = await getCreateRequestBody(fetch);
      expect(body.service_tier).toBe('flex');
    });

    it('sends draft option', async () => {
      const fetch = createMockFetch({ id: 'task-id-123' });
      await createModel(fetch, 'doubao-seedance-1-5-pro-251215').doGenerate({
        ...defaultOptions,
        providerOptions: { seed: { draft: true } },
      });

      const body = await getCreateRequestBody(fetch);
      expect(body.draft).toBe(true);
    });

    it('sends frames option', async () => {
      const fetch = createMockFetch({ id: 'task-id-123' });
      await createModel(fetch).doGenerate({
        ...defaultOptions,
        providerOptions: { seed: { frames: 125 } },
      });

      const body = await getCreateRequestBody(fetch);
      expect(body.frames).toBe(125);
    });

    it('sends execution_expires_after option', async () => {
      const fetch = createMockFetch({ id: 'task-id-123' });
      await createModel(fetch).doGenerate({
        ...defaultOptions,
        providerOptions: { seed: { execution_expires_after: 7200 } },
      });

      const body = await getCreateRequestBody(fetch);
      expect(body.execution_expires_after).toBe(7200);
    });

    it('sends callback_url option', async () => {
      const fetch = createMockFetch({ id: 'task-id-123' });
      await createModel(fetch).doGenerate({
        ...defaultOptions,
        providerOptions: {
          seed: { callback_url: 'https://example.com/webhook' },
        },
      });

      const body = await getCreateRequestBody(fetch);
      expect(body.callback_url).toBe('https://example.com/webhook');
    });

    it('does not send pollIntervalMs or pollTimeoutMs to API', async () => {
      const fetch = createMockFetch({ id: 'task-id-123' });
      await createModel(fetch).doGenerate({
        ...defaultOptions,
        providerOptions: {
          seed: { pollIntervalMs: 1000, pollTimeoutMs: 30000 },
        },
      });

      const body = await getCreateRequestBody(fetch);
      expect(body).not.toHaveProperty('pollIntervalMs');
      expect(body).not.toHaveProperty('pollTimeoutMs');
    });
  });

  // ─── Headers ──────────────────────────────────────────────────────────────

  describe('doGenerate – headers', () => {
    it('merges provider headers and per-request headers', async () => {
      const fetch = createMockFetch({ id: 'task-id-123' });
      const model = new SeedVideoModel('doubao-seedance-1-0-pro-250528', {
        provider: 'seed.video',
        baseURL: BASE_URL,
        headers: () => ({
          Authorization: 'Bearer test-key',
          'X-Provider-Header': 'provider-value',
        }),
        fetch: fetch as typeof globalThis.fetch,
      });

      await model.doGenerate({
        ...defaultOptions,
        headers: { 'X-Request-Header': 'request-value' },
      });

      const createCall = (fetch.mock.calls as [string, RequestInit][]).find(
        ([, init]) => init?.method === 'POST',
      )!;
      const headers = new Headers(
        (createCall[1] as RequestInit).headers as Record<string, string>,
      );
      expect(headers.get('x-provider-header')).toBe('provider-value');
      expect(headers.get('x-request-header')).toBe('request-value');
    });
  });

  // ─── Warnings ─────────────────────────────────────────────────────────────

  describe('doGenerate – warnings', () => {
    it('returns empty warnings array for normal call', async () => {
      const fetch = createMockFetch({ id: 'task-id-123' });
      const result = await createModel(fetch).doGenerate({ ...defaultOptions });
      expect(result.warnings).toStrictEqual([]);
    });

    it('warns when provider ratio overrides standard aspectRatio', async () => {
      const fetch = createMockFetch({ id: 'task-id-123' });
      const result = await createModel(fetch).doGenerate({
        ...defaultOptions,
        aspectRatio: '16:9',
        providerOptions: { seed: { ratio: '9:16' } },
      });

      expect(result.warnings).toContainEqual({
        type: 'unsupported',
        feature: 'aspectRatio',
      });
    });
  });

  // ─── Response parsing ─────────────────────────────────────────────────────

  describe('doGenerate – response', () => {
    it('returns video with correct url and mediaType', async () => {
      const fetch = createMockFetch({ id: 'task-id-123' });
      const result = await createModel(fetch).doGenerate({ ...defaultOptions });

      expect(result.videos).toHaveLength(1);
      expect(result.videos[0]).toStrictEqual({
        type: 'url',
        url: 'https://cdn.seed.com/output.mp4',
        mediaType: 'video/mp4',
      });
    });

    it('includes modelId from task response in response metadata', async () => {
      const fetch = createMockFetch({ id: 'task-id-123' });
      const result = await createModel(fetch).doGenerate({ ...defaultOptions });

      expect(result.response.modelId).toBe('doubao-seedance-1-0-pro-250528');
    });

    it('falls back to constructor modelId when task response has no model field', async () => {
      const fetch = createMockFetch(
        { id: 'task-id-123' },
        {
          id: 'task-id-123',
          status: 'succeeded',
          content: { video_url: 'https://cdn.seed.com/output.mp4' },
          // no model field
        },
      );
      const result = await createModel(fetch).doGenerate({ ...defaultOptions });
      expect(result.response.modelId).toBe('doubao-seedance-1-0-pro-250528');
    });

    it('includes taskId and extended metadata in providerMetadata', async () => {
      const fetch = createMockFetch({ id: 'task-id-123' });
      const result = await createModel(fetch).doGenerate({ ...defaultOptions });

      expect(result.providerMetadata).toMatchObject({
        seed: {
          taskId: 'task-id-123',
          seed: 42,
          resolution: '1080p',
          ratio: '16:9',
          duration: 5,
          frames: 125,
          framespersecond: 25,
          generate_audio: true,
          draft: false,
          usage: { completion_tokens: 100, total_tokens: 100 },
        },
      });
    });

    it('includes last_frame_url in providerMetadata when present', async () => {
      const fetch = createMockFetch(
        { id: 'task-id-123' },
        {
          id: 'task-id-123',
          status: 'succeeded',
          content: {
            video_url: 'https://cdn.seed.com/output.mp4',
            last_frame_url: 'https://cdn.seed.com/last-frame.png',
          },
        },
      );
      const result = await createModel(fetch).doGenerate({ ...defaultOptions });

      expect(result.providerMetadata?.seed?.last_frame_url).toBe(
        'https://cdn.seed.com/last-frame.png',
      );
    });

    it('includes response timestamp as a Date object', async () => {
      const fetch = createMockFetch({ id: 'task-id-123' });
      const result = await createModel(fetch).doGenerate({ ...defaultOptions });

      expect(result.response.timestamp).toBeInstanceOf(Date);
    });

    it('does not include service_tier in providerMetadata', async () => {
      const fetch = createMockFetch(
        { id: 'task-id-123' },
        {
          id: 'task-id-123',
          status: 'succeeded',
          content: { video_url: 'https://cdn.seed.com/output.mp4' },
          service_tier: 'flex',
        },
      );
      const result = await createModel(fetch).doGenerate({ ...defaultOptions });

      expect(result.providerMetadata?.seed).not.toHaveProperty(
        'service_tier',
      );
    });

    it('does not include draft_task_id in providerMetadata', async () => {
      const fetch = createMockFetch(
        { id: 'task-id-123' },
        {
          id: 'task-id-123',
          status: 'succeeded',
          content: { video_url: 'https://cdn.seed.com/output.mp4' },
          draft_task_id: 'draft-task-abc',
        },
      );
      const result = await createModel(fetch).doGenerate({ ...defaultOptions });

      expect(result.providerMetadata?.seed).not.toHaveProperty(
        'draft_task_id',
      );
    });
  });

  // ─── Error handling ───────────────────────────────────────────────────────

  describe('doGenerate – error handling', () => {
    it('throws when no task ID is returned from create endpoint', async () => {
      const fetch = createMockFetch({});
      await expect(
        createModel(fetch).doGenerate({ ...defaultOptions }),
      ).rejects.toMatchObject({
        message: 'No task ID returned from video generation API',
      });
    });

    it('throws when video URL is missing from succeeded task response', async () => {
      const fetch = createMockFetch(
        { id: 'task-id-123' },
        {
          id: 'task-id-123',
          status: 'succeeded',
          content: {},
        },
      );
      await expect(
        createModel(fetch).doGenerate({ ...defaultOptions }),
      ).rejects.toMatchObject({
        message: expect.stringContaining('No video URL'),
      });
    });

    it('throws when task status is failed', async () => {
      const fetch = createMockFetch(
        { id: 'task-id-123' },
        {
          id: 'task-id-123',
          status: 'failed',
          error: { code: 'ERR_001', message: 'Content policy violation' },
        },
      );
      await expect(
        createModel(fetch).doGenerate({
          ...defaultOptions,
          providerOptions: { seed: { pollIntervalMs: 1 } },
        }),
      ).rejects.toMatchObject({
        message: expect.stringContaining('failed'),
      });
    });

    it('throws when task status is expired', async () => {
      const fetch = createMockFetch(
        { id: 'task-id-123' },
        { id: 'task-id-123', status: 'expired' },
      );
      await expect(
        createModel(fetch).doGenerate({
          ...defaultOptions,
          providerOptions: { seed: { pollIntervalMs: 1 } },
        }),
      ).rejects.toMatchObject({
        message: expect.stringContaining('expired'),
      });
    });

    it('throws when task status is cancelled', async () => {
      const fetch = createMockFetch(
        { id: 'task-id-123' },
        { id: 'task-id-123', status: 'cancelled' },
      );
      await expect(
        createModel(fetch).doGenerate({
          ...defaultOptions,
          providerOptions: { seed: { pollIntervalMs: 1 } },
        }),
      ).rejects.toMatchObject({
        message: expect.stringContaining('cancelled'),
      });
    });

    it('throws when neither prompt nor image is provided', async () => {
      const fetch = createMockFetch({ id: 'task-id-123' });
      await expect(
        createModel(fetch).doGenerate({
          ...defaultOptions,
          prompt: undefined,
          image: undefined,
        }),
      ).rejects.toMatchObject({
        message: expect.stringContaining('Either prompt or image must be provided'),
      });
    });
  });

  // ─── Polling behavior ─────────────────────────────────────────────────────

  describe('doGenerate – polling', () => {
    it('polls until status is succeeded', async () => {
      let pollCount = 0;

      const fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/contents/generations/tasks') && init?.method === 'POST') {
          return new Response(JSON.stringify({ id: 'poll-task-id' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        pollCount++;
        const status = pollCount < 3 ? 'queued' : 'succeeded';
        const body =
          status === 'succeeded'
            ? {
                id: 'poll-task-id',
                status,
                content: { video_url: 'https://cdn.seed.com/output.mp4' },
              }
            : { id: 'poll-task-id', status };

        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const result = await createModel(fetch).doGenerate({
        ...defaultOptions,
        providerOptions: { seed: { pollIntervalMs: 1 } },
      });

      expect(pollCount).toBe(3);
      const video = result.videos[0];
      expect(video.type).toBe('url');
      expect((video as { type: 'url'; url: string }).url).toBe('https://cdn.seed.com/output.mp4');
    });

    it('times out after pollTimeoutMs', async () => {
      const fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/contents/generations/tasks') && init?.method === 'POST') {
          return new Response(JSON.stringify({ id: 'timeout-task-id' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(
          JSON.stringify({ id: 'timeout-task-id', status: 'running' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      await expect(
        createModel(fetch).doGenerate({
          ...defaultOptions,
          providerOptions: { seed: { pollIntervalMs: 10, pollTimeoutMs: 50 } },
        }),
      ).rejects.toMatchObject({
        message: expect.stringContaining('timed out'),
      });
    });

    it('respects abort signal during polling', async () => {
      const abortController = new AbortController();

      const fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/contents/generations/tasks') && init?.method === 'POST') {
          return new Response(JSON.stringify({ id: 'abort-task-id' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Abort after first poll
        abortController.abort();
        return new Response(
          JSON.stringify({ id: 'abort-task-id', status: 'running' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      await expect(
        createModel(fetch).doGenerate({
          ...defaultOptions,
          providerOptions: { seed: { pollIntervalMs: 1 } },
          abortSignal: abortController.signal,
        }),
      ).rejects.toMatchObject({
        message: expect.stringContaining('aborted'),
      });
    });
  });
});
