import {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3ToolCall,
  LanguageModelV3Usage,
  NoContentGeneratedError,
  SharedV3Warning,
} from '@ai-sdk/provider';
import {
  FetchFunction,
  ParseResult,
  combineHeaders,
  createEventSourceResponseHandler,
  createJsonResponseHandler,
  generateId,
  injectJsonInstructionIntoMessages,
  parseProviderOptions,
  postJsonToApi,
  removeUndefinedEntries,
} from '@ai-sdk/provider-utils';
import { convertToVolcengineChatMessages } from './convert-to-volcengine-chat-message';
import { convertVolcengineUsage } from './convert-volcengine-chat-usage';
import { getResponseMetadata } from './get-response-metadata';
import { mapVolcengineFinishReason } from './map-volcengine-finish-reason';
import {
  VolcengineChatChunk,
  VolcengineChatResponse,
  volcengineChatChunkSchema,
  volcengineChatResponseSchema,
} from './volcengine-chat-api';
import {
  volcengineChatOptions,
  VolcengineChatOptions,
} from './volcengine-chat-options';
import { volcengineFailedResponseHandler } from './volcengine-error';
import { prepareTools } from './volcengine-prepare-tools';

export type VolcengineChatConfig = {
  provider: string;
  baseURL: string;
  headers: () => Record<string, string>;
  fetch?: FetchFunction;
};

export class VolcengineChatLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = 'v3' as const;
  readonly provider: string;
  readonly modelId: string;
  readonly supportedUrls: Record<string, RegExp[]> = {};

  private readonly config: VolcengineChatConfig;

  constructor(modelId: string, config: VolcengineChatConfig) {
    this.modelId = modelId;
    this.provider = config.provider;
    this.config = config;
  }

  private async getArgs({
    responseFormat,
    prompt,
    maxOutputTokens,
    temperature,
    topP,
    topK,
    presencePenalty,
    frequencyPenalty,
    stopSequences,
    seed,
    tools,
    toolChoice,
    providerOptions,
  }: LanguageModelV3CallOptions) {
    const warnings: SharedV3Warning[] = [];

    // Parse provider options
    const options =
      (await parseProviderOptions<VolcengineChatOptions>({
        provider: 'volcengine',
        providerOptions,
        schema: volcengineChatOptions,
      })) ?? {};

    // Unsupported features warnings
    if (topK != null) {
      warnings.push({
        type: 'unsupported',
        feature: 'topK',
      });
    }

    if (presencePenalty != null) {
      warnings.push({
        type: 'unsupported',
        feature: 'presencePenalty',
      });
    }

    if (frequencyPenalty != null) {
      warnings.push({
        type: 'unsupported',
        feature: 'frequencyPenalty',
      });
    }

    if (stopSequences != null && stopSequences.length > 0) {
      warnings.push({
        type: 'unsupported',
        feature: 'stopSequences',
      });
    }

    // Handle response format
    let messages = convertToVolcengineChatMessages(prompt);
    let responseFormatConfig: Record<string, unknown> | undefined;

    if (responseFormat?.type === 'json') {
      if (
        responseFormat.schema != null &&
        options.structuredOutputs !== false
      ) {
        responseFormatConfig = {
          type: 'json_schema',
          json_schema: {
            name: responseFormat.name ?? 'response',
            description: responseFormat.description,
            schema: responseFormat.schema,
            strict: options.strictJsonSchema ?? false,
          },
        };
      } else {
        responseFormatConfig = { type: 'json_object' };
        messages = convertToVolcengineChatMessages(
          injectJsonInstructionIntoMessages({
            messages: prompt,
            schema: responseFormat.schema,
          }),
        );
      }
    }

    // Prepare tools
    const {
      tools: volcengineTools,
      toolChoice: volcengineToolChoice,
      toolWarnings,
    } = await prepareTools({ tools, toolChoice });

    // Convert boolean thinking option to Volcengine API format
    const thinkingConfig =
      options.thinking === true
        ? { type: 'enabled' as const }
        : options.thinking === false
          ? { type: 'disabled' as const }
          : undefined;

    return {
      args: removeUndefinedEntries({
        model: this.modelId,
        messages,
        ...(options.maxCompletionTokens != null
          ? { max_completion_tokens: options.maxCompletionTokens }
          : { max_tokens: maxOutputTokens }),
        temperature,
        top_p: topP,
        seed,
        response_format: responseFormatConfig,
        tools: volcengineTools,
        tool_choice: volcengineToolChoice,
        parallel_tool_calls: options.parallelToolCalls,
        thinking: thinkingConfig,
      }),
      warnings: [...warnings, ...toolWarnings],
    };
  }

  async doGenerate(
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3GenerateResult> {
    const { args, warnings } = await this.getArgs(options);

    const { value: response, responseHeaders } = await postJsonToApi({
      url: `${this.config.baseURL}/chat/completions`,
      headers: combineHeaders(this.config.headers(), options.headers),
      body: args,
      failedResponseHandler: volcengineFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(
        volcengineChatResponseSchema,
      ),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    const choice = response.choices[0];

    if (!choice) {
      throw new NoContentGeneratedError({
        message: 'No choices returned in response',
      });
    }

    const content = this.extractContent(choice.message);
    const usage = convertVolcengineUsage(response.usage);
    const finishReason = mapVolcengineFinishReason(choice.finish_reason);

    return {
      content,
      usage,
      finishReason,
      warnings,
      request: {
        body: {
          ...args,
          stream: false,
        },
      },
      response: {
        ...getResponseMetadata(response),
        headers: responseHeaders,
        body: response,
      },
    };
  }

  async doStream(
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3StreamResult> {
    const { args, warnings } = await this.getArgs(options);

    const { value: eventStream, responseHeaders } = await postJsonToApi({
      url: `${this.config.baseURL}/chat/completions`,
      headers: combineHeaders(this.config.headers(), options.headers),
      body: { ...args, stream: true, stream_options: { include_usage: true } },
      failedResponseHandler: volcengineFailedResponseHandler,
      successfulResponseHandler: createEventSourceResponseHandler(
        volcengineChatChunkSchema,
      ),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    const toolCallState = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();
    let finishReason: LanguageModelV3FinishReason = {
      unified: 'other',
      raw: undefined,
    };
    let usage: LanguageModelV3Usage | undefined;
    let textId: string | undefined;
    let reasoningId: string | undefined;
    let responseMetadataEmitted = false;

    const stream = eventStream.pipeThrough(
      new TransformStream<
        ParseResult<VolcengineChatChunk>,
        LanguageModelV3StreamPart
      >({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings });
        },

        transform(parseResult, controller) {
          if (parseResult.success === false) {
            controller.enqueue({ type: 'error', error: parseResult.error });
            return;
          }

          const chunk = parseResult.value;

          if (options.includeRawChunks) {
            controller.enqueue({ type: 'raw', rawValue: chunk });
          }

          if (!responseMetadataEmitted && chunk.id) {
            responseMetadataEmitted = true;
            controller.enqueue({
              type: 'response-metadata',
              ...getResponseMetadata(chunk),
            });
          }

          const choice = chunk.choices?.[0];
          if (!choice) {
            if (chunk.usage != null) {
              usage = convertVolcengineUsage(chunk.usage);
            }
            return;
          }

          const delta = choice.delta;

          if (delta.reasoning_content) {
            if (!reasoningId) {
              reasoningId = generateId();
              controller.enqueue({ type: 'reasoning-start', id: reasoningId });
            }
            controller.enqueue({
              type: 'reasoning-delta',
              id: reasoningId,
              delta: delta.reasoning_content,
            });
          }

          if (delta.content) {
            if (!textId) {
              textId = generateId();
              controller.enqueue({ type: 'text-start', id: textId });
            }
            controller.enqueue({
              type: 'text-delta',
              id: textId,
              delta: delta.content,
            });
          }

          if (delta.tool_calls) {
            for (const toolCallDelta of delta.tool_calls) {
              const index = toolCallDelta.index;
              let toolCall = toolCallState.get(index);

              if (!toolCall) {
                toolCall = {
                  id: toolCallDelta.id ?? generateId(),
                  name: toolCallDelta.function?.name ?? '',
                  arguments: '',
                };
                toolCallState.set(index, toolCall);
                controller.enqueue({
                  type: 'tool-input-start',
                  id: toolCall.id,
                  toolName: toolCall.name,
                });
              }

              if (toolCallDelta.function?.arguments) {
                toolCall.arguments += toolCallDelta.function.arguments;
                controller.enqueue({
                  type: 'tool-input-delta',
                  id: toolCall.id,
                  delta: toolCallDelta.function.arguments,
                });
              }
            }
          }

          if (choice.finish_reason) {
            finishReason = mapVolcengineFinishReason(choice.finish_reason);
          }

          if (chunk.usage != null) {
            usage = convertVolcengineUsage(chunk.usage);
          }
        },

        flush(controller) {
          if (reasoningId) {
            controller.enqueue({ type: 'reasoning-end', id: reasoningId });
          }

          if (textId) {
            controller.enqueue({ type: 'text-end', id: textId });
          }

          toolCallState.forEach(toolCall => {
            controller.enqueue({ type: 'tool-input-end', id: toolCall.id });
            controller.enqueue({
              type: 'tool-call',
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              input: toolCall.arguments,
            });
          });

          controller.enqueue({
            type: 'finish',
            finishReason,
            usage: usage ?? convertVolcengineUsage(undefined),
          });
        },
      }),
    );

    return {
      stream,
      request: { body: args },
      response: { headers: responseHeaders },
    };
  }

  private extractContent(
    message: VolcengineChatResponse['choices'][number]['message'],
  ): LanguageModelV3Content[] {
    const content: LanguageModelV3Content[] = [];

    if (message.reasoning_content) {
      content.push({
        type: 'reasoning',
        text: message.reasoning_content,
      });
    }

    if (message.content) {
      content.push({
        type: 'text',
        text: message.content,
      });
    }

    if (message.tool_calls) {
      for (const toolCall of message.tool_calls) {
        content.push({
          type: 'tool-call',
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          input: toolCall.function.arguments,
        } as LanguageModelV3ToolCall);
      }
    }

    if (content.length === 0) {
      throw new NoContentGeneratedError({
        message: 'No content in response message',
      });
    }

    return content;
  }
}
