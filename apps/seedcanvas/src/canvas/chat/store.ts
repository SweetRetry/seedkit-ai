import { createSeed } from "@seedkit-ai/ai-sdk-provider"
import { type ModelMessage, stepCountIs, streamText } from "ai"
import { create } from "zustand"
import { useCanvasStore } from "@/canvas/store"
import { generateId } from "@/lib/id"
import type { AppSettings } from "@/lib/settings"
import { buildSystemPrompt } from "./system-prompt"
import { createCanvasTools } from "./tools"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolCallEntry {
  id: string
  toolName: string
  input: Record<string, unknown>
  output?: unknown
  status: "running" | "done" | "error"
}

export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  reasoning?: string
  toolCalls?: ToolCallEntry[]
  createdAt: string
}

export interface ChatState {
  messages: ChatMessage[]
  status: "idle" | "streaming" | "error"
  error: string | null
  streamingText: string
  streamingReasoning: string
  activeToolCalls: ToolCallEntry[]

  // Actions
  sendMessage: (text: string, settings: AppSettings) => Promise<void>
  stopGeneration: () => void
  clearMessages: () => void
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

let abortController: AbortController | null = null

function buildModelMessages(messages: ChatMessage[]): ModelMessage[] {
  const result: ModelMessage[] = []
  for (const msg of messages) {
    if (msg.role === "user") {
      result.push({ role: "user", content: msg.content })
    } else {
      // For assistant messages, include text content and any tool calls/results
      const parts: ModelMessage[] = []

      if (msg.content) {
        parts.push({ role: "assistant", content: msg.content })
      }

      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          parts.push({
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: tc.id,
                toolName: tc.toolName,
                input: tc.input,
              },
            ],
          })
          if (tc.output !== undefined) {
            parts.push({
              role: "tool",
              content: [
                {
                  type: "tool-result",
                  toolCallId: tc.id,
                  toolName: tc.toolName,
                  output: {
                    type: "text",
                    value: typeof tc.output === "string" ? tc.output : JSON.stringify(tc.output),
                  },
                },
              ],
            })
          }
        }
      }

      if (parts.length === 0 && msg.content) {
        parts.push({ role: "assistant", content: msg.content })
      }
      result.push(...parts)
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const THROTTLE_MS = 50

export const useChatStore = create<ChatState>()((set, get) => ({
  messages: [],
  status: "idle",
  error: null,
  streamingText: "",
  streamingReasoning: "",
  activeToolCalls: [],

  sendMessage: async (text, settings) => {
    if (!settings.apiKey) {
      set({ error: "No API key configured. Open Settings to add one." })
      return
    }

    // Add user message
    const userMsg: ChatMessage = {
      id: generateId(),
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    }
    set((s) => ({
      messages: [...s.messages, userMsg],
      status: "streaming",
      error: null,
      streamingText: "",
      streamingReasoning: "",
      activeToolCalls: [],
    }))

    abortController = new AbortController()

    try {
      const provider = createSeed({
        apiKey: settings.apiKey,
        baseURL: settings.baseURL,
      })
      const model = provider.chat(settings.model)

      // Build full canvas context for the system prompt
      const canvasState = useCanvasStore.getState()
      const systemPrompt = buildSystemPrompt({
        viewport: canvasState.viewport,
        nodes: canvasState.nodes,
        edges: canvasState.edges,
        selectedNodeIds: canvasState.selectedNodeIds,
      })
      const historyMessages = buildModelMessages(get().messages)

      const result = streamText({
        model,
        system: systemPrompt,
        messages: historyMessages,
        tools: createCanvasTools(settings),
        stopWhen: stepCountIs(10),
        abortSignal: abortController.signal,
        providerOptions: {
          seed: { thinking: true },
        },
      })

      let text = ""
      let reasoning = ""
      let lastUpdate = 0
      const toolCalls: ToolCallEntry[] = []

      for await (const part of result.fullStream) {
        // Check abort
        if (abortController?.signal.aborted) break

        switch (part.type) {
          case "text-delta": {
            text += part.text
            const now = Date.now()
            if (now - lastUpdate > THROTTLE_MS) {
              lastUpdate = now
              set({ streamingText: text })
            }
            break
          }

          case "reasoning-delta": {
            reasoning += part.text
            const now = Date.now()
            if (now - lastUpdate > THROTTLE_MS) {
              lastUpdate = now
              set({ streamingReasoning: reasoning })
            }
            break
          }

          case "tool-call": {
            const entry: ToolCallEntry = {
              id: part.toolCallId,
              toolName: part.toolName,
              input: part.input as Record<string, unknown>,
              status: "running",
            }
            toolCalls.push(entry)
            set({ activeToolCalls: [...toolCalls] })
            break
          }

          case "tool-result": {
            const tc = toolCalls.find((t) => t.id === part.toolCallId)
            if (tc) {
              tc.output = part.output
              tc.status = "done"
              set({ activeToolCalls: [...toolCalls] })
            }
            break
          }

          case "tool-error": {
            const tc = toolCalls.find((t) => t.id === part.toolCallId)
            if (tc) {
              tc.output = part.error
              tc.status = "error"
              set({ activeToolCalls: [...toolCalls] })
            }
            break
          }

          case "error": {
            set({ error: String(part.error), status: "error" })
            break
          }

          default:
            break
        }
      }

      // Flush final streaming state
      set({ streamingText: text, streamingReasoning: reasoning })

      // Commit assistant message
      const assistantMsg: ChatMessage = {
        id: generateId(),
        role: "assistant",
        content: text,
        reasoning: reasoning || undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        createdAt: new Date().toISOString(),
      }

      set((s) => ({
        messages: [...s.messages, assistantMsg],
        status: "idle",
        streamingText: "",
        streamingReasoning: "",
        activeToolCalls: [],
      }))
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        // User cancelled — commit partial response
        const partialText = get().streamingText
        if (partialText) {
          const partialMsg: ChatMessage = {
            id: generateId(),
            role: "assistant",
            content: partialText,
            reasoning: get().streamingReasoning || undefined,
            createdAt: new Date().toISOString(),
          }
          set((s) => ({
            messages: [...s.messages, partialMsg],
            status: "idle",
            streamingText: "",
            streamingReasoning: "",
            activeToolCalls: [],
          }))
        } else {
          set({ status: "idle", streamingText: "", streamingReasoning: "", activeToolCalls: [] })
        }
      } else {
        set({
          error: (err as Error).message ?? "Unknown error",
          status: "error",
          streamingText: "",
          streamingReasoning: "",
          activeToolCalls: [],
        })
      }
    } finally {
      abortController = null
    }
  },

  stopGeneration: () => {
    abortController?.abort()
  },

  clearMessages: () => {
    set({
      messages: [],
      status: "idle",
      error: null,
      streamingText: "",
      streamingReasoning: "",
      activeToolCalls: [],
    })
  },
}))
