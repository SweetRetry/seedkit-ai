import { describe, expect, it } from "vitest";
import { convertToVolcengineChatMessages } from "./convert-to-volcengine-chat-message";

describe("convertToVolcengineChatMessages", () => {
  describe("system messages", () => {
    it("should convert system message", () => {
      const result = convertToVolcengineChatMessages([
        { role: "system", content: "You are a helpful assistant." }
      ]);

      expect(result).toEqual([
        { role: "system", content: "You are a helpful assistant." }
      ]);
    });
  });

  describe("user messages", () => {
    it("should convert text user message", () => {
      const result = convertToVolcengineChatMessages([
        {
          role: "user",
          content: [{ type: "text", text: "Hello" }]
        }
      ]);

      expect(result).toEqual([
        {
          role: "user",
          content: [{ type: "text", text: "Hello" }]
        }
      ]);
    });

    it("should convert user message with multiple text parts", () => {
      const result = convertToVolcengineChatMessages([
        {
          role: "user",
          content: [
            { type: "text", text: "First part. " },
            { type: "text", text: "Second part." }
          ]
        }
      ]);

      expect(result).toEqual([
        {
          role: "user",
          content: [
            { type: "text", text: "First part. " },
            { type: "text", text: "Second part." }
          ]
        }
      ]);
    });

    it("should convert image file with URL", () => {
      const result = convertToVolcengineChatMessages([
        {
          role: "user",
          content: [
            {
              type: "file",
              data: new URL("https://example.com/image.jpg"),
              mediaType: "image/jpeg"
            }
          ]
        }
      ]);

      expect(result).toEqual([
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: "https://example.com/image.jpg" }
            }
          ]
        }
      ]);
    });

    it("should convert image file with base64 data", () => {
      const result = convertToVolcengineChatMessages([
        {
          role: "user",
          content: [
            {
              type: "file",
              data: "base64encodeddata",
              mediaType: "image/png"
            }
          ]
        }
      ]);

      expect(result).toEqual([
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,base64encodeddata" }
            }
          ]
        }
      ]);
    });

    it("should convert video file with URL", () => {
      const result = convertToVolcengineChatMessages([
        {
          role: "user",
          content: [
            {
              type: "file",
              data: new URL("https://example.com/video.mp4"),
              mediaType: "video/mp4"
            }
          ]
        }
      ]);

      expect(result).toEqual([
        {
          role: "user",
          content: [
            {
              type: "video_url",
              video_url: { url: "https://example.com/video.mp4" }
            }
          ]
        }
      ]);
    });

    it("should convert PDF file with URL string", () => {
      const result = convertToVolcengineChatMessages([
        {
          role: "user",
          content: [
            {
              type: "file",
              data: "https://example.com/doc.pdf",
              mediaType: "application/pdf"
            }
          ]
        }
      ]);

      expect(result).toEqual([
        {
          role: "user",
          content: [
            {
              type: "input_file",
              file_url: "https://example.com/doc.pdf"
            }
          ]
        }
      ]);
    });

    it("should convert PDF file with URL object", () => {
      const result = convertToVolcengineChatMessages([
        {
          role: "user",
          content: [
            {
              type: "file",
              data: new URL("https://example.com/doc.pdf"),
              mediaType: "application/pdf"
            }
          ]
        }
      ]);

      expect(result).toEqual([
        {
          role: "user",
          content: [
            {
              type: "input_file",
              file_url: "https://example.com/doc.pdf"
            }
          ]
        }
      ]);
    });

    it("should convert PDF file with base64 string", () => {
      const result = convertToVolcengineChatMessages([
        {
          role: "user",
          content: [
            {
              type: "file",
              data: "JVBERi0xLjQ=",
              mediaType: "application/pdf",
              filename: "test.pdf"
            }
          ]
        }
      ]);

      expect(result).toEqual([
        {
          role: "user",
          content: [
            {
              type: "input_file",
              file_data: "data:application/pdf;base64,JVBERi0xLjQ=",
              filename: "test.pdf"
            }
          ]
        }
      ]);
    });

    it("should convert PDF file with Uint8Array", () => {
      const pdfData = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
      const result = convertToVolcengineChatMessages([
        {
          role: "user",
          content: [
            {
              type: "file",
              data: pdfData,
              mediaType: "application/pdf"
            }
          ]
        }
      ]);

      expect(result).toEqual([
        {
          role: "user",
          content: [
            {
              type: "input_file",
              file_data: "data:application/pdf;base64,JVBERg==",
              filename: "document.pdf"
            }
          ]
        }
      ]);
    });

    it("should throw error for unsupported file type", () => {
      expect(() =>
        convertToVolcengineChatMessages([
          {
            role: "user",
            content: [
              {
                type: "file",
                data: "data",
                mediaType: "application/octet-stream"
              }
            ]
          }
        ])
      ).toThrow("File type: application/octet-stream");
    });
  });

  describe("assistant messages", () => {
    it("should convert assistant text message", () => {
      const result = convertToVolcengineChatMessages([
        {
          role: "assistant",
          content: [{ type: "text", text: "Hello there!" }]
        }
      ]);

      expect(result).toEqual([
        {
          role: "assistant",
          content: "Hello there!"
        }
      ]);
    });

    it("should concatenate multiple text parts", () => {
      const result = convertToVolcengineChatMessages([
        {
          role: "assistant",
          content: [
            { type: "text", text: "First. " },
            { type: "text", text: "Second." }
          ]
        }
      ]);

      expect(result).toEqual([
        {
          role: "assistant",
          content: "First. Second."
        }
      ]);
    });

    it("should convert assistant message with reasoning", () => {
      const result = convertToVolcengineChatMessages([
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "Let me think..." },
            { type: "text", text: "The answer is 42." }
          ]
        }
      ]);

      expect(result).toEqual([
        {
          role: "assistant",
          content: "The answer is 42.",
          reasoning_content: "Let me think..."
        }
      ]);
    });

    it("should convert assistant message with tool calls", () => {
      const result = convertToVolcengineChatMessages([
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call_123",
              toolName: "get_weather",
              input: '{"location": "Beijing"}'
            }
          ]
        }
      ]);

      expect(result).toEqual([
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_123",
              type: "function",
              function: {
                name: "get_weather",
                arguments: '{"location": "Beijing"}'
              }
            }
          ]
        }
      ]);
    });

    it("should convert assistant message with object input for tool call", () => {
      const result = convertToVolcengineChatMessages([
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call_123",
              toolName: "get_weather",
              input: { location: "Beijing" }
            }
          ]
        }
      ]);

      expect(result).toEqual([
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_123",
              type: "function",
              function: {
                name: "get_weather",
                arguments: '{"location":"Beijing"}'
              }
            }
          ]
        }
      ]);
    });

    it("should handle mixed content with text, reasoning and tool calls", () => {
      const result = convertToVolcengineChatMessages([
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "I need to check the weather." },
            { type: "text", text: "Let me check that for you." },
            {
              type: "tool-call",
              toolCallId: "call_1",
              toolName: "get_weather",
              input: '{"location": "Beijing"}'
            }
          ]
        }
      ]);

      expect(result).toEqual([
        {
          role: "assistant",
          content: "Let me check that for you.",
          reasoning_content: "I need to check the weather.",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "get_weather",
                arguments: '{"location": "Beijing"}'
              }
            }
          ]
        }
      ]);
    });
  });

  describe("tool messages", () => {
    it("should convert tool result with text output", () => {
      const result = convertToVolcengineChatMessages([
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_123",
              toolName: "get_weather",
              output: { type: "text", value: "Sunny, 25°C" }
            }
          ]
        }
      ]);

      expect(result).toEqual([
        {
          role: "tool",
          tool_call_id: "call_123",
          content: "Sunny, 25°C"
        }
      ]);
    });

    it("should convert tool result with JSON output", () => {
      const result = convertToVolcengineChatMessages([
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_123",
              toolName: "get_weather",
              output: {
                type: "json",
                value: { weather: "sunny", temp: 25 }
              }
            }
          ]
        }
      ]);

      expect(result).toEqual([
        {
          role: "tool",
          tool_call_id: "call_123",
          content: '{"weather":"sunny","temp":25}'
        }
      ]);
    });

    it("should convert tool result with error-text output", () => {
      const result = convertToVolcengineChatMessages([
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_123",
              toolName: "get_weather",
              output: { type: "error-text", value: "Location not found" }
            }
          ]
        }
      ]);

      expect(result).toEqual([
        {
          role: "tool",
          tool_call_id: "call_123",
          content: "Location not found"
        }
      ]);
    });

    it("should convert tool result with execution-denied output", () => {
      const result = convertToVolcengineChatMessages([
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_123",
              toolName: "dangerous_action",
              output: {
                type: "execution-denied",
                reason: "User denied permission"
              }
            }
          ]
        }
      ]);

      expect(result).toEqual([
        {
          role: "tool",
          tool_call_id: "call_123",
          content: "User denied permission"
        }
      ]);
    });

    it("should handle multiple tool results", () => {
      const result = convertToVolcengineChatMessages([
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_1",
              toolName: "get_weather",
              output: { type: "text", value: "Beijing: Sunny" }
            },
            {
              type: "tool-result",
              toolCallId: "call_2",
              toolName: "get_weather",
              output: { type: "text", value: "Shanghai: Rainy" }
            }
          ]
        }
      ]);

      expect(result).toEqual([
        { role: "tool", tool_call_id: "call_1", content: "Beijing: Sunny" },
        { role: "tool", tool_call_id: "call_2", content: "Shanghai: Rainy" }
      ]);
    });
  });

  describe("conversation flow", () => {
    it("should convert a complete conversation", () => {
      const result = convertToVolcengineChatMessages([
        { role: "system", content: "You are a weather assistant." },
        {
          role: "user",
          content: [{ type: "text", text: "What's the weather in Beijing?" }]
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call_1",
              toolName: "get_weather",
              input: '{"location":"Beijing"}'
            }
          ]
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_1",
              toolName: "get_weather",
              output: { type: "text", value: "Sunny, 25°C" }
            }
          ]
        },
        {
          role: "assistant",
          content: [
            { type: "text", text: "The weather in Beijing is sunny with 25°C." }
          ]
        }
      ]);

      expect(result).toHaveLength(5);
      expect(result[0]).toEqual({
        role: "system",
        content: "You are a weather assistant."
      });
      expect(result[1]).toEqual({
        role: "user",
        content: [{ type: "text", text: "What's the weather in Beijing?" }]
      });
      expect(result[2]).toMatchObject({
        role: "assistant",
        tool_calls: expect.any(Array)
      });
      expect(result[3]).toEqual({
        role: "tool",
        tool_call_id: "call_1",
        content: "Sunny, 25°C"
      });
      expect(result[4]).toEqual({
        role: "assistant",
        content: "The weather in Beijing is sunny with 25°C."
      });
    });
  });
});
