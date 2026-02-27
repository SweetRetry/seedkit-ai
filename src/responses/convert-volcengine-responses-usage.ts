import { LanguageModelV3Usage } from '@ai-sdk/provider';
import { VolcengineResponsesUsage } from './volcengine-responses-api';

export function convertVolcengineResponsesUsage(
  usage: VolcengineResponsesUsage | undefined | null,
): LanguageModelV3Usage {
  if (usage == null) {
    return {
      inputTokens: {
        total: undefined,
        noCache: undefined,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: {
        total: undefined,
        text: undefined,
        reasoning: undefined,
      },
    };
  }

  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens;
  const cachedTokens = usage.input_tokens_details?.cached_tokens;
  const reasoningTokens = usage.output_tokens_details?.reasoning_tokens;

  return {
    inputTokens: {
      total: inputTokens,
      noCache:
        inputTokens != null && cachedTokens != null
          ? inputTokens - cachedTokens
          : inputTokens,
      cacheRead: cachedTokens,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: outputTokens,
      text:
        outputTokens != null && reasoningTokens != null
          ? outputTokens - reasoningTokens
          : outputTokens,
      reasoning: reasoningTokens,
    },
    raw: usage,
  };
}
