import { lazySchema, zodSchema } from '@ai-sdk/provider-utils';
import { z } from 'zod';

export type VolcengineModelId =
  | 'doubao-seed-1-8-251228'
  | 'doubao-seed-code-preview-251028'
  | 'doubao-seed-1-6-lite-251015'
  | 'doubao-seed-1-6-flash-250828'
  | 'doubao-seed-1-6-vision-250815'
  | (string & {});

const volcengineChatOptionsSchema = z.object({
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
});

export const volcengineChatOptions = lazySchema(() =>
  zodSchema(volcengineChatOptionsSchema),
);

export type VolcengineChatOptions = z.infer<typeof volcengineChatOptionsSchema>;
