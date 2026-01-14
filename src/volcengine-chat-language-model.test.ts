import { describe, expect, it, vi } from "vitest"
import { VolcengineChatLanguageModel } from "./volcengine-chat-language-model"

// Mock fetch for testing
const createMockFetch = (response: unknown, status = 200) => {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: () => Promise.resolve(response),
    text: () => Promise.resolve(JSON.stringify(response)),
  })
}

const createStreamingMockFetch = (chunks: string[]) => {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "text/event-stream" }),
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk))
        }
        controller.close()
      },
    }),
  })
}

const createModel = (fetchMock?: typeof fetch) => {
  return new VolcengineChatLanguageModel("test-model", {
    provider: "volcengine.chat",
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    headers: () => ({ Authorization: "Bearer test-key" }),
    fetch: fetchMock,
  })
}

describe("VolcengineChatLanguageModel", () => {
  describe("constructor", () => {
    it("should create model with correct properties", () => {
      const model = createModel()

      expect(model.specificationVersion).toBe("v3")
      expect(model.provider).toBe("volcengine.chat")
      expect(model.modelId).toBe("test-model")
    })
  })

  describe("doGenerate", () => {
    it("should generate text response", async () => {
      const mockResponse = {
        id: "chatcmpl-123",
        object: "chat.completion",
        created: 1677652288,
        model: "test-model",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Hello! How can I help you today?",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 8,
          total_tokens: 18,
        },
      }

      const model = createModel(createMockFetch(mockResponse))

      const result = await model.doGenerate({
        prompt: [
          {
            role: "user",
            content: [{ type: "text", text: "Hello" }],
          },
        ],
      })

      expect(result.content).toHaveLength(1)
      expect(result.content[0]).toEqual({
        type: "text",
        text: "Hello! How can I help you today?",
      })
      expect(result.finishReason).toEqual({ unified: "stop", raw: "stop" })
      expect(result.usage.inputTokens.total).toBe(10)
      expect(result.usage.outputTokens.total).toBe(8)
    })

    it("should handle reasoning content", async () => {
      const mockResponse = {
        id: "chatcmpl-123",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              reasoning_content: "Let me think about this...",
              content: "The answer is 42.",
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }

      const model = createModel(createMockFetch(mockResponse))

      const result = await model.doGenerate({
        prompt: [
          {
            role: "user",
            content: [{ type: "text", text: "What is the meaning of life?" }],
          },
        ],
      })

      expect(result.content).toHaveLength(2)
      expect(result.content[0]).toEqual({
        type: "reasoning",
        text: "Let me think about this...",
      })
      expect(result.content[1]).toEqual({
        type: "text",
        text: "The answer is 42.",
      })
    })

    it("should handle tool calls", async () => {
      const mockResponse = {
        id: "chatcmpl-123",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_abc123",
                  type: "function",
                  function: {
                    name: "get_weather",
                    arguments: '{"location": "Beijing"}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 15, completion_tokens: 25 },
      }

      const model = createModel(createMockFetch(mockResponse))

      const result = await model.doGenerate({
        prompt: [
          {
            role: "user",
            content: [{ type: "text", text: "What is the weather in Beijing?" }],
          },
        ],
        tools: [
          {
            type: "function",
            name: "get_weather",
            description: "Get weather for a location",
            inputSchema: {
              type: "object",
              properties: { location: { type: "string" } },
              required: ["location"],
            },
          },
        ],
      })

      expect(result.content).toHaveLength(1)
      expect(result.content[0]).toMatchObject({
        type: "tool-call",
        toolCallId: "call_abc123",
        toolName: "get_weather",
        input: '{"location": "Beijing"}',
      })
      expect(result.finishReason).toEqual({
        unified: "tool-calls",
        raw: "tool_calls",
      })
    })

    it("should handle multiple tool calls", async () => {
      const mockResponse = {
        id: "chatcmpl-123",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "get_weather",
                    arguments: '{"location": "Beijing"}',
                  },
                },
                {
                  id: "call_2",
                  type: "function",
                  function: {
                    name: "get_weather",
                    arguments: '{"location": "Shanghai"}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 50 },
      }

      const model = createModel(createMockFetch(mockResponse))

      const result = await model.doGenerate({
        prompt: [
          {
            role: "user",
            content: [{ type: "text", text: "Compare weather in Beijing and Shanghai" }],
          },
        ],
      })

      expect(result.content).toHaveLength(2)
      expect(result.content[0]).toMatchObject({
        type: "tool-call",
        toolCallId: "call_1",
        toolName: "get_weather",
      })
      expect(result.content[1]).toMatchObject({
        type: "tool-call",
        toolCallId: "call_2",
        toolName: "get_weather",
      })
    })

    it("should handle system messages", async () => {
      const mockResponse = {
        id: "chatcmpl-123",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "I am a helpful assistant." },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 10 },
      }

      const mockFetch = createMockFetch(mockResponse)
      const model = createModel(mockFetch)

      await model.doGenerate({
        prompt: [
          { role: "system", content: "You are a helpful assistant." },
          {
            role: "user",
            content: [{ type: "text", text: "Introduce yourself" }],
          },
        ],
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"role":"system"'),
        })
      )
    })

    it("should pass temperature and other options", async () => {
      const mockResponse = {
        id: "chatcmpl-123",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Response" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }

      const mockFetch = createMockFetch(mockResponse)
      const model = createModel(mockFetch)

      await model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
        temperature: 0.7,
        topP: 0.9,
        maxOutputTokens: 100,
        seed: 42,
      })

      const callBody = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
      expect(callBody.temperature).toBe(0.7)
      expect(callBody.top_p).toBe(0.9)
      expect(callBody.max_tokens).toBe(100)
      expect(callBody.seed).toBe(42)
    })

    it("should handle finish reason: length", async () => {
      const mockResponse = {
        id: "chatcmpl-123",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Truncated response..." },
            finish_reason: "length",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 100 },
      }

      const model = createModel(createMockFetch(mockResponse))

      const result = await model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      })

      expect(result.finishReason).toEqual({ unified: "length", raw: "length" })
    })

    it("should handle finish reason: content_filter with content", async () => {
      const mockResponse = {
        id: "chatcmpl-123",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Content was filtered." },
            finish_reason: "content_filter",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }

      const model = createModel(createMockFetch(mockResponse))

      const result = await model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      })

      expect(result.finishReason).toEqual({
        unified: "content-filter",
        raw: "content_filter",
      })
    })

    it("should throw error when content_filter returns empty content", async () => {
      const mockResponse = {
        id: "chatcmpl-123",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "" },
            finish_reason: "content_filter",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 0 },
      }

      const model = createModel(createMockFetch(mockResponse))

      await expect(
        model.doGenerate({
          prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
        })
      ).rejects.toThrow("No content in response message")
    })
  })

  describe("doStream", () => {
    it("should stream text response", async () => {
      const chunks = [
        'data: {"id":"1","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}\n\n',
        'data: {"id":"1","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}\n\n',
        'data: {"id":"1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n',
        "data: [DONE]\n\n",
      ]

      const model = createModel(createStreamingMockFetch(chunks))

      const result = await model.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      })

      const parts: unknown[] = []
      const reader = result.stream.getReader()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        parts.push(value)
      }

      expect(parts.some((p: any) => p.type === "stream-start")).toBe(true)
      expect(parts.some((p: any) => p.type === "text-start")).toBe(true)
      expect(parts.some((p: any) => p.type === "text-delta" && p.delta === "Hello")).toBe(true)
      expect(parts.some((p: any) => p.type === "text-delta" && p.delta === " world")).toBe(true)
      expect(parts.some((p: any) => p.type === "text-end")).toBe(true)
      expect(parts.some((p: any) => p.type === "finish")).toBe(true)
    })

    it("should stream reasoning content", async () => {
      const chunks = [
        'data: {"id":"1","choices":[{"index":0,"delta":{"role":"assistant","reasoning_content":"Thinking..."},"finish_reason":null}]}\n\n',
        'data: {"id":"1","choices":[{"index":0,"delta":{"content":"Answer"},"finish_reason":null}]}\n\n',
        'data: {"id":"1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ]

      const model = createModel(createStreamingMockFetch(chunks))

      const result = await model.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "Think" }] }],
      })

      const parts: unknown[] = []
      const reader = result.stream.getReader()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        parts.push(value)
      }

      expect(parts.some((p: any) => p.type === "reasoning-start")).toBe(true)
      expect(
        parts.some((p: any) => p.type === "reasoning-delta" && p.delta === "Thinking...")
      ).toBe(true)
      expect(parts.some((p: any) => p.type === "reasoning-end")).toBe(true)
      expect(parts.some((p: any) => p.type === "text-start")).toBe(true)
    })

    it("should stream tool calls", async () => {
      const chunks = [
        'data: {"id":"1","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_weather","arguments":""}}]},"finish_reason":null}]}\n\n',
        'data: {"id":"1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"loc"}}]},"finish_reason":null}]}\n\n',
        'data: {"id":"1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ation\\":\\"Beijing\\"}"}}]},"finish_reason":null}]}\n\n',
        'data: {"id":"1","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
        "data: [DONE]\n\n",
      ]

      const model = createModel(createStreamingMockFetch(chunks))

      const result = await model.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "Weather?" }] }],
      })

      const parts: unknown[] = []
      const reader = result.stream.getReader()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        parts.push(value)
      }

      expect(parts.some((p: any) => p.type === "tool-input-start")).toBe(true)
      expect(parts.some((p: any) => p.type === "tool-input-delta")).toBe(true)
      expect(parts.some((p: any) => p.type === "tool-input-end")).toBe(true)
      expect(parts.some((p: any) => p.type === "tool-call" && p.toolName === "get_weather")).toBe(
        true
      )
    })
  })

  describe("warnings", () => {
    it("should emit warning for unsupported topK", async () => {
      const mockResponse = {
        id: "chatcmpl-123",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Response" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }

      const model = createModel(createMockFetch(mockResponse))

      const result = await model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        topK: 10,
      })

      expect(result.warnings).toContainEqual({
        type: "unsupported",
        feature: "topK",
      })
    })

    it("should emit warning for unsupported presencePenalty", async () => {
      const mockResponse = {
        id: "chatcmpl-123",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Response" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }

      const model = createModel(createMockFetch(mockResponse))

      const result = await model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        presencePenalty: 0.5,
      })

      expect(result.warnings).toContainEqual({
        type: "unsupported",
        feature: "presencePenalty",
      })
    })

    it("should emit warning for unsupported frequencyPenalty", async () => {
      const mockResponse = {
        id: "chatcmpl-123",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Response" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }

      const model = createModel(createMockFetch(mockResponse))

      const result = await model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        frequencyPenalty: 0.5,
      })

      expect(result.warnings).toContainEqual({
        type: "unsupported",
        feature: "frequencyPenalty",
      })
    })

    it("should emit warning for unsupported stopSequences", async () => {
      const mockResponse = {
        id: "chatcmpl-123",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Response" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }

      const model = createModel(createMockFetch(mockResponse))

      const result = await model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        stopSequences: ["STOP"],
      })

      expect(result.warnings).toContainEqual({
        type: "unsupported",
        feature: "stopSequences",
      })
    })
  })

  describe("error handling", () => {
    it("should throw error when no choices returned", async () => {
      const mockResponse = {
        id: "chatcmpl-123",
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 0 },
      }

      const model = createModel(createMockFetch(mockResponse))

      await expect(
        model.doGenerate({
          prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        })
      ).rejects.toThrow("No choices returned in response")
    })

    it("should throw error when message has no content", async () => {
      const mockResponse = {
        id: "chatcmpl-123",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: null },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 0 },
      }

      const model = createModel(createMockFetch(mockResponse))

      await expect(
        model.doGenerate({
          prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        })
      ).rejects.toThrow("No content in response message")
    })
  })

  describe("response format", () => {
    it("should handle JSON response format with schema", async () => {
      const mockResponse = {
        id: "chatcmpl-123",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: '{"name": "test"}' },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }

      const mockFetch = createMockFetch(mockResponse)
      const model = createModel(mockFetch)

      await model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        responseFormat: {
          type: "json",
          schema: {
            type: "object",
            properties: { name: { type: "string" } },
          },
        },
      })

      const callBody = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string)
      expect(callBody.response_format).toBeDefined()
      expect(callBody.response_format.type).toBe("json_schema")
    })
  })
})
