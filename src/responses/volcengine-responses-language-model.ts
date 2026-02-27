import {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3ProviderTool,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
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
  parseProviderOptions,
  postJsonToApi,
  removeUndefinedEntries,
} from '@ai-sdk/provider-utils';
import { z } from 'zod';
import { volcengineFailedResponseHandler } from '../chat/volcengine-error';
import { convertToVolcengineResponsesInput } from './convert-to-volcengine-responses-input';
import { convertVolcengineResponsesUsage } from './convert-volcengine-responses-usage';
import { mapVolcengineResponsesFinishReason } from './map-volcengine-responses-finish-reason';
import {
  VolcengineResponsesChunk,
  VolcengineResponsesResponse,
  volcengineResponsesChunkSchema,
  volcengineResponsesResponseSchema,
} from './volcengine-responses-api';
import {
  VolcengineResponsesOptions,
  volcengineResponsesOptions,
} from './volcengine-responses-options';

export type VolcengineResponsesConfig = {
  provider: string;
  baseURL: string;
  headers: () => Record<string, string>;
  fetch?: FetchFunction;
};

type VolcengineFunctionTool = {
  type: 'function';
  name: string;
  description: string | undefined;
  parameters: unknown;
  strict?: boolean;
};

type VolcengineToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; name: string };

export class VolcengineResponsesLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = 'v3' as const;
  readonly provider: string;
  readonly modelId: string;
  readonly supportedUrls: Record<string, RegExp[]> = {
    'image/*': [/^https?:\/\/.*$/],
    'application/pdf': [/^https?:\/\/.*$/],
  };

  private readonly config: VolcengineResponsesConfig;

  constructor(modelId: string, config: VolcengineResponsesConfig) {
    this.modelId = modelId;
    this.provider = config.provider;
    this.config = config;
  }

  private async getArgs({
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
    responseFormat,
    providerOptions,
  }: LanguageModelV3CallOptions) {
    const warnings: SharedV3Warning[] = [];

    if (topK != null) {
      warnings.push({ type: 'unsupported', feature: 'topK' });
    }

    if (seed != null) {
      warnings.push({ type: 'unsupported', feature: 'seed' });
    }

    if (presencePenalty != null) {
      warnings.push({ type: 'unsupported', feature: 'presencePenalty' });
    }

    if (frequencyPenalty != null) {
      warnings.push({ type: 'unsupported', feature: 'frequencyPenalty' });
    }

    if (stopSequences != null) {
      warnings.push({ type: 'unsupported', feature: 'stopSequences' });
    }

    const options =
      (await parseProviderOptions<VolcengineResponsesOptions>({
        provider: 'volcengine',
        providerOptions,
        schema: volcengineResponsesOptions,
      })) ?? {};

    const { input, instructions, warnings: inputWarnings } =
      await convertToVolcengineResponsesInput({ prompt });

    warnings.push(...inputWarnings);

    const responseFormatConfig =
      responseFormat?.type === 'json'
        ? {
            format:
              responseFormat.schema != null && options.structuredOutputs !== false
                ? {
                    type: 'json_schema' as const,
                    name: responseFormat.name ?? 'response',
                    description: responseFormat.description,
                    schema: responseFormat.schema,
                    strict: options.strictJsonSchema ?? true,
                  }
                : ({ type: 'json_object' as const } as const),
          }
        : undefined;

    const functionTools = this.convertTools(tools, warnings);
    const convertedToolChoice = this.convertToolChoice(toolChoice);
    const thinkingOption = options.thinking;
    const thinking =
      thinkingOption === true || thinkingOption === 'enabled'
        ? { type: 'enabled' as const }
        : thinkingOption === false || thinkingOption === 'disabled'
          ? { type: 'disabled' as const }
          : thinkingOption === 'auto'
            ? { type: 'auto' as const }
            : undefined;

    const reasoning =
      options.reasoningEffort != null
        ? { effort: options.reasoningEffort }
        : undefined;

    return {
      body: removeUndefinedEntries({
        model: this.modelId,
        input,
        instructions,
        max_output_tokens: maxOutputTokens,
        temperature,
        top_p: topP,
        tools: functionTools,
        tool_choice: convertedToolChoice,
        parallel_tool_calls: options.parallelToolCalls,
        text: responseFormatConfig,
        store: options.store,
        previous_response_id: options.previousResponseId,
        thinking,
        reasoning,
      }),
      warnings,
    };
  }

  async doGenerate(
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3GenerateResult> {
    const { body, warnings } = await this.getArgs(options);

    const {
      responseHeaders,
      value: response,
      rawValue: rawResponse,
    } = await postJsonToApi({
      url: `${this.config.baseURL}/responses`,
      headers: combineHeaders(this.config.headers(), options.headers),
      body,
      failedResponseHandler: volcengineFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(
        volcengineResponsesResponseSchema,
      ),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    const { content, hasToolCalls } = this.extractContent(response);
    const rawFinishReason = response.incomplete_details?.reason;

    return {
      content,
      finishReason: {
        unified: mapVolcengineResponsesFinishReason({
          finishReason: rawFinishReason,
          hasToolCalls,
        }),
        raw: rawFinishReason ?? undefined,
      },
      usage: convertVolcengineResponsesUsage(response.usage),
      request: { body },
      response: {
        id: response.id,
        modelId: response.model,
        timestamp:
          response.created_at != null
            ? new Date(response.created_at * 1000)
            : undefined,
        headers: responseHeaders,
        body: rawResponse,
      },
      warnings,
    };
  }

  async doStream(
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3StreamResult> {
    const { body, warnings } = await this.getArgs(options);

    const { responseHeaders, value: eventStream } = await postJsonToApi({
      url: `${this.config.baseURL}/responses`,
      headers: combineHeaders(this.config.headers(), options.headers),
      body: {
        ...body,
        stream: true,
      },
      failedResponseHandler: volcengineFailedResponseHandler,
      successfulResponseHandler: createEventSourceResponseHandler(
        volcengineResponsesChunkSchema,
      ),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    const usage: LanguageModelV3Usage = convertVolcengineResponsesUsage(
      undefined,
    );
    let finishReason: LanguageModelV3FinishReason = {
      unified: 'other',
      raw: undefined,
    };
    let hasToolCalls = false;
    let activeReasoningId: string | undefined;
    const toolCallsByItemId: Record<
      string,
      { toolName?: string; toolCallId?: string; arguments?: string }
    > = {};

    return {
      stream: eventStream.pipeThrough(
        new TransformStream<
          ParseResult<VolcengineResponsesChunk>,
          LanguageModelV3StreamPart
        >({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings });
          },
          transform(parseResult, controller) {
            if (options.includeRawChunks) {
              controller.enqueue({
                type: 'raw',
                rawValue: parseResult.rawValue,
              });
            }

            if (!parseResult.success) {
              controller.enqueue({ type: 'error', error: parseResult.error });
              return;
            }

            const chunk = parseResult.value;

            if (
              chunk.type === 'response.output_item.added' &&
              isFunctionCallItem(chunk.item)
            ) {
              toolCallsByItemId[chunk.item.id] = {
                toolName: chunk.item.name,
                toolCallId: chunk.item.call_id,
                arguments: chunk.item.arguments,
              };
              return;
            }

            if (chunk.type === 'response.function_call_arguments.delta') {
              const itemId = asString(chunk.item_id);
              if (itemId == null) {
                return;
              }
              const toolCall =
                toolCallsByItemId[itemId] ?? (toolCallsByItemId[itemId] = {});
              toolCall.arguments =
                (toolCall.arguments ?? '') + (asString(chunk.delta) ?? '');
              return;
            }

            if (chunk.type === 'response.function_call_arguments.done') {
              const itemId = asString(chunk.item_id);
              if (itemId == null) {
                return;
              }
              const toolCall =
                toolCallsByItemId[itemId] ?? (toolCallsByItemId[itemId] = {});
              toolCall.arguments = asString(chunk.arguments);
              return;
            }

            if (
              chunk.type === 'response.output_item.done' &&
              isFunctionCallItem(chunk.item)
            ) {
              const toolCall = toolCallsByItemId[chunk.item.id];
              controller.enqueue({
                type: 'tool-call',
                toolCallId: toolCall?.toolCallId ?? chunk.item.call_id,
                toolName: toolCall?.toolName ?? chunk.item.name,
                input: toolCall?.arguments ?? chunk.item.arguments ?? '',
              });
              delete toolCallsByItemId[chunk.item.id];
              hasToolCalls = true;
              return;
            }

            if (
              chunk.type === 'response.output_item.added' &&
              isReasoningItem(chunk.item)
            ) {
              activeReasoningId = chunk.item.id;
              controller.enqueue({
                type: 'reasoning-start',
                id: activeReasoningId,
              });
              return;
            }

            if (chunk.type === 'response.reasoning_summary_text.delta') {
              if (activeReasoningId == null) {
                return;
              }
              controller.enqueue({
                type: 'reasoning-delta',
                id: activeReasoningId,
                delta: asString(chunk.delta) ?? '',
              });
              return;
            }

            if (
              chunk.type === 'response.output_item.done' &&
              isReasoningItem(chunk.item)
            ) {
              controller.enqueue({ type: 'reasoning-end', id: chunk.item.id });
              activeReasoningId = undefined;
              return;
            }

            if (
              chunk.type === 'response.output_item.added' &&
              isMessageItem(chunk.item)
            ) {
              controller.enqueue({ type: 'text-start', id: chunk.item.id });
              return;
            }

            if (chunk.type === 'response.output_text.delta') {
              const itemId = asString(chunk.item_id);
              if (itemId == null) {
                return;
              }
              controller.enqueue({
                type: 'text-delta',
                id: itemId,
                delta: asString(chunk.delta) ?? '',
              });
              return;
            }

            if (
              chunk.type === 'response.output_item.done' &&
              isMessageItem(chunk.item)
            ) {
              controller.enqueue({ type: 'text-end', id: chunk.item.id });
              return;
            }

            if (
              chunk.type === 'response.completed' ||
              chunk.type === 'response.incomplete'
            ) {
              const response = asResponseObject(chunk.response);
              if (response == null) {
                return;
              }
              finishReason = {
                unified: mapVolcengineResponsesFinishReason({
                  finishReason: response.incomplete_details?.reason,
                  hasToolCalls,
                }),
                raw: response.incomplete_details?.reason ?? undefined,
              };
              const mappedUsage = convertVolcengineResponsesUsage(response.usage);
              usage.inputTokens = mappedUsage.inputTokens;
              usage.outputTokens = mappedUsage.outputTokens;
              usage.raw = mappedUsage.raw;
            }
          },
          flush(controller) {
            if (activeReasoningId != null) {
              controller.enqueue({
                type: 'reasoning-end',
                id: activeReasoningId,
              });
            }
            controller.enqueue({
              type: 'finish',
              finishReason,
              usage,
            });
          },
        }),
      ),
      request: { body },
      response: { headers: responseHeaders },
    };
  }

  private convertTools(
    tools: LanguageModelV3CallOptions['tools'],
    warnings: SharedV3Warning[],
  ): VolcengineFunctionTool[] | undefined {
    if (tools == null || tools.length === 0) {
      return undefined;
    }

    const result: VolcengineFunctionTool[] = [];
    for (const tool of tools) {
      if (tool.type === 'provider') {
        warnings.push({
          type: 'unsupported',
          feature: `provider-defined tool ${(tool as LanguageModelV3ProviderTool).id}`,
        });
        continue;
      }

      result.push({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
        ...(tool.strict != null ? { strict: tool.strict } : {}),
      });
    }

    return result.length > 0 ? result : undefined;
  }

  private convertToolChoice(
    toolChoice: LanguageModelV3CallOptions['toolChoice'],
  ): VolcengineToolChoice | undefined {
    if (toolChoice == null) {
      return undefined;
    }

    switch (toolChoice.type) {
      case 'auto':
      case 'none':
      case 'required':
        return toolChoice.type;
      case 'tool':
        return { type: 'function', name: toolChoice.toolName };
    }
  }

  private extractContent(response: VolcengineResponsesResponse): {
    content: LanguageModelV3Content[];
    hasToolCalls: boolean;
  } {
    const content: LanguageModelV3Content[] = [];
    let hasToolCalls = false;

    for (const item of response.output ?? []) {
      if (item.type === 'reasoning') {
        for (const summary of item.summary ?? []) {
          content.push({ type: 'reasoning', text: summary.text });
        }
        continue;
      }

      if (item.type === 'message') {
        for (const part of item.content ?? []) {
          if (part.type === 'output_text') {
            content.push({ type: 'text', text: part.text });
          } else if (part.type === 'refusal') {
            content.push({ type: 'text', text: part.refusal });
          }
        }
        continue;
      }

      if (item.type === 'function_call') {
        content.push({
          type: 'tool-call',
          toolCallId: item.call_id,
          toolName: item.name,
          input: item.arguments ?? '',
        });
        hasToolCalls = true;
      }
    }

    if (content.length === 0) {
      throw new NoContentGeneratedError({
        message: 'No content generated from responses API output.',
      });
    }

    return { content, hasToolCalls };
  }
}

function isMessageItem(
  value: unknown,
): value is { type: 'message'; id: string } {
  return (
    typeof value === 'object' &&
    value != null &&
    (value as { type?: unknown }).type === 'message' &&
    typeof (value as { id?: unknown }).id === 'string'
  );
}

function isReasoningItem(
  value: unknown,
): value is { type: 'reasoning'; id: string } {
  return (
    typeof value === 'object' &&
    value != null &&
    (value as { type?: unknown }).type === 'reasoning' &&
    typeof (value as { id?: unknown }).id === 'string'
  );
}

function isFunctionCallItem(
  value: unknown,
): value is {
  type: 'function_call';
  id: string;
  name: string;
  call_id: string;
  arguments?: string;
} {
  return (
    typeof value === 'object' &&
    value != null &&
    (value as { type?: unknown }).type === 'function_call' &&
    typeof (value as { id?: unknown }).id === 'string' &&
    typeof (value as { name?: unknown }).name === 'string' &&
    typeof (value as { call_id?: unknown }).call_id === 'string'
  );
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asResponseObject(value: unknown): {
  incomplete_details?: { reason?: string };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
  };
} | null {
  if (typeof value !== 'object' || value == null) {
    return null;
  }
  return value as {
    incomplete_details?: { reason?: string };
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      input_tokens_details?: { cached_tokens?: number };
      output_tokens_details?: { reasoning_tokens?: number };
    };
  };
}
