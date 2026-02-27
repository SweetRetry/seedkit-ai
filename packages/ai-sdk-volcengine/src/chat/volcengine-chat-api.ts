import { InferSchema, lazySchema, zodSchema } from '@ai-sdk/provider-utils';
import { z } from 'zod';

const volcengineUsageSchema = z.object({
  prompt_tokens: z.number().nullish(),
  completion_tokens: z.number().nullish(),
  total_tokens: z.number().nullish(),
  prompt_tokens_details: z
    .object({
      cached_tokens: z.number().nullish(),
    })
    .nullish(),
  completion_tokens_details: z
    .object({
      reasoning_tokens: z.number().nullish(),
    })
    .nullish(),
});

const volcengineToolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
});

const volcengineMessageSchema = z.object({
  role: z.literal('assistant'),
  content: z.string().nullish(),
  reasoning_content: z.string().nullish(),
  tool_calls: z.array(volcengineToolCallSchema).nullish(),
});

export const volcengineChatResponseSchema = lazySchema(() =>
  zodSchema(
    z.object({
      id: z.string().nullish(),
      object: z.string().nullish(),
      created: z.number().nullish(),
      model: z.string().nullish(),
      choices: z.array(
        z.object({
          index: z.number(),
          message: volcengineMessageSchema,
          finish_reason: z.string().nullish(),
        }),
      ),
      usage: volcengineUsageSchema.nullish(),
    }),
  ),
);

export const volcengineChatChunkSchema = lazySchema(() =>
  zodSchema(
    z.object({
      id: z.string().nullish(),
      object: z.string().nullish(),
      created: z.number().nullish(),
      model: z.string().nullish(),
      choices: z
        .array(
          z.object({
            index: z.number(),
            delta: z.object({
              role: z.string().nullish(),
              content: z.string().nullish(),
              reasoning_content: z.string().nullish(),
              tool_calls: z
                .array(
                  z.object({
                    index: z.number(),
                    id: z.string().nullish(),
                    type: z.literal('function').nullish(),
                    function: z
                      .object({
                        name: z.string().nullish(),
                        arguments: z.string().nullish(),
                      })
                      .nullish(),
                  }),
                )
                .nullish(),
            }),
            finish_reason: z.string().nullish(),
          }),
        )
        .nullish(),
      usage: volcengineUsageSchema.nullish(),
    }),
  ),
);

export type VolcengineChatResponse = InferSchema<
  typeof volcengineChatResponseSchema
>;
export type VolcengineChatChunk = InferSchema<typeof volcengineChatChunkSchema>;
