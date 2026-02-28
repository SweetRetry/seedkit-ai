import { describe, test, expect, vi, afterEach } from 'vitest';
import { webSearch } from './web-search.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeExaBlock(items: Array<{ title: string; url: string; text?: string }>) {
  return items
    .map(
      ({ title, url, text = 'Some description text.' }) =>
        `Title: ${title}\nURL: ${url}\nText: ${text}`,
    )
    .join('\n\n');
}

function makeExaSseResponse(body: string) {
  const payload = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    result: { content: [{ type: 'text', text: body }] },
  });
  return `event: message\ndata: ${payload}\n`;
}

function mockFetch(sseText: string, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      text: async () => sseText,
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('webSearch (Exa MCP)', () => {
  test('returns query and correctly shaped results', async () => {
    mockFetch(
      makeExaSseResponse(
        makeExaBlock([{ title: 'Result One', url: 'https://example.com/1', text: 'First result' }]),
      ),
    );

    const output = await webSearch('typescript tutorial');

    expect(output.query).toBe('typescript tutorial');
    expect(output.results).toHaveLength(1);
    expect(output.results[0]).toEqual({
      title: 'Result One',
      url: 'https://example.com/1',
      description: 'First result',
    });
  });

  test('respects limit — returns at most limit results', async () => {
    const items = Array.from({ length: 6 }, (_, i) => ({
      title: `Result ${i + 1}`,
      url: `https://example.com/${i + 1}`,
    }));
    mockFetch(makeExaSseResponse(makeExaBlock(items)));

    const output = await webSearch('something', 3);

    expect(output.results).toHaveLength(3);
  });

  test('truncates description to 300 characters', async () => {
    const longText = 'x'.repeat(500);
    mockFetch(
      makeExaSseResponse(
        makeExaBlock([{ title: 'T', url: 'https://example.com', text: longText }]),
      ),
    );

    const output = await webSearch('long text');

    expect(output.results[0].description.length).toBe(300);
  });

  test('returns empty results when Exa content is empty', async () => {
    mockFetch(makeExaSseResponse(''));

    const output = await webSearch('no results');

    expect(output.results).toEqual([]);
  });

  test('returns empty results when result has no content', async () => {
    const payload = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [] } });
    mockFetch(`event: message\ndata: ${payload}\n`);

    const output = await webSearch('empty content');

    expect(output.results).toEqual([]);
  });

  test('throws on HTTP error response', async () => {
    mockFetch('', 500);

    await expect(webSearch('error case')).rejects.toThrow('Exa search failed: 500');
  });

  test('sends correct query to Exa MCP endpoint', async () => {
    mockFetch(
      makeExaSseResponse(
        makeExaBlock([{ title: 'T', url: 'https://example.com' }]),
      ),
    );

    await webSearch('my specific query', 7);

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://mcp.exa.ai/mcp');
    const body = JSON.parse(init.body as string);
    expect(body.params.arguments.query).toBe('my specific query');
    expect(body.params.arguments.numResults).toBe(7);
  });
});
