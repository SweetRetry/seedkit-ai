import { InferSchema, zodSchema } from '@ai-sdk/provider-utils';
import { z } from 'zod';

export const volcengineVideoModelOptionsSchema = zodSchema(
  z
    .object({
      /**
       * Video resolution: '480p' | '720p' | '1080p'
       * Default: '720p' for Seedance 1.5 pro & lite, '1080p' for Seedance 1.0 pro & pro-fast
       */
      resolution: z.enum(['480p', '720p', '1080p']).nullish(),

      /**
       * Video aspect ratio.
       * 'adaptive' auto-selects based on input image (i2v) or model default (t2v, Seedance 1.5 pro only).
       */
      ratio: z
        .enum(['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'])
        .nullish(),

      /**
       * Duration in seconds (2-12). Seedance 1.5 pro supports 4-12 or -1 (auto).
       * Mutually exclusive with `frames`.
       */
      duration: z.number().int().nullish(),

      /**
       * Number of frames. Valid values in [29, 289] matching `25 + 4n`.
       * Not supported by Seedance 1.5 pro. Mutually exclusive with `duration`.
       */
      frames: z.number().int().nullish(),

      /**
       * Whether to fix the camera (no camera movement).
       * Not supported in reference-image mode.
       * Default: false
       */
      camera_fixed: z.boolean().nullish(),

      /**
       * Whether to add a watermark to the output video.
       * Default: false
       */
      watermark: z.boolean().nullish(),

      /**
       * Whether to generate audio synchronized with the video.
       * Only supported by Seedance 1.5 pro. Default: true
       */
      generate_audio: z.boolean().nullish(),

      /**
       * Enable draft (preview) mode for low-cost validation.
       * Only supported by Seedance 1.5 pro. Default: false
       */
      draft: z.boolean().nullish(),

      /**
       * Whether to return the last frame of the generated video.
       * Useful for chaining multiple videos. Default: false
       */
      return_last_frame: z.boolean().nullish(),

      /**
       * Service tier: 'default' (online) or 'flex' (offline, 50% cost).
       * Default: 'default'
       */
      service_tier: z.enum(['default', 'flex']).nullish(),

      /**
       * Task timeout threshold in seconds. Range: [3600, 259200]. Default: 172800 (48h).
       */
      execution_expires_after: z.number().int().nullish(),

      /**
       * Webhook callback URL for task status changes.
       */
      callback_url: z.string().nullish(),

      /**
       * Poll interval in milliseconds. Default: 5000 (5 seconds).
       */
      pollIntervalMs: z.number().positive().nullish(),

      /**
       * Poll timeout in milliseconds. Default: 600000 (10 minutes).
       */
      pollTimeoutMs: z.number().positive().nullish(),
    })
    .passthrough(),
);

export type VolcengineVideoModelOptions = InferSchema<
  typeof volcengineVideoModelOptionsSchema
>;
