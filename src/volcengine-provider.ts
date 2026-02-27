import {
  Experimental_VideoModelV3,
  ImageModelV3,
  LanguageModelV3,
  NoSuchModelError,
  ProviderV3,
} from '@ai-sdk/provider';
import {
  FetchFunction,
  loadApiKey,
  withUserAgentSuffix,
  withoutTrailingSlash,
} from '@ai-sdk/provider-utils';
import { VERSION } from './version';
import { VolcengineChatLanguageModel, VolcengineModelId } from './chat';
import { VolcengineImageModel, VolcengineImageModelId } from './image';
import {
  VolcengineResponsesLanguageModel,
  VolcengineResponsesModelId,
} from './responses';
import { VolcengineVideoModel, VolcengineVideoModelId } from './video';

export interface VolcengineProviderSettings {
  /**
Use a different URL prefix for API calls, e.g. to use proxy servers.
The default prefix is `https://ark.cn-beijing.volces.com/api/v3`.
   */
  baseURL?: string;

  /**
API key that is sent using the `Authorization` header.
It defaults to the `ARK_API_KEY` environment variable.
   */
  apiKey?: string;

  /**
Custom headers to include in the requests.
   */
  headers?: Record<string, string>;

  /**
Custom fetch implementation. You can use it as a middleware to intercept requests,
or to provide a custom fetch implementation for e.g. testing.
   */
  fetch?: FetchFunction;

  generateId?: () => string;
}

export interface VolcengineProvider extends ProviderV3 {
  (modelId: VolcengineResponsesModelId): LanguageModelV3;

  /**
Creates a model for text generation using the Responses API.
*/
  languageModel(modelId: VolcengineResponsesModelId): LanguageModelV3;

  /**
Creates a model for text generation using the Chat Completions API.
*/
  chat(modelId: VolcengineModelId): LanguageModelV3;

  /**
Creates a model for text generation using the Responses API.
*/
  responses(modelId: VolcengineResponsesModelId): LanguageModelV3;

  /**
Creates a model for image generation.
*/
  imageModel(modelId: VolcengineImageModelId): ImageModelV3;

  /**
Creates a model for video generation (Seedance series).
*/
  videoModel(modelId: VolcengineVideoModelId): Experimental_VideoModelV3;

  /**
Creates a model for text embeddings.
*/
  embeddingModel(modelId: VolcengineModelId): never;
}

/**
Create a Volcengine provider instance.
 */
export function createVolcengine(
  options: VolcengineProviderSettings = {},
): VolcengineProvider {
  const baseURL =
    withoutTrailingSlash(options.baseURL) ??
    'https://ark.cn-beijing.volces.com/api/v3';

  const getHeaders = () =>
    withUserAgentSuffix(
      {
        Authorization: `Bearer ${loadApiKey({
          apiKey: options.apiKey,
          environmentVariableName: 'ARK_API_KEY',
          description: 'Volcengine',
        })}`,
        ...options.headers,
      },
      `ai-sdk/volcengine/${VERSION}`,
    );

  const createChatModel = (modelId: string) =>
    new VolcengineChatLanguageModel(modelId, {
      provider: 'volcengine.chat',
      baseURL,
      headers: getHeaders,
      fetch: options.fetch,
      generateId: options.generateId,
    });

  const createImageModel = (modelId: string) =>
    new VolcengineImageModel(modelId, {
      provider: 'volcengine.image',
      baseURL,
      headers: getHeaders,
      fetch: options.fetch,
    });

  const createResponsesModel = (modelId: string) =>
    new VolcengineResponsesLanguageModel(modelId, {
      provider: 'volcengine.responses',
      baseURL,
      headers: getHeaders,
      fetch: options.fetch,
    });

  const createVideoModel = (modelId: string) =>
    new VolcengineVideoModel(modelId, {
      provider: 'volcengine.video',
      baseURL,
      headers: getHeaders,
      fetch: options.fetch,
    });

  const provider = function (modelId: VolcengineResponsesModelId) {
    return createResponsesModel(modelId);
  };

  provider.specificationVersion = 'v3' as const;
  provider.languageModel = createResponsesModel;
  provider.chat = createChatModel;
  provider.responses = createResponsesModel;
  provider.imageModel = createImageModel;
  provider.videoModel = createVideoModel;
  provider.embeddingModel = (modelId: string) => {
    throw new NoSuchModelError({ modelId, modelType: 'embeddingModel' });
  };

  return provider as VolcengineProvider;
}

/**
Default Volcengine provider instance.
 */
export const volcengine = createVolcengine();
