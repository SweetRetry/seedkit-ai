import {
  LanguageModelV3,
  NoSuchModelError,
  ProviderV3
} from "@ai-sdk/provider";
import {
  FetchFunction,
  loadApiKey,
  withUserAgentSuffix,
  withoutTrailingSlash
} from "@ai-sdk/provider-utils";
import { VERSION } from "./version";
import { VolcengineChatLanguageModel } from "./volcengine-chat-language-model";
import { VolcengineModelId } from "./volcengine-chat-options";

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
  (modelId: VolcengineModelId): LanguageModelV3;

  /**
Creates a model for text generation using the Chat Completions API.
*/
  languageModel(modelId: VolcengineModelId): LanguageModelV3;

  /**
Creates a model for text generation using the Chat Completions API.
*/
  chat(modelId: VolcengineModelId): LanguageModelV3;

  /**
Creates a model for text embeddings.
*/
  embeddingModel(modelId: VolcengineModelId): never;
}

/**
Create a Volcengine provider instance.
 */
export function createVolcengine(
  options: VolcengineProviderSettings = {}
): VolcengineProvider {
  const baseURL =
    withoutTrailingSlash(options.baseURL) ??
    "https://ark.cn-beijing.volces.com/api/v3";

  const getHeaders = () =>
    withUserAgentSuffix(
      {
        Authorization: `Bearer ${loadApiKey({
          apiKey: options.apiKey,
          environmentVariableName: "ARK_API_KEY",
          description: "Volcengine"
        })}`,
        ...options.headers
      },
      `ai-sdk/volcengine/${VERSION}`
    );

  const createChatModel = (modelId: string) =>
    new VolcengineChatLanguageModel(modelId, {
      provider: "volcengine",
      baseURL,
      headers: getHeaders,
      fetch: options.fetch,
      generateId: options.generateId
    });

  return Object.assign(
    (modelId: string) => {
      if (new.target) {
        throw new Error(
          "The Volcengine model function cannot be called with the new keyword."
        );
      }

      return createChatModel(modelId);
    },
    {
      specificationVersion: "v3" as const,
      languageModel: createChatModel,
      chat: createChatModel,
      embeddingModel: (modelId: string) => {
        throw new NoSuchModelError({ modelId, modelType: "embeddingModel" });
      },
      imageModel: (modelId: string) => {
        throw new NoSuchModelError({ modelId, modelType: "imageModel" });
      }
    }
  ) as VolcengineProvider;
}

/**
Default Volcengine provider instance.
 */
export const volcengine = createVolcengine();
