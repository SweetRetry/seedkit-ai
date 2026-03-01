import { lazySchema, zodSchema } from '@ai-sdk/provider-utils';
import { z } from 'zod';

export type SeedModelId =
  | 'doubao-seed-2-0-pro-260215'
  | 'doubao-seed-2-0-lite-260215'
  | 'doubao-seed-2-0-mini-260215'
  | 'doubao-seed-2-0-code-preview-260215'
  | 'doubao-seed-1-8-251228'
  | (string & {});

const seedChatOptionsSchema = z.object({
  /**
   * Whether to use structured outputs.
   *
   * @default true
   */
  structuredOutputs: z.boolean().optional(),

  /**
   * Whether to use strict JSON schema validation.
   *
   * @default false
   */
  strictJsonSchema: z.boolean().optional(),

  /**
   * Whether to enable parallel function calling during tool use.
   * When set to false, the model will use at most one tool per response.
   *
   * @default true
   */
  parallelToolCalls: z.boolean().optional(),

  /**
   * Whether to enable extended thinking mode.
   * When enabled, the model will generate reasoning_content in response.
   *
   * @default false
   */
  thinking: z.boolean().optional(),

  /**
   * Controls the maximum tokens for the entire completion (answer + reasoning chain).
   * When set, overrides max_tokens. Cannot be used simultaneously with max_tokens.
   * Use this with thinking-enabled models to cap total output budget.
   */
  maxCompletionTokens: z.number().int().positive().optional(),
});

export const seedChatOptions = lazySchema(() =>
  zodSchema(seedChatOptionsSchema),
);

export type SeedChatOptions = z.infer<typeof seedChatOptionsSchema>;
