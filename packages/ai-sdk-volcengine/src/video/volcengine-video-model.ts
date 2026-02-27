import {
  AISDKError,
  type Experimental_VideoModelV3,
  type SharedV3Warning,
} from '@ai-sdk/provider';
import {
  type FetchFunction,
  combineHeaders,
  convertImageModelFileToDataUri,
  createJsonResponseHandler,
  delay,
  getFromApi,
  parseProviderOptions,
  postJsonToApi,
} from '@ai-sdk/provider-utils';
import { z } from 'zod';
import { volcengineFailedResponseHandler } from '../chat/volcengine-error';
import {
  volcengineVideoModelOptionsSchema,
  type VolcengineVideoModelOptions,
} from './volcengine-video-options';

export type VolcengineVideoModelId =
  | 'doubao-seedance-2-0-pro-250528'
  | 'doubao-seedance-1-5-pro-251215'
  | 'doubao-seedance-1-0-pro-250528'
  | 'doubao-seedance-1-0-pro-fast-251015'
  | 'doubao-seedance-1-0-lite-t2v-250428'
  | 'doubao-seedance-1-0-lite-i2v-250428'
  | (string & {});

export interface VolcengineVideoConfig {
  provider: string;
  baseURL: string;
  headers: () => Record<string, string>;
  fetch?: FetchFunction;
}

export class VolcengineVideoModel implements Experimental_VideoModelV3 {
  readonly specificationVersion = 'v3' as const;
  readonly maxVideosPerCall = 1;

  get provider(): string {
    return this.config.provider;
  }

  constructor(
    readonly modelId: VolcengineVideoModelId,
    private readonly config: VolcengineVideoConfig,
  ) {}

  async doGenerate(
    options: Parameters<Experimental_VideoModelV3['doGenerate']>[0],
  ): Promise<Awaited<ReturnType<Experimental_VideoModelV3['doGenerate']>>> {
    const warnings: SharedV3Warning[] = [];

    const videoOptions = (await parseProviderOptions({
      provider: 'volcengine',
      providerOptions: options.providerOptions,
      schema: volcengineVideoModelOptionsSchema,
    })) as VolcengineVideoModelOptions | undefined;

    // Build content array (Volcengine uses content[] instead of a flat prompt/image)
    const content: Array<Record<string, unknown>> = [];

    if (options.prompt) {
      content.push({ type: 'text', text: options.prompt });
    }

    // Map AI SDK image input to Volcengine content items
    if (options.image != null) {
      const imageUrl =
        options.image.type === 'url'
          ? options.image.url
          : convertImageModelFileToDataUri(options.image);
      content.push({
        type: 'image_url',
        image_url: { url: imageUrl },
        // role defaults to 'first_frame' when a single image is provided
      });
    }

    if (content.length === 0) {
      throw new AISDKError({
        name: 'VOLCENGINE_VIDEO_GENERATION_ERROR',
        message: 'Either prompt or image must be provided for video generation',
      });
    }

    const body: Record<string, unknown> = {
      model: this.modelId,
      content,
    };

    // Map standard AI SDK options
    if (options.aspectRatio) {
      body.ratio = options.aspectRatio;
    }

    if (options.duration != null) {
      body.duration = options.duration;
    }

    if (options.seed != null) {
      body.seed = options.seed;
    }

    // Map provider-specific options
    if (videoOptions != null) {
      const knownKeys: Array<keyof VolcengineVideoModelOptions> = [
        'resolution',
        'ratio',
        'duration',
        'frames',
        'camera_fixed',
        'watermark',
        'generate_audio',
        'draft',
        'return_last_frame',
        'service_tier',
        'execution_expires_after',
        'callback_url',
        'pollIntervalMs',
        'pollTimeoutMs',
      ];
      const skippedKeys = new Set(['pollIntervalMs', 'pollTimeoutMs']);

      for (const [key, value] of Object.entries(videoOptions)) {
        if (value == null || skippedKeys.has(key)) continue;
        // Provider ratio overrides AI SDK aspectRatio
        body[key] = value;
      }

      // Warn about unsupported standard options that were overridden
      if (videoOptions.ratio != null && options.aspectRatio != null) {
        warnings.push({ type: 'unsupported', feature: 'aspectRatio' });
      }
    }

    // Step 1: Create the async video generation task
    const { value: createResponse } = await postJsonToApi({
      url: `${this.config.baseURL}/contents/generations/tasks`,
      headers: combineHeaders(this.config.headers(), options.headers),
      body,
      failedResponseHandler: volcengineFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(
        volcengineVideoCreateResponseSchema,
      ),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    const taskId = createResponse.id;
    if (!taskId) {
      throw new AISDKError({
        name: 'VOLCENGINE_VIDEO_GENERATION_ERROR',
        message: 'No task ID returned from video generation API',
      });
    }

    // Step 2: Poll for task completion
    const pollIntervalMs = videoOptions?.pollIntervalMs ?? 5000;
    const pollTimeoutMs = videoOptions?.pollTimeoutMs ?? 600000;
    const startTime = Date.now();
    let taskResponse: VolcengineVideoTaskResponse;
    let responseHeaders: Record<string, string> | undefined;

    while (true) {
      if (options.abortSignal?.aborted) {
        throw new AISDKError({
          name: 'VOLCENGINE_VIDEO_GENERATION_ABORTED',
          message: 'Video generation request was aborted',
        });
      }

      if (Date.now() - startTime > pollTimeoutMs) {
        throw new AISDKError({
          name: 'VOLCENGINE_VIDEO_GENERATION_TIMEOUT',
          message: `Video generation timed out after ${pollTimeoutMs}ms (task: ${taskId})`,
        });
      }

      const { value: statusResponse, responseHeaders: statusHeaders } =
        await getFromApi({
          url: `${this.config.baseURL}/contents/generations/tasks/${taskId}`,
          headers: combineHeaders(this.config.headers(), options.headers),
          failedResponseHandler: volcengineFailedResponseHandler,
          successfulResponseHandler: createJsonResponseHandler(
            volcengineVideoTaskResponseSchema,
          ),
          abortSignal: options.abortSignal,
          fetch: this.config.fetch,
        });

      const status = statusResponse.status;

      if (status === 'succeeded') {
        taskResponse = statusResponse;
        responseHeaders = statusHeaders;
        break;
      }

      if (status === 'failed' || status === 'expired' || status === 'cancelled') {
        const errMsg = statusResponse.error?.message ?? `Task ${status}`;
        throw new AISDKError({
          name: 'VOLCENGINE_VIDEO_GENERATION_ERROR',
          message: `Video generation ${status}: ${errMsg} (task: ${taskId})`,
        });
      }

      // status is 'queued' or 'running' — keep polling
      await delay(pollIntervalMs);
    }

    const videoUrl = taskResponse.content?.video_url;
    if (!videoUrl) {
      throw new AISDKError({
        name: 'VOLCENGINE_VIDEO_GENERATION_ERROR',
        message: `No video URL in succeeded task response (task: ${taskId})`,
      });
    }

    return {
      videos: [
        {
          type: 'url',
          url: videoUrl,
          mediaType: 'video/mp4',
        },
      ],
      warnings,
      response: {
        timestamp: new Date(),
        modelId: taskResponse.model ?? this.modelId,
        headers: responseHeaders,
      },
      providerMetadata: {
        volcengine: {
          taskId,
          seed: taskResponse.seed,
          resolution: taskResponse.resolution,
          ratio: taskResponse.ratio,
          duration: taskResponse.duration,
          frames: taskResponse.frames,
          framespersecond: taskResponse.framespersecond,
          generate_audio: taskResponse.generate_audio,
          draft: taskResponse.draft,
          last_frame_url: taskResponse.content?.last_frame_url,
          usage: taskResponse.usage,
        },
      },
    };
  }
}

const volcengineVideoCreateResponseSchema = z.object({
  id: z.string().nullish(),
});

const volcengineVideoTaskResponseSchema = z.object({
  id: z.string().nullish(),
  model: z.string().nullish(),
  status: z
    .enum(['queued', 'running', 'succeeded', 'failed', 'expired', 'cancelled'])
    .nullish(),
  error: z
    .object({
      code: z.string().nullish(),
      message: z.string().nullish(),
    })
    .nullish(),
  content: z
    .object({
      video_url: z.string().nullish(),
      last_frame_url: z.string().nullish(),
    })
    .nullish(),
  seed: z.number().nullish(),
  resolution: z.string().nullish(),
  ratio: z.string().nullish(),
  duration: z.number().nullish(),
  frames: z.number().nullish(),
  framespersecond: z.number().nullish(),
  generate_audio: z.boolean().nullish(),
  draft: z.boolean().nullish(),
  draft_task_id: z.string().nullish(),
  service_tier: z.string().nullish(),
  execution_expires_after: z.number().nullish(),
  created_at: z.number().nullish(),
  updated_at: z.number().nullish(),
  usage: z
    .object({
      completion_tokens: z.number().nullish(),
      total_tokens: z.number().nullish(),
    })
    .nullish(),
});

type VolcengineVideoTaskResponse = z.infer<
  typeof volcengineVideoTaskResponseSchema
>;
