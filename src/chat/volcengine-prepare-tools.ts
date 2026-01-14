import {
  LanguageModelV3CallOptions,
  SharedV3Warning,
  UnsupportedFunctionalityError,
} from '@ai-sdk/provider';
import { validateTypes } from '@ai-sdk/provider-utils';
import { webSearchArgsSchema } from '../tool/web-search';

export type VolcengineToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; function: { name: string } };

export type VolcengineTool =
  | {
      type: 'function';
      function: {
        name: string;
        description: string | undefined;
        parameters: unknown;
      };
    }
  | {
      type: 'web_search';
      web_search?: {
        max_keyword?: number;
        limit?: number;
        max_tool_calls?: number;
      };
    };

export async function prepareTools({
  tools,
  toolChoice,
}: {
  tools: LanguageModelV3CallOptions['tools'];
  toolChoice?: LanguageModelV3CallOptions['toolChoice'];
}): Promise<{
  tools: VolcengineTool[] | undefined;
  toolChoice: VolcengineToolChoice | undefined;
  toolWarnings: SharedV3Warning[];
}> {
  // when the tools array is empty, change it to undefined to prevent errors:
  tools = tools?.length ? tools : undefined;

  const toolWarnings: SharedV3Warning[] = [];

  if (tools == null) {
    return { tools: undefined, toolChoice: undefined, toolWarnings };
  }

  const volcengineTools: VolcengineTool[] = [];

  for (const tool of tools) {
    if (tool.type === 'provider') {
      const toolId = tool.id;

      switch (toolId) {
        case 'volcengine.web_search': {
          const args = await validateTypes({
            value: tool.args,
            schema: webSearchArgsSchema,
          });

          volcengineTools.push({
            type: 'web_search',
            web_search: {
              max_keyword: args.maxKeyword,
              limit: args.limit,
              max_tool_calls: args.maxToolCalls,
            },
          });
          break;
        }

        default:
          toolWarnings.push({
            type: 'unsupported',
            feature: `provider-defined tool ${toolId}`,
          });
      }
    } else {
      volcengineTools.push({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      });
    }
  }

  if (toolChoice == null) {
    return { tools: volcengineTools, toolChoice: undefined, toolWarnings };
  }

  const type = toolChoice.type;

  switch (type) {
    case 'auto':
    case 'none':
      return { tools: volcengineTools, toolChoice: type, toolWarnings };
    case 'required':
      return { tools: volcengineTools, toolChoice: 'required', toolWarnings };
    case 'tool':
      return {
        tools: volcengineTools,
        toolChoice: {
          type: 'function',
          function: { name: toolChoice.toolName },
        },
        toolWarnings,
      };
    default: {
      const _exhaustiveCheck: never = type;
      throw new UnsupportedFunctionalityError({
        functionality: `tool choice type: ${_exhaustiveCheck}`,
      });
    }
  }
}
