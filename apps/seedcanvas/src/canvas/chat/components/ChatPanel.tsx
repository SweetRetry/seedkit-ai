import { Sparkles } from "lucide-react"
import { useCallback, useRef } from "react"
import { type ChatMessage, type ToolCallEntry, useChatStore } from "@/canvas/chat/store"
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message"
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input"
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning"
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool"
import type { AppSettings } from "@/lib/settings"
import { SelectedNodeIndicator } from "./SelectedNodeIndicator"

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ToolCallView({ tc }: { tc: ToolCallEntry }) {
  const state =
    tc.status === "running"
      ? ("input-available" as const)
      : tc.status === "error"
        ? ("output-error" as const)
        : ("output-available" as const)

  return (
    <Tool defaultOpen={tc.status === "error"}>
      <ToolHeader type="dynamic-tool" state={state} toolName={tc.toolName} title={tc.toolName} />
      <ToolContent>
        <ToolInput input={tc.input} />
        {tc.output !== undefined && <ToolOutput output={tc.output} errorText={undefined} />}
      </ToolContent>
    </Tool>
  )
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  return (
    <Message from={msg.role}>
      {msg.reasoning && (
        <Reasoning defaultOpen={false}>
          <ReasoningTrigger />
          <ReasoningContent>{msg.reasoning}</ReasoningContent>
        </Reasoning>
      )}
      <MessageContent>
        {msg.content && <MessageResponse>{msg.content}</MessageResponse>}
      </MessageContent>
      {msg.toolCalls?.map((tc) => (
        <ToolCallView key={tc.id} tc={tc} />
      ))}
    </Message>
  )
}

function StreamingMessage({
  text,
  reasoning,
  toolCalls,
}: {
  text: string
  reasoning: string
  toolCalls: ToolCallEntry[]
}) {
  const hasContent = text || reasoning || toolCalls.length > 0
  if (!hasContent) return null

  return (
    <Message from="assistant">
      {reasoning && (
        <Reasoning isStreaming>
          <ReasoningTrigger />
          <ReasoningContent>{reasoning}</ReasoningContent>
        </Reasoning>
      )}
      <MessageContent>{text && <MessageResponse>{text}</MessageResponse>}</MessageContent>
      {toolCalls.map((tc) => (
        <ToolCallView key={tc.id} tc={tc} />
      ))}
    </Message>
  )
}

// ---------------------------------------------------------------------------
// ChatPanel
// ---------------------------------------------------------------------------

interface ChatPanelProps {
  settings: AppSettings
}

export function ChatPanel({ settings }: ChatPanelProps) {
  const messages = useChatStore((s) => s.messages)
  const status = useChatStore((s) => s.status)
  const error = useChatStore((s) => s.error)
  const streamingText = useChatStore((s) => s.streamingText)
  const streamingReasoning = useChatStore((s) => s.streamingReasoning)
  const activeToolCalls = useChatStore((s) => s.activeToolCalls)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const stopGeneration = useChatStore((s) => s.stopGeneration)

  const isStreaming = status === "streaming"

  // Map chat status to ChatStatus type expected by PromptInputSubmit
  const chatStatus = isStreaming ? "streaming" : error ? "error" : "ready"

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = useCallback(
    ({ text }: { text: string }) => {
      const trimmed = text.trim()
      if (!trimmed) return
      sendMessage(trimmed, settings)
    },
    [sendMessage, settings]
  )

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Conversation>
        <ConversationContent>
          {messages.length === 0 && !isStreaming ? (
            <ConversationEmptyState
              icon={<Sparkles size={24} />}
              title="Canvas AI"
              description="Ask me to create, modify, or explain nodes on your canvas."
            />
          ) : (
            <>
              {messages.map((msg) => (
                <MessageBubble key={msg.id} msg={msg} />
              ))}
              {isStreaming && (
                <StreamingMessage
                  text={streamingText}
                  reasoning={streamingReasoning}
                  toolCalls={activeToolCalls}
                />
              )}
            </>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {error && (
        <div className="px-4 py-2 text-xs text-destructive bg-destructive/10 border-t border-destructive/20">
          {error}
        </div>
      )}

      <div className="border-t border-sidebar-border p-3">
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputTextarea
            ref={textareaRef}
            placeholder="Ask about your canvas..."
            className="min-h-10 max-h-32"
            disabled={isStreaming}
          />
          <PromptInputFooter>
            <SelectedNodeIndicator />
            <PromptInputSubmit status={chatStatus} onStop={stopGeneration} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  )
}
