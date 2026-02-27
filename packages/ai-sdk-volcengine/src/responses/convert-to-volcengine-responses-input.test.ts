import { describe, expect, it } from 'vitest';
import { convertToVolcengineResponsesInput } from './convert-to-volcengine-responses-input';

describe('convertToVolcengineResponsesInput', () => {
  it('extracts instructions from system messages', async () => {
    const result = await convertToVolcengineResponsesInput({
      prompt: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'system', content: 'Always reply in Chinese.' },
        {
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }],
        },
      ],
    });

    expect(result.instructions).toBe(
      'You are a helpful assistant.\nAlways reply in Chinese.',
    );
    expect(result.input).toEqual([
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Hello' }],
      },
    ]);
  });

  it('converts assistant tool calls and tool results', async () => {
    const result = await convertToVolcengineResponsesInput({
      prompt: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call_1',
              toolName: 'get_weather',
              input: { city: 'Beijing' },
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call_1',
              toolName: 'get_weather',
              output: {
                type: 'json',
                value: { weather: 'sunny' },
              },
            },
          ],
        },
      ],
    });

    expect(result.input).toEqual([
      {
        type: 'function_call',
        call_id: 'call_1',
        name: 'get_weather',
        arguments: '{"city":"Beijing"}',
      },
      {
        type: 'function_call_output',
        call_id: 'call_1',
        output: '{"weather":"sunny"}',
      },
    ]);
  });
});
