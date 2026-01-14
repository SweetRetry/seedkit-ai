// export type MistralPrompt = Array<MistralMessage>;
export type VolcengineChatPrompt = Array<VolcengineChatMessage>;

export type VolcengineChatMessage =
    | VolcengineChatSystemMessage
    | VolcengineChatUserMessage
    | VolcengineChatAssistantMessage
    | VolcengineChatToolMessage;

export interface VolcengineChatSystemMessage {
    role: 'system';
    content: string;
}

export interface VolcengineChatUserMessage {
    role: 'user';
    content: Array<VolcengineChatUserMessageContent>;
}

export type VolcengineChatUserMessageContent =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string, } }
    | { type: 'video_url', video_url: { url: string, } }

export interface VolcengineChatAssistantMessage {
    role: 'assistant';
    reasoning_content?: string;
    content: string;
    tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
    }>;
}

export interface VolcengineChatToolMessage {
    role: 'tool';
    content: string;
    tool_call_id: string;
}