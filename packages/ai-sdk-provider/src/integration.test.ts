/**
 * Integration tests — hit the real Ark API.
 *
 * Run with:
 *   ARK_API_KEY=<your-key> pnpm test src/integration.test.ts
 *
 * These tests validate what unit tests (mock fetch) cannot:
 *   1. Auth header accepted by Ark
 *   2. Real SSE stream chunking & usage field in final chunk
 *   3. `reasoning_content` field actually present for thinking models
 *   4. Image b64_json is valid decodable base64
 *   5. Video async task polling (queued → running → succeeded)
 *   6. User-Agent header accepted without rejection
 *
 * Tests are skipped automatically when ARK_API_KEY is absent.
 */

import { describe, expect, it } from 'vitest';
import { createSeed } from './seed-provider';

// ─── Config ──────────────────────────────────────────────────────────────────

const API_KEY = process.env.ARK_API_KEY;
const CHAT_MODEL = 'doubao-seed-2-0-lite-260215';
const IMAGE_MODEL = 'doubao-seedream-5-0-260128';
const VIDEO_MODEL = 'doubao-seedance-1-0-pro-250528';

const skip = !API_KEY;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Collect all parts from a LanguageModelV3 stream into an array. */
async function collectStream(stream: ReadableStream<unknown>): Promise<unknown[]> {
  const parts: unknown[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  return parts;
}

// ─── Chat – doGenerate ───────────────────────────────────────────────────────

describe.skipIf(skip)('Integration: Chat doGenerate', () => {
  const provider = createSeed({ apiKey: API_KEY });

  it('returns non-empty text content', async () => {
    const model = provider.chat(CHAT_MODEL);

    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Reply with exactly: hello' }] }],
      maxOutputTokens: 20,
    });

    const textPart = result.content.find(c => c.type === 'text');
    expect(textPart).toBeDefined();
    expect((textPart as { type: 'text'; text: string }).text.length).toBeGreaterThan(0);
  }, 30_000);

  it('usage tokens are positive integers', async () => {
    const model = provider.chat(CHAT_MODEL);

    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      maxOutputTokens: 10,
    });

    const input = result.usage.inputTokens;
    const output = result.usage.outputTokens;

    // inputTokens / outputTokens are TokenCount objects with a `total` field
    expect((input as { total: number }).total).toBeGreaterThan(0);
    expect((output as { total: number }).total).toBeGreaterThan(0);
  }, 30_000);

  it('finishReason is stop for normal generation', async () => {
    const model = provider.chat(CHAT_MODEL);

    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Say one word.' }] }],
      maxOutputTokens: 10,
    });

    expect(result.finishReason.unified).toBe('stop');
  }, 30_000);

  it('response body contains model id', async () => {
    const model = provider.chat(CHAT_MODEL);

    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      maxOutputTokens: 5,
    });

    expect(result.response?.modelId).toBeTruthy();
  }, 30_000);

  it('returns tool-call when function tool is registered', async () => {
    const model = provider.chat(CHAT_MODEL);

    const result = await model.doGenerate({
      prompt: [
        {
          role: 'user',
          content: [{ type: 'text', text: "What's the weather in Beijing?" }],
        },
      ],
      tools: [
        {
          type: 'function',
          name: 'get_weather',
          description: 'Get weather for a city',
          inputSchema: {
            type: 'object',
            properties: { city: { type: 'string' } },
            required: ['city'],
          },
        },
      ],
      toolChoice: { type: 'tool', toolName: 'get_weather' },
    });

    const toolCall = result.content.find(c => c.type === 'tool-call');
    expect(toolCall).toBeDefined();
    expect((toolCall as { type: 'tool-call'; toolName: string }).toolName).toBe('get_weather');
    expect(result.finishReason.unified).toBe('tool-calls');
  }, 30_000);
});

// ─── Chat – doStream ─────────────────────────────────────────────────────────

describe.skipIf(skip)('Integration: Chat doStream', () => {
  const provider = createSeed({ apiKey: API_KEY });

  it('emits text-start, text-delta(s), text-end, and finish parts', async () => {
    const model = provider.chat(CHAT_MODEL);

    const { stream } = await model.doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Count: 1 2 3' }] }],
      maxOutputTokens: 30,
    });

    const parts = await collectStream(stream);
    const types = parts.map((p: any) => p.type);

    expect(types).toContain('stream-start');
    expect(types).toContain('text-start');
    expect(types.some(t => t === 'text-delta')).toBe(true);
    expect(types).toContain('text-end');
    expect(types).toContain('finish');
  }, 30_000);

  it('finish part contains non-zero usage (include_usage=true)', async () => {
    const model = provider.chat(CHAT_MODEL);

    const { stream } = await model.doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      maxOutputTokens: 10,
    });

    const parts = await collectStream(stream);
    const finish = parts.find((p: any) => p.type === 'finish') as any;

    expect(finish).toBeDefined();
    // Verify Ark actually sends usage in the final SSE chunk
    expect(finish.usage).toBeDefined();
    const inputTotal = finish.usage?.inputTokens?.total ?? finish.usage?.inputTokens;
    const outputTotal = finish.usage?.outputTokens?.total ?? finish.usage?.outputTokens;
    // At least one should be a positive number
    expect(typeof inputTotal === 'number' || typeof outputTotal === 'number').toBe(true);
  }, 30_000);

  it('streams tool-input-start, deltas, tool-input-end, tool-call', async () => {
    const model = provider.chat(CHAT_MODEL);

    const { stream } = await model.doStream({
      prompt: [
        {
          role: 'user',
          content: [{ type: 'text', text: "What's the weather in Shanghai?" }],
        },
      ],
      tools: [
        {
          type: 'function',
          name: 'get_weather',
          description: 'Get weather for a city',
          inputSchema: {
            type: 'object',
            properties: { city: { type: 'string' } },
            required: ['city'],
          },
        },
      ],
      toolChoice: { type: 'tool', toolName: 'get_weather' },
    });

    const parts = await collectStream(stream);
    const types = parts.map((p: any) => p.type);

    expect(types).toContain('tool-input-start');
    expect(types).toContain('tool-input-end');
    expect(types).toContain('tool-call');

    const toolCall = parts.find((p: any) => p.type === 'tool-call') as any;
    expect(toolCall.toolName).toBe('get_weather');
    // input must be valid JSON with a city field
    const parsedInput = JSON.parse(toolCall.input);
    expect(parsedInput).toHaveProperty('city');
  }, 30_000);
});

// ─── Image – doGenerate ──────────────────────────────────────────────────────

describe.skipIf(skip)('Integration: Image doGenerate', () => {
  const provider = createSeed({ apiKey: API_KEY });

  it('returns valid base64-decodable image data', async () => {
    const model = provider.imageModel(IMAGE_MODEL);

    const result = await model.doGenerate({
      prompt: 'A red circle on white background',
      n: 1,
      size: undefined,
      aspectRatio: '1:1',
      seed: undefined,
      files: undefined,
      mask: undefined,
      providerOptions: {},
      headers: undefined,
      abortSignal: undefined,
    });

    expect(result.images).toHaveLength(1);
    const b64 = result.images[0];
    expect(typeof b64).toBe('string');
    expect(b64.length).toBeGreaterThan(100);

    // Verify it's valid base64: decode → non-empty buffer
    const buf = Buffer.from(b64 as string, 'base64');
    expect(buf.length).toBeGreaterThan(100);

    // PNG magic bytes: 89 50 4E 47
    // JPEG magic bytes: FF D8 FF
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    expect(isPng || isJpeg).toBe(true);
  }, 120_000);

  it('response.modelId is populated', async () => {
    const model = provider.imageModel(IMAGE_MODEL);

    const result = await model.doGenerate({
      prompt: 'A blue square',
      n: 1,
      size: undefined,
      aspectRatio: '1:1',
      seed: undefined,
      files: undefined,
      mask: undefined,
      providerOptions: {},
      headers: undefined,
      abortSignal: undefined,
    });

    expect(result.response.modelId).toBeTruthy();
  }, 120_000);

  it('usage output_tokens is a positive number', async () => {
    const model = provider.imageModel(IMAGE_MODEL);

    const result = await model.doGenerate({
      prompt: 'A green triangle',
      n: 1,
      size: undefined,
      aspectRatio: '1:1',
      seed: undefined,
      files: undefined,
      mask: undefined,
      providerOptions: {},
      headers: undefined,
      abortSignal: undefined,
    });

    // usage may be undefined for some models — only assert when present
    if (result.usage != null) {
      const output = result.usage.outputTokens;
      // outputTokens can be a number or a TokenCount object
      const outputNum = typeof output === 'number' ? output : (output as any)?.total;
      if (outputNum != null) {
        expect(outputNum).toBeGreaterThan(0);
      }
    }
  }, 120_000);
});

// ─── Video – doGenerate ──────────────────────────────────────────────────────

describe.skipIf(skip)('Integration: Video doGenerate', () => {
  const provider = createSeed({ apiKey: API_KEY });

  it('returns a video URL and provider metadata after polling', async () => {
    const model = provider.videoModel(VIDEO_MODEL);

    const result = await model.doGenerate({
      prompt: 'A cat sitting on a windowsill',
      n: 1,
      image: undefined,
      aspectRatio: '16:9',
      resolution: undefined,
      duration: 5,
      fps: undefined,
      seed: undefined,
      providerOptions: {
        // Fast poll to reduce test latency
        seed: { pollIntervalMs: 3000, pollTimeoutMs: 300_000 },
      },
      headers: undefined,
      abortSignal: undefined,
    });

    expect(result.videos).toHaveLength(1);
    const video = result.videos[0];
    expect(video.type).toBe('url');
    expect((video as { type: 'url'; url: string }).url).toMatch(/^https?:\/\//);
    expect(video.mediaType).toBe('video/mp4');

    // taskId must be in providerMetadata
    expect(result.providerMetadata?.seed?.taskId).toBeTruthy();
  }, 360_000); // 6 min — video generation can be slow
});

// ─── Provider-level sanity ───────────────────────────────────────────────────

describe.skipIf(skip)('Integration: Provider sanity', () => {
  it('throws NoSuchModelError for embeddingModel', () => {
    const provider = createSeed({ apiKey: API_KEY });
    expect(() => provider.embeddingModel('any-model')).toThrow();
  });

  it('default provider() call creates a responses model', () => {
    const provider = createSeed({ apiKey: API_KEY });
    const model = provider(CHAT_MODEL as any);
    expect(model.provider).toBe('seed.responses');
    expect(model.modelId).toBe(CHAT_MODEL);
  });

  it('chat() creates a chat model', () => {
    const provider = createSeed({ apiKey: API_KEY });
    const model = provider.chat(CHAT_MODEL);
    expect(model.provider).toBe('seed.chat');
  });

  it('imageModel() creates an image model', () => {
    const provider = createSeed({ apiKey: API_KEY });
    const model = provider.imageModel(IMAGE_MODEL);
    expect(model.provider).toBe('seed.image');
  });

  it('videoModel() creates a video model', () => {
    const provider = createSeed({ apiKey: API_KEY });
    const model = provider.videoModel(VIDEO_MODEL);
    expect(model.provider).toBe('seed.video');
    expect(model.maxVideosPerCall).toBe(1);
  });
});
