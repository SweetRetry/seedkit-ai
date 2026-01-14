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
} from "@ai-sdk/provider"
import {
  FetchFunction,
  combineHeaders,
  createEventSourceResponseHandler,
  createJsonResponseHandler,
  generateId,
  injectJsonInstructionIntoMessages,
  postJsonToApi,
  removeUndefinedEntries,
} from "@ai-sdk/provider-utils"
import { z } from "zod"
import { convertToVolcengineChatMessages } from "./convert-to-volcengine-chat-message"
import { convertVolcengineUsage } from "./convert-volcengine-usage"
import { getResponseMetadata } from "./get-response-metadata"
import { mapVolcengineFinishReason } from "./map-volcengine-finish-reason"
import { volcengineChatOptions } from "./volcengine-chat-options"
import { volcengineFailedResponseHandler } from "./volcengine-error"
import { prepareTools } from "./volcengine-prepare-tools"

export type VolcengineChatConfig = {
  provider: string
  baseURL: string
  headers: () => Record<string, string>
  fetch?: FetchFunction
  generateId?: () => string
}

// Response schemas
const volcengineUsageSchema = z.object({
  prompt_tokens: z.number().optional(),
  completion_tokens: z.number().optional(),
  total_tokens: z.number().optional(),
  prompt_tokens_details: z
    .object({
      cached_tokens: z.number().optional(),
    })
    .optional(),
  completion_tokens_details: z
    .object({
      reasoning_tokens: z.number().optional(),
    })
    .optional(),
})

const volcengineToolCallSchema = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
})

const volcengineMessageSchema = z.object({
  role: z.literal("assistant"),
  content: z.string().nullable().optional(),
  reasoning_content: z.string().nullable().optional(),
  tool_calls: z.array(volcengineToolCallSchema).optional(),
})

const volcengineChoiceSchema = z.object({
  index: z.number(),
  message: volcengineMessageSchema,
  finish_reason: z.string().nullable().optional(),
})

const volcengineChatResponseSchema = z.object({
  id: z.string().optional(),
  object: z.string().optional(),
  created: z.number().optional(),
  model: z.string().optional(),
  choices: z.array(volcengineChoiceSchema),
  usage: volcengineUsageSchema.optional(),
})

// Streaming schemas
const volcengineDeltaSchema = z.object({
  role: z.string().optional(),
  content: z.string().nullable().optional(),
  reasoning_content: z.string().nullable().optional(),
  tool_calls: z
    .array(
      z.object({
        index: z.number(),
        id: z.string().optional(),
        type: z.literal("function").optional(),
        function: z
          .object({
            name: z.string().optional(),
            arguments: z.string().optional(),
          })
          .optional(),
      })
    )
    .optional(),
})

const volcengineChunkChoiceSchema = z.object({
  index: z.number(),
  delta: volcengineDeltaSchema,
  finish_reason: z.string().nullable().optional(),
})

const volcengineChatChunkSchema = z.object({
  id: z.string().optional(),
  object: z.string().optional(),
  created: z.number().optional(),
  model: z.string().optional(),
  choices: z.array(volcengineChunkChoiceSchema).optional(),
  usage: volcengineUsageSchema.nullable().optional(),
})

export class VolcengineChatLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const
  readonly provider: string
  readonly modelId: string
  readonly supportedUrls: Record<string, RegExp[]> = {}

  private readonly config: VolcengineChatConfig
  private readonly generateId: () => string

  constructor(modelId: string, config: VolcengineChatConfig) {
    this.modelId = modelId
    this.provider = config.provider
    this.config = config
    this.generateId = config.generateId ?? generateId
  }

  private getArgs({
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
    const warnings: SharedV3Warning[] = []
    const volcengineOptions = volcengineChatOptions.safeParse(providerOptions?.volcengine ?? {})

    if (!volcengineOptions.success) {
      warnings.push({
        type: "other",
        message: `Invalid provider options: ${volcengineOptions.error.message}`,
      })
    }

    const options = volcengineOptions.success ? volcengineOptions.data : {}

    // Unsupported features warnings
    if (topK != null) {
      warnings.push({
        type: "unsupported",
        feature: "topK",
      })
    }

    if (presencePenalty != null) {
      warnings.push({
        type: "unsupported",
        feature: "presencePenalty",
      })
    }

    if (frequencyPenalty != null) {
      warnings.push({
        type: "unsupported",
        feature: "frequencyPenalty",
      })
    }

    if (stopSequences != null && stopSequences.length > 0) {
      warnings.push({
        type: "unsupported",
        feature: "stopSequences",
      })
    }

    // Handle response format
    let messages = convertToVolcengineChatMessages(prompt)
    let responseFormatConfig: Record<string, unknown> | undefined

    if (responseFormat?.type === "json") {
      if (responseFormat.schema != null && options.structuredOutputs !== false) {
        responseFormatConfig = {
          type: "json_schema",
          json_schema: {
            name: responseFormat.name ?? "response",
            description: responseFormat.description,
            schema: responseFormat.schema,
            strict: options.strictJsonSchema ?? false,
          },
        }
      } else {
        responseFormatConfig = { type: "json_object" }
        messages = convertToVolcengineChatMessages(
          injectJsonInstructionIntoMessages({
            messages: prompt,
            schema: responseFormat.schema,
          })
        )
      }
    }

    // Prepare tools
    const {
      tools: volcengineTools,
      toolChoice: volcengineToolChoice,
      toolWarnings,
    } = prepareTools({ tools, toolChoice })

    // Convert boolean thinking option to Volcengine API format
    const thinkingConfig =
      options.thinking === true
        ? { type: "enabled" as const }
        : options.thinking === false
          ? { type: "disabled" as const }
          : undefined

    return {
      args: removeUndefinedEntries({
        model: this.modelId,
        messages,
        max_tokens: maxOutputTokens,
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
    }
  }

  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    const { args, warnings } = this.getArgs(options)

    const { value: response, responseHeaders } = await postJsonToApi({
      url: `${this.config.baseURL}/chat/completions`,
      headers: combineHeaders(this.config.headers(), options.headers),
      body: args,
      failedResponseHandler: volcengineFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(volcengineChatResponseSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    })

    const choice = response.choices[0]

    if (!choice) {
      throw new NoContentGeneratedError({
        message: "No choices returned in response",
      })
    }

    const content = this.extractContent(choice.message)
    const usage = convertVolcengineUsage(response.usage)
    const finishReason = mapVolcengineFinishReason(choice.finish_reason)

    return {
      content,
      usage,
      finishReason,
      warnings,
      request: {
        body: {
          ...args,
          stream: false,
        }
      },
      response: {
        ...getResponseMetadata(response),
        headers: responseHeaders,
        body: response,
      },
    }
  }

  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    const { args, warnings } = this.getArgs(options)

    const { value: eventStream, responseHeaders } = await postJsonToApi({
      url: `${this.config.baseURL}/chat/completions`,
      headers: combineHeaders(this.config.headers(), options.headers),
      body: { ...args, stream: true, stream_options: { include_usage: true } },
      failedResponseHandler: volcengineFailedResponseHandler,
      successfulResponseHandler: createEventSourceResponseHandler(volcengineChatChunkSchema),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    })

    const self = this

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      async start(controller) {
        const reader = eventStream.getReader()
        let textId: string | undefined
        let reasoningId: string | undefined
        const toolCallState: Map<number, { id: string; name: string; arguments: string }> =
          new Map()
        let finishReason: LanguageModelV3FinishReason | undefined
        let usage: LanguageModelV3Usage | undefined
        let responseMetadata: { id?: string; modelId?: string; timestamp?: Date } | undefined

        controller.enqueue({ type: "stream-start", warnings })

        try {
          while (true) {
            const { done, value } = await reader.read()

            if (done) {
              break
            }

            if (value.success === false) {
              controller.enqueue({ type: "error", error: value.error })
              continue
            }

            const chunk = value.value

            if (options.includeRawChunks) {
              controller.enqueue({ type: "raw", rawValue: chunk })
            }

            // Extract response metadata from first chunk
            if (!responseMetadata && chunk.id) {
              responseMetadata = getResponseMetadata(chunk)
              controller.enqueue({
                type: "response-metadata",
                ...responseMetadata,
              })
            }

            const choice = chunk.choices?.[0]
            if (!choice) {
              // Handle usage in final chunk (when choices is empty)
              if (chunk.usage != null) {
                usage = convertVolcengineUsage(chunk.usage)
              }
              continue
            }

            const delta = choice.delta

            // Handle reasoning content
            if (delta.reasoning_content) {
              if (!reasoningId) {
                reasoningId = self.generateId()
                controller.enqueue({ type: "reasoning-start", id: reasoningId })
              }
              controller.enqueue({
                type: "reasoning-delta",
                id: reasoningId,
                delta: delta.reasoning_content,
              })
            }

            // Handle text content
            if (delta.content) {
              if (!textId) {
                textId = self.generateId()
                controller.enqueue({ type: "text-start", id: textId })
              }
              controller.enqueue({
                type: "text-delta",
                id: textId,
                delta: delta.content,
              })
            }

            // Handle tool calls
            if (delta.tool_calls) {
              for (const toolCallDelta of delta.tool_calls) {
                const index = toolCallDelta.index
                let toolCall = toolCallState.get(index)

                if (!toolCall) {
                  toolCall = {
                    id: toolCallDelta.id ?? self.generateId(),
                    name: toolCallDelta.function?.name ?? "",
                    arguments: "",
                  }
                  toolCallState.set(index, toolCall)
                  controller.enqueue({
                    type: "tool-input-start",
                    id: toolCall.id,
                    toolName: toolCall.name,
                  })
                }

                if (toolCallDelta.function?.arguments) {
                  toolCall.arguments += toolCallDelta.function.arguments
                  controller.enqueue({
                    type: "tool-input-delta",
                    id: toolCall.id,
                    delta: toolCallDelta.function.arguments,
                  })
                }
              }
            }

            // Handle finish reason
            if (choice.finish_reason) {
              finishReason = mapVolcengineFinishReason(choice.finish_reason)
            }

            // Handle usage
            if (chunk.usage != null) {
              usage = convertVolcengineUsage(chunk.usage)
            }
          }

          // Close open content parts
          if (reasoningId) {
            controller.enqueue({ type: "reasoning-end", id: reasoningId })
          }

          if (textId) {
            controller.enqueue({ type: "text-end", id: textId })
          }

          // Close tool calls and emit tool-call events
          toolCallState.forEach((toolCall) => {
            controller.enqueue({
              type: "tool-input-end",
              id: toolCall.id,
            })
            controller.enqueue({
              type: "tool-call",
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              input: toolCall.arguments,
            })
          })

          // Emit finish
          controller.enqueue({
            type: "finish",
            finishReason: finishReason ?? { unified: "other", raw: undefined },
            usage: usage ?? convertVolcengineUsage(undefined),
          })
        } catch (error) {
          controller.enqueue({ type: "error", error })
        } finally {
          controller.close()
        }
      },
    })

    return {
      stream,
      request: { body: args },
      response: { headers: responseHeaders },
    }
  }

  private extractContent(
    message: z.infer<typeof volcengineMessageSchema>
  ): LanguageModelV3Content[] {
    const content: LanguageModelV3Content[] = []

    // Extract reasoning content
    if (message.reasoning_content) {
      content.push({
        type: "reasoning",
        text: message.reasoning_content,
      })
    }

    // Extract text content
    if (message.content) {
      content.push({
        type: "text",
        text: message.content,
      })
    }

    // Extract tool calls
    if (message.tool_calls) {
      for (const toolCall of message.tool_calls) {
        content.push({
          type: "tool-call",
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          input: toolCall.function.arguments,
        } as LanguageModelV3ToolCall)
      }
    }

    if (content.length === 0) {
      throw new NoContentGeneratedError({
        message: "No content in response message",
      })
    }

    return content
  }
}
