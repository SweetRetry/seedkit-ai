import {
  LanguageModelV3DataContent,
  LanguageModelV3Prompt,
  UnsupportedFunctionalityError
} from "@ai-sdk/provider";
import { convertToBase64 } from "@ai-sdk/provider-utils";
import {
  VolcengineChatAssistantMessage,
  VolcengineChatPrompt,
  VolcengineChatUserMessageContent
} from "./volcengine-chat-prompt";

function formatDataUrl(data: LanguageModelV3DataContent, mediaType: string): string {
  if (data instanceof URL) {
    return data.toString();
  }
  if (typeof data === "string") {
    return data.startsWith("data:") ? data : `data:${mediaType};base64,${data}`;
  }
  return `data:${mediaType};base64,${convertToBase64(data)}`;
}


export function convertToVolcengineChatMessages(
  prompt: LanguageModelV3Prompt
): VolcengineChatPrompt {
  const messages: VolcengineChatPrompt = [];

  for (const message of prompt) {
    switch (message.role) {
      case "system": {
        messages.push({
          role: "system",
          content: message.content
        });
        break;
      }

      case "user": {
        messages.push({
          role: "user",
          content: message.content.map((part): VolcengineChatUserMessageContent => {
            switch (part.type) {
              case "text":
                return { type: "text", text: part.text };

              case "file": {
                const { mediaType, data } = part;

                if (mediaType.startsWith("image/")) {
                  return {
                    type: "image_url",
                    image_url: { url: formatDataUrl(data, mediaType) }
                  };
                }
                if (mediaType.startsWith("video/")) {
                  return {
                    type: "video_url",
                    video_url: { url: formatDataUrl(data, mediaType) }
                  };
                }
                if (mediaType === "application/pdf") {
                  // URL format
                  if (data instanceof URL) {
                    return {
                      type: "input_file",
                      file_url: data.toString()
                    };
                  }
                  // String: could be URL or base64
                  if (typeof data === "string") {
                    // Check if it's a URL (http/https) or data URL
                    if (data.startsWith("http://") || data.startsWith("https://")) {
                      return {
                        type: "input_file",
                        file_url: data
                      };
                    }
                    // Base64 string or data URL
                    const base64Data = data.startsWith("data:")
                      ? data
                      : `data:application/pdf;base64,${data}`;
                    return {
                      type: "input_file",
                      file_data: base64Data,
                      filename: part.filename ?? "document.pdf"
                    };
                  }
                  // Uint8Array: convert to base64
                  return {
                    type: "input_file",
                    file_data: `data:application/pdf;base64,${convertToBase64(data)}`,
                    filename: part.filename ?? "document.pdf"
                  };
                }
                throw new UnsupportedFunctionalityError({
                  functionality: `File type: ${mediaType}`
                });
              }

              default: {
                const _exhaustiveCheck: never = part;
                throw new UnsupportedFunctionalityError({
                  functionality: `User message part type: ${(_exhaustiveCheck as { type: string }).type}`
                });
              }
            }
          })
        });
        break;
      }

      case "assistant": {
        let text = "";
        let reasoningContent: string | undefined;
        const toolCalls: VolcengineChatAssistantMessage["tool_calls"] = [];

        for (const part of message.content) {
          switch (part.type) {
            case "text":
              text += part.text;
              break;
            case "reasoning":
              reasoningContent = (reasoningContent ?? "") + part.text;
              break;
            case "tool-call":
              toolCalls.push({
                id: part.toolCallId,
                type: "function",
                function: {
                  name: part.toolName,
                  arguments:
                    typeof part.input === "string"
                      ? part.input
                      : JSON.stringify(part.input)
                }
              });
              break;
            case "file":
            case "tool-result":
              // Skip file and tool-result in assistant messages
              break;
            default: {
              const _exhaustiveCheck: never = part;
              throw new UnsupportedFunctionalityError({
                functionality: `Assistant message part type: ${(_exhaustiveCheck as { type: string }).type}`
              });
            }
          }
        }

        messages.push({
          role: "assistant",
          content: text,
          reasoning_content: reasoningContent,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined
        });
        break;
      }

      case "tool": {
        for (const toolResponse of message.content) {
          if (toolResponse.type === "tool-approval-response") {
            continue;
          }

          const { output } = toolResponse;
          let content: string;

          switch (output.type) {
            case "text":
            case "error-text":
              content = output.value;
              break;
            case "json":
            case "error-json":
              content = JSON.stringify(output.value);
              break;
            case "execution-denied":
              content = output.reason ?? "Tool execution denied.";
              break;
            case "content":
              content = output.value
                .map((v) => (v.type === "text" ? v.text : JSON.stringify(v)))
                .join("\n");
              break;
          }

          messages.push({
            role: "tool",
            tool_call_id: toolResponse.toolCallId,
            content
          });
        }
        break;
      }

      default: {
        const _exhaustiveCheck: never = message;
        throw new UnsupportedFunctionalityError({
          functionality: `Message role: ${(_exhaustiveCheck as { role: string }).role}`
        });
      }
    }
  }

  return messages;
}
