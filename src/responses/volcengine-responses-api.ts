import { z } from 'zod';

const volcengineUsageSchema = z.object({
  input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
  total_tokens: z.number().optional(),
  input_tokens_details: z
    .object({
      cached_tokens: z.number().optional(),
    })
    .optional(),
  output_tokens_details: z
    .object({
      reasoning_tokens: z.number().optional(),
    })
    .optional(),
});

const volcengineResponseOutputTextSchema = z.object({
  type: z.literal('output_text'),
  text: z.string(),
});

const volcengineResponseRefusalSchema = z.object({
  type: z.literal('refusal'),
  refusal: z.string(),
});

const volcengineResponseMessageSchema = z.object({
  id: z.string().optional(),
  type: z.literal('message'),
  content: z
    .array(
      z.union([volcengineResponseOutputTextSchema, volcengineResponseRefusalSchema]),
    )
    .optional(),
});

const volcengineResponseReasoningSchema = z.object({
  id: z.string().optional(),
  type: z.literal('reasoning'),
  summary: z
    .array(
      z.object({
        type: z.literal('summary_text'),
        text: z.string(),
      }),
    )
    .optional(),
});

const volcengineResponseFunctionCallSchema = z.object({
  id: z.string(),
  type: z.literal('function_call'),
  call_id: z.string(),
  name: z.string(),
  arguments: z.string().optional(),
});

export const volcengineResponseOutputItemSchema = z.union([
  volcengineResponseMessageSchema,
  volcengineResponseReasoningSchema,
  volcengineResponseFunctionCallSchema,
]);

export const volcengineResponsesResponseSchema = z.object({
  id: z.string(),
  model: z.string().optional(),
  created_at: z.number().optional(),
  output: z.array(volcengineResponseOutputItemSchema).optional(),
  incomplete_details: z
    .object({
      reason: z.string().nullable().optional(),
    })
    .optional(),
  usage: volcengineUsageSchema.optional(),
});

export const volcengineResponsesChunkSchema = z
  .object({
    type: z.string(),
  })
  .passthrough();

export type VolcengineResponsesResponse = z.infer<
  typeof volcengineResponsesResponseSchema
>;

export type VolcengineResponsesChunk = z.infer<
  typeof volcengineResponsesChunkSchema
>;

export type VolcengineResponsesUsage = z.infer<typeof volcengineUsageSchema>;
