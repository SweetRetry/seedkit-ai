import { LanguageModelV3Prompt, SharedV3Warning } from '@ai-sdk/provider';
import { convertToBase64 } from '@ai-sdk/provider-utils';

type VolcengineInputImagePart = {
  type: 'input_image';
  image_url: string;
  detail?: 'low' | 'high' | 'xhigh';
  image_pixel_limit?: {
    max_pixels?: number;
    min_pixels?: number;
  };
};

type VolcengineInputItem =
  | {
      type: 'message';
      role: 'user';
      content: Array<
        | { type: 'input_text'; text: string }
        | VolcengineInputImagePart
        | { type: 'input_file'; file_url?: string; file_data?: string; filename?: string }
      >;
    }
  | {
      type: 'message';
      role: 'assistant';
      content: Array<
        | { type: 'output_text'; text: string }
        | { type: 'refusal'; refusal: string }
      >;
    }
  | {
      type: 'function_call';
      call_id: string;
      name: string;
      arguments: string;
    }
  | {
      type: 'function_call_output';
      call_id: string;
      output: string;
    };

export async function convertToVolcengineResponsesInput({
  prompt,
}: {
  prompt: LanguageModelV3Prompt;
}): Promise<{
  input: VolcengineInputItem[];
  instructions: string | undefined;
  warnings: Array<SharedV3Warning>;
}> {
  const input: VolcengineInputItem[] = [];
  const warnings: Array<SharedV3Warning> = [];
  const systemMessages: string[] = [];

  for (const { role, content } of prompt) {
    switch (role) {
      case 'system': {
        systemMessages.push(content);
        break;
      }

      case 'user': {
        const userContent: Array<
          | { type: 'input_text'; text: string }
          | { type: 'input_image'; image_url: string }
          | {
              type: 'input_file';
              file_url?: string;
              file_data?: string;
              filename?: string;
            }
        > = [];

        for (const part of content) {
          switch (part.type) {
            case 'text': {
              userContent.push({ type: 'input_text', text: part.text });
              break;
            }
            case 'file': {
              if (part.mediaType.startsWith('image/')) {
                const mediaType =
                  part.mediaType === 'image/*' ? 'image/jpeg' : part.mediaType;

                const volcengineOptions = part.providerOptions?.volcengine as
                  | {
                      detail?: 'low' | 'high' | 'xhigh';
                      image_pixel_limit?: { max_pixels?: number; min_pixels?: number };
                    }
                  | undefined;

                const imagePart: VolcengineInputImagePart = {
                  type: 'input_image',
                  image_url:
                    part.data instanceof URL
                      ? part.data.toString()
                      : `data:${mediaType};base64,${convertToBase64(part.data)}`,
                };

                if (volcengineOptions?.detail != null) {
                  imagePart.detail = volcengineOptions.detail;
                }
                if (volcengineOptions?.image_pixel_limit != null) {
                  imagePart.image_pixel_limit = volcengineOptions.image_pixel_limit;
                }

                userContent.push(imagePart);
                break;
              }

              if (part.mediaType === 'application/pdf') {
                if (part.data instanceof URL) {
                  userContent.push({
                    type: 'input_file',
                    file_url: part.data.toString(),
                    filename: part.filename,
                  });
                } else if (
                  typeof part.data === 'string' &&
                  (part.data.startsWith('http://') ||
                    part.data.startsWith('https://'))
                ) {
                  userContent.push({
                    type: 'input_file',
                    file_url: part.data,
                    filename: part.filename,
                  });
                } else {
                  userContent.push({
                    type: 'input_file',
                    file_data: `data:application/pdf;base64,${convertToBase64(part.data)}`,
                    filename: part.filename ?? 'document.pdf',
                  });
                }
                break;
              }

              warnings.push({
                type: 'other',
                message: `unsupported file content type: ${part.mediaType}`,
              });
              break;
            }
          }
        }

        input.push({ type: 'message', role: 'user', content: userContent });
        break;
      }

      case 'assistant': {
        const assistantContent: Array<
          { type: 'output_text'; text: string } | { type: 'refusal'; refusal: string }
        > = [];

        for (const part of content) {
          switch (part.type) {
            case 'text': {
              assistantContent.push({ type: 'output_text', text: part.text });
              break;
            }
            case 'tool-call': {
              input.push({
                type: 'function_call',
                call_id: part.toolCallId,
                name: part.toolName,
                arguments:
                  typeof part.input === 'string'
                    ? part.input
                    : JSON.stringify(part.input),
              });
              break;
            }
            case 'reasoning': {
              assistantContent.push({
                type: 'output_text',
                text: part.text,
              });
              break;
            }
            default: {
              warnings.push({
                type: 'other',
                message: `unsupported assistant content part type: ${(part as { type: string }).type}`,
              });
            }
          }
        }

        if (assistantContent.length > 0) {
          input.push({
            type: 'message',
            role: 'assistant',
            content: assistantContent,
          });
        }

        break;
      }

      case 'tool': {
        for (const part of content) {
          if (part.type !== 'tool-result') {
            continue;
          }

          let output: string;
          switch (part.output.type) {
            case 'text':
            case 'error-text':
              output = part.output.value;
              break;
            case 'execution-denied':
              output = part.output.reason ?? 'Tool execution denied.';
              break;
            case 'json':
            case 'error-json':
              output = JSON.stringify(part.output.value);
              break;
            case 'content':
              output = JSON.stringify(part.output.value);
              break;
            default:
              warnings.push({
                type: 'other',
                message: `unsupported tool result type: ${(part.output as { type: string }).type}`,
              });
              continue;
          }

          input.push({
            type: 'function_call_output',
            call_id: part.toolCallId,
            output,
          });
        }

        break;
      }
    }
  }

  return {
    input,
    instructions:
      systemMessages.length > 0 ? systemMessages.join('\n') : undefined,
    warnings,
  };
}
