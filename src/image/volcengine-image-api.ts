import { z } from "zod";

/**
 * Response schema for Volcengine image generation API.
 *
 * Uses a minimal schema to limit breakages when the API changes
 * and increases efficiency.
 */
export const volcengineImageResponseSchema = z.object({
  model: z.string().optional(),
  created: z.number().optional(),
  data: z.array(
    z.object({
      url: z.string().optional(),
      b64_json: z.string().optional(),
      size: z.string().optional(),
    })
  ),
  usage: z
    .object({
      generated_images: z.number().optional(),
      output_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .optional(),
});

export type VolcengineImageResponse = z.infer<typeof volcengineImageResponseSchema>;
