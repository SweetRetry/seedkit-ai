import { LanguageModelV3Usage } from '@ai-sdk/provider';

/**
 * Volcengine API usage response structure
 * @see https://www.volcengine.com/docs/82379/1494384
 */
export type VolcengineUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
};

/**
 * Converts Volcengine usage data to the AI SDK's LanguageModelV3Usage format.
 *
 * Field mappings:
 * - prompt_tokens → inputTokens.total
 * - prompt_tokens - cached_tokens → inputTokens.noCache
 * - cached_tokens → inputTokens.cacheRead
 * - completion_tokens → outputTokens.total
 * - completion_tokens - reasoning_tokens → outputTokens.text
 * - reasoning_tokens → outputTokens.reasoning
 */
export function convertVolcengineUsage(
  usage: VolcengineUsage | undefined | null,
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

  const promptTokens = usage.prompt_tokens;
  const completionTokens = usage.completion_tokens;
  const cachedTokens = usage.prompt_tokens_details?.cached_tokens;
  const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens;

  // Calculate non-cached input tokens
  const noCacheTokens =
    promptTokens != null && cachedTokens != null
      ? promptTokens - cachedTokens
      : promptTokens;

  // Calculate text output tokens (completion minus reasoning)
  const textTokens =
    completionTokens != null && reasoningTokens != null
      ? completionTokens - reasoningTokens
      : completionTokens;

  return {
    inputTokens: {
      total: promptTokens,
      noCache: noCacheTokens,
      cacheRead: cachedTokens,
      cacheWrite: undefined, // Volcengine API doesn't report cache write tokens
    },
    outputTokens: {
      total: completionTokens,
      text: textTokens,
      reasoning: reasoningTokens,
    },
    raw: usage,
  };
}
