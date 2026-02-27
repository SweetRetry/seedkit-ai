import { lazySchema, zodSchema } from '@ai-sdk/provider-utils';
import { z } from 'zod';

export type VolcengineResponsesModelId =
  | 'doubao-seed-2-0-pro-260215'
  | 'doubao-seed-2-0-lite-260215'
  | 'doubao-seed-2-0-mini-260215'
  | 'doubao-seed-2-0-code-preview-260215'
  | 'doubao-seed-1-8-251228'
  | 'doubao-seed-code-preview-251028'
  | 'doubao-seed-1-6-vision-250815'
  | 'doubao-seed-1-6-251015'
  | 'doubao-seed-1-6-lite-251015'
  | 'doubao-seed-1-6-flash-250828'
  | 'doubao-seed-1-6-flash-250715'
  | 'doubao-seed-1-6-flash-250615'
  | 'doubao-seed-1-6-250615'
  | (string & {});

const volcengineResponsesOptionsSchema = z.object({
  /**
   * Whether to use structured outputs.
   *
   * @default true
   */
  structuredOutputs: z.boolean().optional(),

  /**
   * Whether to use strict JSON schema validation.
   *
   * @default true
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
   * Control the thinking mode.
   * - `true` / `'enabled'`: force enable thinking
   * - `false` / `'disabled'`: force disable thinking
   * - `'auto'`: let the model decide (only doubao-seed-1-6-250615)
   *
   * @default undefined (not sent)
   */
  thinking: z.union([z.boolean(), z.enum(['enabled', 'disabled', 'auto'])]).optional(),

  /**
   * Control the depth of thinking. Only effective when thinking is enabled.
   * - `'minimal'`: disable thinking, answer directly
   * - `'low'`: lightweight thinking, faster response
   * - `'medium'`: balanced mode (default)
   * - `'high'`: deep analysis for complex problems
   */
  reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high']).optional(),

  /**
   * Whether to store the response context on the server side.
   *
   * @default true
   */
  store: z.boolean().optional(),

  /**
   * Continue a previous response by ID.
   */
  previousResponseId: z.string().optional(),
});

export const volcengineResponsesOptions = lazySchema(() =>
  zodSchema(volcengineResponsesOptionsSchema),
);

export type VolcengineResponsesOptions = z.infer<
  typeof volcengineResponsesOptionsSchema
>;
