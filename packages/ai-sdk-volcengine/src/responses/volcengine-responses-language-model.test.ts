import { describe, expect, it, vi } from 'vitest';
import { VolcengineResponsesLanguageModel } from './volcengine-responses-language-model';

const createMockFetch = (response: unknown, status = 200) => {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(response),
    text: () => Promise.resolve(JSON.stringify(response)),
  });
};

const createStreamingMockFetch = (chunks: string[]) => {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    }),
  });
};

const createModel = (fetchMock?: typeof fetch) =>
  new VolcengineResponsesLanguageModel('test-model', {
    provider: 'volcengine.responses',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    headers: () => ({ Authorization: 'Bearer test-key' }),
    fetch: fetchMock,
  });

describe('VolcengineResponsesLanguageModel', () => {
  it('generates text from response message output', async () => {
    const model = createModel(
      createMockFetch({
        id: 'resp_123',
        model: 'test-model',
        created_at: 1732000000,
        output: [
          {
            id: 'msg_1',
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: 'Hello from responses API',
              },
            ],
          },
        ],
        usage: {
          input_tokens: 10,
          output_tokens: 6,
        },
      }),
    );

    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    });

    expect(result.content).toEqual([
      { type: 'text', text: 'Hello from responses API' },
    ]);
    expect(result.finishReason).toEqual({ unified: 'stop', raw: undefined });
    expect(result.usage.inputTokens.total).toBe(10);
    expect(result.usage.outputTokens.total).toBe(6);
  });

  it('generates tool-call content', async () => {
    const model = createModel(
      createMockFetch({
        id: 'resp_124',
        output: [
          {
            id: 'fc_1',
            type: 'function_call',
            call_id: 'call_1',
            name: 'get_weather',
            arguments: '{"city":"beijing"}',
          },
        ],
        incomplete_details: {
          reason: null,
        },
      }),
    );

    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'weather' }] }],
    });

    expect(result.content).toEqual([
      {
        type: 'tool-call',
        toolCallId: 'call_1',
        toolName: 'get_weather',
        input: '{"city":"beijing"}',
      },
    ]);
    expect(result.finishReason.unified).toBe('tool-calls');
  });

  it('streams text deltas', async () => {
    const chunks = [
      'data: {"type":"response.output_item.added","item":{"type":"message","id":"msg_1"}}\n\n',
      'data: {"type":"response.output_text.delta","item_id":"msg_1","delta":"Hello"}\n\n',
      'data: {"type":"response.output_text.delta","item_id":"msg_1","delta":" world"}\n\n',
      'data: {"type":"response.output_item.done","item":{"type":"message","id":"msg_1"}}\n\n',
      'data: {"type":"response.completed","response":{"incomplete_details":{"reason":null},"usage":{"input_tokens":4,"output_tokens":2}}}\n\n',
      'data: [DONE]\n\n',
    ];

    const model = createModel(createStreamingMockFetch(chunks));
    const result = await model.doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    });

    const reader = result.stream.getReader();
    const parts: Array<{ type: string; [key: string]: unknown }> = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value as { type: string; [key: string]: unknown });
    }

    expect(parts.some(part => part.type === 'text-start')).toBe(true);
    expect(
      parts.filter(part => part.type === 'text-delta').map(part => part.delta),
    ).toEqual(['Hello', ' world']);
    expect(parts.some(part => part.type === 'finish')).toBe(true);
  });
});
