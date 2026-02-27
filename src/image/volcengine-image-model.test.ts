import { describe, expect, it, vi } from 'vitest';
import { VolcengineImageModel } from './volcengine-image-model';

const TEST_MODEL_ID = 'doubao-seedream-5-0-260128';
const BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
const prompt = 'A beautiful mountain landscape';

// Minimal valid b64_json response
const makeSuccessResponse = (overrides: Record<string, unknown> = {}) => ({
  model: TEST_MODEL_ID,
  created: 1234567890,
  data: [{ b64_json: 'aGVsbG8=' }],
  ...overrides,
});

const createMockFetch = (body: unknown, status = 200) =>
  vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });

const createModel = (fetchMock?: typeof fetch) =>
  new VolcengineImageModel(TEST_MODEL_ID, {
    provider: 'volcengine.image',
    baseURL: BASE_URL,
    headers: () => ({ Authorization: 'Bearer test-key' }),
    fetch: fetchMock as typeof fetch,
  });

// Helper: extract parsed request body from mock fetch call
const getRequestBody = async (fetchMock: ReturnType<typeof vi.fn>) => {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string);
};

// ─── constructor ───────────────────────────────────────────────────────────────

describe('VolcengineImageModel', () => {
  describe('constructor', () => {
    it('exposes correct provider, modelId, specificationVersion', () => {
      const model = createModel();
      expect(model.provider).toBe('volcengine.image');
      expect(model.modelId).toBe(TEST_MODEL_ID);
      expect(model.specificationVersion).toBe('v3');
    });

    it('exposes maxImagesPerCall of 4', () => {
      expect(createModel().maxImagesPerCall).toBe(4);
    });
  });

  // ─── request body ────────────────────────────────────────────────────────────

  describe('doGenerate – request body', () => {
    it('sends model, prompt, and defaults size to 2K', async () => {
      const fetch = createMockFetch(makeSuccessResponse());
      await createModel(fetch).doGenerate({
        prompt,
        n: 1,
        size: undefined,
        aspectRatio: undefined,
        seed: undefined,
        providerOptions: {},
        files: undefined,
        headers: undefined,
        mask: undefined,
        abortSignal: undefined,
      });

      const body = await getRequestBody(fetch);
      expect(body).toMatchObject({
        model: TEST_MODEL_ID,
        prompt,
        size: '2K',
        n: 1,
        response_format: 'b64_json',
      });
    });

    it('passes explicit pixel size when provided', async () => {
      const fetch = createMockFetch(makeSuccessResponse());
      await createModel(fetch).doGenerate({
        prompt,
        n: 1,
        size: '2048x2048',
        aspectRatio: undefined,
        seed: undefined,
        providerOptions: {},
        files: undefined,
        headers: undefined,
        mask: undefined,
        abortSignal: undefined,
      });

      const body = await getRequestBody(fetch);
      expect(body.size).toBe('2048x2048');
    });

    it('maps 16:9 aspectRatio to correct volcengine pixel size', async () => {
      const fetch = createMockFetch(makeSuccessResponse());
      await createModel(fetch).doGenerate({
        prompt,
        n: 1,
        size: undefined,
        aspectRatio: '16:9',
        seed: undefined,
        providerOptions: {},
        files: undefined,
        headers: undefined,
        mask: undefined,
        abortSignal: undefined,
      });

      const body = await getRequestBody(fetch);
      expect(body.size).toBe('2848x1600');
    });

    it('maps 9:16 aspectRatio to correct volcengine pixel size', async () => {
      const fetch = createMockFetch(makeSuccessResponse());
      await createModel(fetch).doGenerate({
        prompt,
        n: 1,
        size: undefined,
        aspectRatio: '9:16',
        seed: undefined,
        providerOptions: {},
        files: undefined,
        headers: undefined,
        mask: undefined,
        abortSignal: undefined,
      });

      const body = await getRequestBody(fetch);
      expect(body.size).toBe('1600x2848');
    });

    it('maps 1:1 aspectRatio to 2048x2048', async () => {
      const fetch = createMockFetch(makeSuccessResponse());
      await createModel(fetch).doGenerate({
        prompt,
        n: 1,
        size: undefined,
        aspectRatio: '1:1',
        seed: undefined,
        providerOptions: {},
        files: undefined,
        headers: undefined,
        mask: undefined,
        abortSignal: undefined,
      });

      const body = await getRequestBody(fetch);
      expect(body.size).toBe('2048x2048');
    });

    it('falls back to 2K for unknown aspectRatio', async () => {
      const fetch = createMockFetch(makeSuccessResponse());
      await createModel(fetch).doGenerate({
        prompt,
        n: 1,
        size: undefined,
        aspectRatio: '2:3',
        seed: undefined,
        providerOptions: {},
        files: undefined,
        headers: undefined,
        mask: undefined,
        abortSignal: undefined,
      });

      const body = await getRequestBody(fetch);
      expect(body.size).toBe('2K');
    });

    it('prefers explicit size over aspectRatio', async () => {
      const fetch = createMockFetch(makeSuccessResponse());
      await createModel(fetch).doGenerate({
        prompt,
        n: 1,
        size: '1664x2496',
        aspectRatio: '16:9',
        seed: undefined,
        providerOptions: {},
        files: undefined,
        headers: undefined,
        mask: undefined,
        abortSignal: undefined,
      });

      const body = await getRequestBody(fetch);
      expect(body.size).toBe('1664x2496');
    });

    it('uses size_tier providerOption when no explicit size or aspectRatio', async () => {
      const fetch = createMockFetch(makeSuccessResponse());
      await createModel(fetch).doGenerate({
        prompt,
        n: 1,
        size: undefined,
        aspectRatio: undefined,
        seed: undefined,
        providerOptions: { volcengine: { size_tier: '3K' } },
        files: undefined,
        headers: undefined,
        mask: undefined,
        abortSignal: undefined,
      });

      const body = await getRequestBody(fetch);
      expect(body.size).toBe('3K');
    });

    it('prefers explicit pixel size over size_tier', async () => {
      const fetch = createMockFetch(makeSuccessResponse());
      await createModel(fetch).doGenerate({
        prompt,
        n: 1,
        size: '2848x1600',
        aspectRatio: undefined,
        seed: undefined,
        providerOptions: { volcengine: { size_tier: '3K' } },
        files: undefined,
        headers: undefined,
        mask: undefined,
        abortSignal: undefined,
      });

      const body = await getRequestBody(fetch);
      expect(body.size).toBe('2848x1600');
      // size_tier must NOT leak into the request body
      expect(body.size_tier).toBeUndefined();
    });

    it('prefers size_tier over aspectRatio mapping', async () => {
      const fetch = createMockFetch(makeSuccessResponse());
      await createModel(fetch).doGenerate({
        prompt,
        n: 1,
        size: undefined,
        aspectRatio: '16:9',
        seed: undefined,
        providerOptions: { volcengine: { size_tier: '3K' } },
        files: undefined,
        headers: undefined,
        mask: undefined,
        abortSignal: undefined,
      });

      const body = await getRequestBody(fetch);
      expect(body.size).toBe('3K');
    });

    it('passes n to body', async () => {
      const fetch = createMockFetch({
        ...makeSuccessResponse(),
        data: [{ b64_json: 'aGVsbG8=' }, { b64_json: 'd29ybGQ=' }],
      });
      await createModel(fetch).doGenerate({
        prompt,
        n: 2,
        size: undefined,
        aspectRatio: undefined,
        seed: undefined,
        providerOptions: {},
        files: undefined,
        headers: undefined,
        mask: undefined,
        abortSignal: undefined,
      });

      const body = await getRequestBody(fetch);
      expect(body.n).toBe(2);
    });

    it('always forces response_format to b64_json', async () => {
      const fetch = createMockFetch(makeSuccessResponse());
      await createModel(fetch).doGenerate({
        prompt,
        n: 1,
        size: undefined,
        aspectRatio: undefined,
        seed: undefined,
        // User tries to override response_format — should be ignored
        providerOptions: { volcengine: { response_format: 'url' } },
        files: undefined,
        headers: undefined,
        mask: undefined,
        abortSignal: undefined,
      });

      const body = await getRequestBody(fetch);
      expect(body.response_format).toBe('b64_json');
    });

    it('passes volcengine provider options (watermark, output_format)', async () => {
      const fetch = createMockFetch(makeSuccessResponse());
      await createModel(fetch).doGenerate({
        prompt,
        n: 1,
        size: undefined,
        aspectRatio: undefined,
        seed: undefined,
        providerOptions: {
          volcengine: { watermark: false, output_format: 'png' },
        },
        files: undefined,
        headers: undefined,
        mask: undefined,
        abortSignal: undefined,
      });

      const body = await getRequestBody(fetch);
      expect(body.watermark).toBe(false);
      expect(body.output_format).toBe('png');
    });

    it('sends sequential_image_generation option', async () => {
      const fetch = createMockFetch(makeSuccessResponse());
      await createModel(fetch).doGenerate({
        prompt,
        n: 1,
        size: undefined,
        aspectRatio: undefined,
        seed: undefined,
        providerOptions: {
          volcengine: { sequential_image_generation: 'auto' },
        },
        files: undefined,
        headers: undefined,
        mask: undefined,
        abortSignal: undefined,
      });

      const body = await getRequestBody(fetch);
      expect(body.sequential_image_generation).toBe('auto');
    });
  });

  // ─── files / image input ─────────────────────────────────────────────────────

  describe('doGenerate – files (image input)', () => {
    it('sends single file as image data URI', async () => {
      const fetch = createMockFetch(makeSuccessResponse());
      const imageData = new Uint8Array([137, 80, 78, 71]); // PNG magic bytes

      await createModel(fetch).doGenerate({
        prompt: 'Edit this image',
        n: 1,
        size: undefined,
        aspectRatio: undefined,
        seed: undefined,
        providerOptions: {},
        files: [{ type: 'file', data: imageData, mediaType: 'image/png' }],
        headers: undefined,
        mask: undefined,
        abortSignal: undefined,
      });

      const body = await getRequestBody(fetch);
      expect(body.image).toBe('data:image/png;base64,iVBORw==');
    });

    it('sends single URL-based file as image string', async () => {
      const fetch = createMockFetch(makeSuccessResponse());

      await createModel(fetch).doGenerate({
        prompt: 'Edit this',
        n: 1,
        size: undefined,
        aspectRatio: undefined,
        seed: undefined,
        providerOptions: {},
        files: [{ type: 'url', url: 'https://example.com/photo.png' }],
        headers: undefined,
        mask: undefined,
        abortSignal: undefined,
      });

      const body = await getRequestBody(fetch);
      expect(body.image).toBe('https://example.com/photo.png');
    });

    it('sends multiple files as image array', async () => {
      const fetch = createMockFetch(makeSuccessResponse());
      const imageData = new Uint8Array([137, 80, 78, 71]);

      await createModel(fetch).doGenerate({
        prompt: 'Merge these images',
        n: 1,
        size: undefined,
        aspectRatio: undefined,
        seed: undefined,
        providerOptions: {},
        files: [
          { type: 'file', data: imageData, mediaType: 'image/png' },
          { type: 'url', url: 'https://example.com/ref.png' },
        ],
        headers: undefined,
        mask: undefined,
        abortSignal: undefined,
      });

      const body = await getRequestBody(fetch);
      expect(body.image).toEqual([
        'data:image/png;base64,iVBORw==',
        'https://example.com/ref.png',
      ]);
    });

    it('sends base64 string file as data URI', async () => {
      const fetch = createMockFetch(makeSuccessResponse());

      await createModel(fetch).doGenerate({
        prompt: 'Edit this',
        n: 1,
        size: undefined,
        aspectRatio: undefined,
        seed: undefined,
        providerOptions: {},
        files: [
          {
            type: 'file',
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAE=',
            mediaType: 'image/png',
          },
        ],
        headers: undefined,
        mask: undefined,
        abortSignal: undefined,
      });

      const body = await getRequestBody(fetch);
      expect(body.image).toBe(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAE=',
      );
    });
  });

  // ─── headers ─────────────────────────────────────────────────────────────────

  describe('doGenerate – headers', () => {
    it('merges provider headers and per-request headers', async () => {
      const fetch = createMockFetch(makeSuccessResponse());
      const model = new VolcengineImageModel(TEST_MODEL_ID, {
        provider: 'volcengine.image',
        baseURL: BASE_URL,
        headers: () => ({
          Authorization: 'Bearer test-key',
          'X-Provider-Header': 'provider-value',
        }),
        fetch: fetch as typeof fetch,
      });

      await model.doGenerate({
        prompt,
        n: 1,
        size: undefined,
        aspectRatio: undefined,
        seed: undefined,
        providerOptions: {},
        files: undefined,
        headers: { 'X-Request-Header': 'request-value' },
        mask: undefined,
        abortSignal: undefined,
      });

      const [, init] = fetch.mock.calls[0] as [string, RequestInit];
      const headers = new Headers(init.headers as Record<string, string>);
      expect(headers.get('x-provider-header')).toBe('provider-value');
      expect(headers.get('x-request-header')).toBe('request-value');
    });
  });

  // ─── warnings ────────────────────────────────────────────────────────────────

  describe('doGenerate – warnings', () => {
    it('emits unsupported warning for seed', async () => {
      const fetch = createMockFetch(makeSuccessResponse());
      const result = await createModel(fetch).doGenerate({
        prompt,
        n: 1,
        size: undefined,
        aspectRatio: undefined,
        seed: 42,
        providerOptions: {},
        files: undefined,
        headers: undefined,
        mask: undefined,
        abortSignal: undefined,
      });

      expect(result.warnings).toEqual([
        { type: 'unsupported', feature: 'seed' },
      ]);
    });

    it('emits no warnings for unknown aspectRatio (falls back silently)', async () => {
      const fetch = createMockFetch(makeSuccessResponse());
      const result = await createModel(fetch).doGenerate({
        prompt,
        n: 1,
        size: undefined,
        aspectRatio: '2:3',
        seed: undefined,
        providerOptions: {},
        files: undefined,
        headers: undefined,
        mask: undefined,
        abortSignal: undefined,
      });

      expect(result.warnings).toHaveLength(0);
    });
  });

  // ─── response parsing ────────────────────────────────────────────────────────

  describe('doGenerate – response', () => {
    it('returns base64 images from data array', async () => {
      const fetch = createMockFetch({
        model: TEST_MODEL_ID,
        data: [{ b64_json: 'aGVsbG8=' }, { b64_json: 'd29ybGQ=' }],
      });

      const result = await createModel(fetch).doGenerate({
        prompt,
        n: 2,
        size: undefined,
        aspectRatio: undefined,
        seed: undefined,
        providerOptions: {},
        files: undefined,
        headers: undefined,
        mask: undefined,
        abortSignal: undefined,
      });

      expect(result.images).toEqual(['aGVsbG8=', 'd29ybGQ=']);
    });

    it('throws when b64_json is missing from response', async () => {
      const fetch = createMockFetch({
        model: TEST_MODEL_ID,
        data: [{ url: 'https://example.com/image.png' }],
      });

      await expect(
        createModel(fetch).doGenerate({
          prompt,
          n: 1,
          size: undefined,
          aspectRatio: undefined,
          seed: undefined,
          providerOptions: {},
          files: undefined,
          headers: undefined,
          mask: undefined,
        abortSignal: undefined,
        }),
      ).rejects.toThrow('No base64 image data in response');
    });

    it('includes modelId from response in metadata', async () => {
      const fetch = createMockFetch(makeSuccessResponse({ model: 'actual-model-id' }));

      const result = await createModel(fetch).doGenerate({
        prompt,
        n: 1,
        size: undefined,
        aspectRatio: undefined,
        seed: undefined,
        providerOptions: {},
        files: undefined,
        headers: undefined,
        mask: undefined,
        abortSignal: undefined,
      });

      expect(result.response.modelId).toBe('actual-model-id');
    });

    it('falls back to constructor modelId when response has no model field', async () => {
      const fetch = createMockFetch({ data: [{ b64_json: 'aGVsbG8=' }] });

      const result = await createModel(fetch).doGenerate({
        prompt,
        n: 1,
        size: undefined,
        aspectRatio: undefined,
        seed: undefined,
        providerOptions: {},
        files: undefined,
        headers: undefined,
        mask: undefined,
        abortSignal: undefined,
      });

      expect(result.response.modelId).toBe(TEST_MODEL_ID);
    });

    it('returns usage when response includes usage fields', async () => {
      const fetch = createMockFetch({
        model: TEST_MODEL_ID,
        data: [{ b64_json: 'aGVsbG8=' }],
        usage: { output_tokens: 100, total_tokens: 100 },
      });

      const result = await createModel(fetch).doGenerate({
        prompt,
        n: 1,
        size: undefined,
        aspectRatio: undefined,
        seed: undefined,
        providerOptions: {},
        files: undefined,
        headers: undefined,
        mask: undefined,
        abortSignal: undefined,
      });

      expect(result.usage).toMatchObject({
        outputTokens: 100,
        totalTokens: 100,
      });
    });

    it('returns undefined usage when response has no usage field', async () => {
      const fetch = createMockFetch({ data: [{ b64_json: 'aGVsbG8=' }] });

      const result = await createModel(fetch).doGenerate({
        prompt,
        n: 1,
        size: undefined,
        aspectRatio: undefined,
        seed: undefined,
        providerOptions: {},
        files: undefined,
        headers: undefined,
        mask: undefined,
        abortSignal: undefined,
      });

      expect(result.usage).toBeUndefined();
    });
  });

  // ─── API error ───────────────────────────────────────────────────────────────

  describe('doGenerate – API errors', () => {
    it('throws on 4xx API error response', async () => {
      const fetch = createMockFetch(
        { error: { message: 'Invalid API key', code: 'invalid_api_key' } },
        401,
      );

      await expect(
        createModel(fetch).doGenerate({
          prompt,
          n: 1,
          size: undefined,
          aspectRatio: undefined,
          seed: undefined,
          providerOptions: {},
          files: undefined,
          headers: undefined,
          mask: undefined,
        abortSignal: undefined,
        }),
      ).rejects.toThrow();
    });
  });
});
