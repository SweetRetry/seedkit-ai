import { describe, expect, it } from "vitest"
import { convertVolcengineUsage, VolcengineUsage } from "./convert-volcengine-chat-usage"

describe("convertVolcengineUsage", () => {
  describe("null/undefined handling", () => {
    it("should return undefined values for null usage", () => {
      const result = convertVolcengineUsage(null)

      expect(result).toEqual({
        inputTokens: {
          total: undefined,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: undefined,
          text: undefined,
          reasoning: undefined,
        },
      })
    })

    it("should return undefined values for undefined usage", () => {
      const result = convertVolcengineUsage(undefined)

      expect(result).toEqual({
        inputTokens: {
          total: undefined,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: undefined,
          text: undefined,
          reasoning: undefined,
        },
      })
    })
  })

  describe("basic token counting", () => {
    it("should convert basic usage without details", () => {
      const usage: VolcengineUsage = {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      }

      const result = convertVolcengineUsage(usage)

      expect(result.inputTokens.total).toBe(100)
      expect(result.inputTokens.noCache).toBe(100)
      expect(result.inputTokens.cacheRead).toBeUndefined()
      expect(result.inputTokens.cacheWrite).toBeUndefined()
      expect(result.outputTokens.total).toBe(50)
      expect(result.outputTokens.text).toBe(50)
      expect(result.outputTokens.reasoning).toBeUndefined()
      expect(result.raw).toEqual(usage)
    })

    it("should handle partial usage data", () => {
      const usage: VolcengineUsage = {
        prompt_tokens: 100,
      }

      const result = convertVolcengineUsage(usage)

      expect(result.inputTokens.total).toBe(100)
      expect(result.inputTokens.noCache).toBe(100)
      expect(result.outputTokens.total).toBeUndefined()
      expect(result.outputTokens.text).toBeUndefined()
    })
  })

  describe("cache token handling", () => {
    it("should calculate noCache tokens from cached_tokens", () => {
      const usage: VolcengineUsage = {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        prompt_tokens_details: {
          cached_tokens: 30,
        },
      }

      const result = convertVolcengineUsage(usage)

      expect(result.inputTokens.total).toBe(100)
      expect(result.inputTokens.noCache).toBe(70) // 100 - 30
      expect(result.inputTokens.cacheRead).toBe(30)
      expect(result.inputTokens.cacheWrite).toBeUndefined()
    })

    it("should handle zero cached tokens", () => {
      const usage: VolcengineUsage = {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        prompt_tokens_details: {
          cached_tokens: 0,
        },
      }

      const result = convertVolcengineUsage(usage)

      expect(result.inputTokens.total).toBe(100)
      expect(result.inputTokens.noCache).toBe(100)
      expect(result.inputTokens.cacheRead).toBe(0)
    })

    it("should handle all tokens from cache", () => {
      const usage: VolcengineUsage = {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        prompt_tokens_details: {
          cached_tokens: 100,
        },
      }

      const result = convertVolcengineUsage(usage)

      expect(result.inputTokens.total).toBe(100)
      expect(result.inputTokens.noCache).toBe(0)
      expect(result.inputTokens.cacheRead).toBe(100)
    })
  })

  describe("reasoning token handling", () => {
    it("should calculate text tokens from reasoning_tokens", () => {
      const usage: VolcengineUsage = {
        prompt_tokens: 100,
        completion_tokens: 200,
        total_tokens: 300,
        completion_tokens_details: {
          reasoning_tokens: 150,
        },
      }

      const result = convertVolcengineUsage(usage)

      expect(result.outputTokens.total).toBe(200)
      expect(result.outputTokens.text).toBe(50) // 200 - 150
      expect(result.outputTokens.reasoning).toBe(150)
    })

    it("should handle zero reasoning tokens", () => {
      const usage: VolcengineUsage = {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        completion_tokens_details: {
          reasoning_tokens: 0,
        },
      }

      const result = convertVolcengineUsage(usage)

      expect(result.outputTokens.total).toBe(50)
      expect(result.outputTokens.text).toBe(50)
      expect(result.outputTokens.reasoning).toBe(0)
    })

    it("should handle all completion tokens as reasoning", () => {
      const usage: VolcengineUsage = {
        prompt_tokens: 100,
        completion_tokens: 200,
        total_tokens: 300,
        completion_tokens_details: {
          reasoning_tokens: 200,
        },
      }

      const result = convertVolcengineUsage(usage)

      expect(result.outputTokens.total).toBe(200)
      expect(result.outputTokens.text).toBe(0)
      expect(result.outputTokens.reasoning).toBe(200)
    })
  })

  describe("full usage with all details", () => {
    it("should handle complete usage data with all fields", () => {
      const usage: VolcengineUsage = {
        prompt_tokens: 100,
        completion_tokens: 200,
        total_tokens: 300,
        prompt_tokens_details: {
          cached_tokens: 40,
        },
        completion_tokens_details: {
          reasoning_tokens: 120,
        },
      }

      const result = convertVolcengineUsage(usage)

      expect(result).toEqual({
        inputTokens: {
          total: 100,
          noCache: 60, // 100 - 40
          cacheRead: 40,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: 200,
          text: 80, // 200 - 120
          reasoning: 120,
        },
        raw: usage,
      })
    })
  })

  describe("raw usage preservation", () => {
    it("should preserve raw usage object", () => {
      const usage: VolcengineUsage = {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      }

      const result = convertVolcengineUsage(usage)

      expect(result.raw).toBe(usage)
    })

    it("should not have raw property for null usage", () => {
      const result = convertVolcengineUsage(null)

      expect(result.raw).toBeUndefined()
    })
  })
})
