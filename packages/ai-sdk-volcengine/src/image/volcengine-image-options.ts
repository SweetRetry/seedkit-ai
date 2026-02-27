import { InferSchema, zodSchema } from '@ai-sdk/provider-utils';
import { z } from 'zod';

export const volcengineImageModelOptionsSchema = zodSchema(
  z
    .object({
      /**
       * Resolution tier for the output image.
       * Use this instead of `size` when you want to let the model choose the
       * aspect ratio based on the prompt (Volcengine "方式1").
       *
       * - Seedream 5.0 lite: "2K" | "3K"
       * - Seedream 4.5:      "2K" | "4K"
       * - Seedream 4.0:      "1K" | "2K" | "4K"
       *
       * When set, takes priority over the standard `aspectRatio` parameter but
       * is overridden by an explicit pixel `size` (e.g. "2048x2048").
       */
      size_tier: z.enum(['1K', '2K', '3K', '4K']).nullish(),

      /**
       * Whether to add a watermark to the output image.
       * Default: false
       */
      watermark: z.boolean().nullish(),

      /**
       * Output image file format.
       * Only supported by Seedream 5.0 lite.
       */
      output_format: z.enum(['jpeg', 'png']).nullish(),

      /**
       * Controls sequential (comic strip / storyboard) image generation mode.
       * - "auto": generate a group of related images
       * - "disabled": generate a single merged image from multiple references
       */
      sequential_image_generation: z.enum(['auto', 'disabled']).nullish(),

      /**
       * Enable web search to enhance image generation with real-time information.
       * Only supported by Seedream 5.0 lite.
       */
      tools: z
        .array(z.object({ type: z.literal('web_search') }))
        .nullish(),

      /**
       * Prompt optimization mode.
       * - "standard": default high-quality mode
       * - "fast": faster but lower quality (Seedream 4.0 only)
       */
      optimize_prompt_options: z
        .object({
          mode: z.enum(['standard', 'fast']),
        })
        .nullish(),

      /**
       * Enable streaming output — returns each generated image as soon as it's ready.
       */
      stream: z.boolean().nullish(),
    })
    .passthrough(),
);

export type VolcengineImageModelOptions = InferSchema<
  typeof volcengineImageModelOptionsSchema
>;
