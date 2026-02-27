import {
  ImageModelV3,
  SharedV3Warning,
} from '@ai-sdk/provider';
import {
  FetchFunction,
  combineHeaders,
  convertImageModelFileToDataUri,
  createJsonResponseHandler,
  parseProviderOptions,
  postJsonToApi,
} from '@ai-sdk/provider-utils';
import { volcengineFailedResponseHandler } from '../chat/volcengine-error';
import { volcengineImageResponseSchema } from './volcengine-image-api';
import { volcengineImageModelOptionsSchema } from './volcengine-image-options';

export type VolcengineImageModelId =
  | 'doubao-seedream-5-0-260128'
  | 'doubao-seedream-5-0-lite-260128'
  | 'doubao-seedream-4-5-251128'
  | 'doubao-seedream-4-0-250828'
  | (string & {});

export interface VolcengineImageConfig {
  provider: string;
  baseURL: string;
  headers: () => Record<string, string>;
  fetch?: FetchFunction;
}

export class VolcengineImageModel implements ImageModelV3 {
  readonly specificationVersion = 'v3' as const;

  get maxImagesPerCall(): number {
    return 4;
  }

  get provider(): string {
    return this.config.provider;
  }

  constructor(
    readonly modelId: VolcengineImageModelId,
    private readonly config: VolcengineImageConfig,
  ) {}

  async doGenerate({
    prompt,
    n,
    size,
    aspectRatio,
    seed,
    providerOptions,
    files,
    headers,
    abortSignal,
  }: Parameters<ImageModelV3['doGenerate']>[0]): Promise<
    Awaited<ReturnType<ImageModelV3['doGenerate']>>
  > {
    const warnings: SharedV3Warning[] = [];

    if (seed != null) {
      warnings.push({ type: 'unsupported', feature: 'seed' });
    }

    const volcengineOptions = await parseProviderOptions({
      provider: 'volcengine',
      providerOptions,
      schema: volcengineImageModelOptionsSchema,
    });

    // Resolve size using Volcengine's two distinct sizing modes:
    //   • "方式2" (pixel dimensions): explicit `size` from AI SDK, e.g. "2048x2048"
    //   • "方式1" (resolution tier):  `size_tier` providerOption ("2K"/"3K"/…)
    //     or aspectRatio mapped to a recommended pixel size (also 方式2)
    //
    // Priority: explicit pixel size > size_tier > aspectRatio mapping > default tier
    const resolvedSize =
      size ??
      (volcengineOptions as Record<string, unknown> | null)?.['size_tier'] ??
      convertAspectRatioToSize(aspectRatio) ??
      '2K';

    // Strip response_format and size_tier from user options before spreading —
    // response_format is always forced to b64_json; size_tier is already consumed above.
    const {
      response_format: _ignored,
      size_tier: _sizeTier,
      ...safeOptions
    } = (volcengineOptions ?? {}) as Record<string, unknown>;

    const body: Record<string, unknown> = {
      model: this.modelId,
      prompt,
      size: resolvedSize,
      n: n ?? 1,
      ...safeOptions,
      // Always use b64_json — AI SDK requires base64 data; must come last
      response_format: 'b64_json',
    };

    // Handle reference images for image-to-image generation
    if (files && files.length > 0) {
      const imageUris = files.map(file => convertImageModelFileToDataUri(file));
      body.image = imageUris.length === 1 ? imageUris[0] : imageUris;
    }

    const { value: response, responseHeaders } = await postJsonToApi({
      url: `${this.config.baseURL}/images/generations`,
      headers: combineHeaders(this.config.headers(), headers),
      body,
      failedResponseHandler: volcengineFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(
        volcengineImageResponseSchema,
      ),
      abortSignal,
      fetch: this.config.fetch,
    });

    const images: string[] = response.data.map(item => {
      if (!item.b64_json) {
        throw new Error('No base64 image data in response');
      }
      return item.b64_json;
    });

    return {
      images,
      warnings,
      response: {
        timestamp: new Date(),
        modelId: response.model ?? this.modelId,
        headers: responseHeaders,
      },
      usage: response.usage
        ? {
            inputTokens: undefined,
            outputTokens: response.usage.output_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
    };
  }
}

/**
 * Maps AI SDK aspectRatio to Volcengine pixel size strings.
 * Uses 2K tier (2048px range) as the baseline resolution.
 */
function convertAspectRatioToSize(
  aspectRatio: `${number}:${number}` | undefined,
): string | undefined {
  switch (aspectRatio) {
    case '1:1':
      return '2048x2048';
    case '16:9':
      return '2848x1600';
    case '9:16':
      return '1600x2848';
    case '4:3':
      return '2496x1664';
    case '3:4':
      return '1664x2496';
    case '21:9':
      return '3136x1344';
    default:
      return undefined;
  }
}
