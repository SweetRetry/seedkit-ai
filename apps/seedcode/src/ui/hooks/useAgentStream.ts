import { useRef } from 'react';
import { streamText, stepCountIs, generateText, type ModelMessage } from 'ai';
import type { Config } from '../../config/schema.js';
import { buildTools, isToolError, createTodoStore, type ConfirmFn, type AskQuestionFn } from '../../tools/index.js';
import { allMediaIds, getMedia, deleteMedia } from '../../media-store.js';
import { saveSession } from '../../sessions/index.js';
import type { ToolCallEntry } from '../ToolCallView.js';
import type { Action, TurnEntry } from '../replReducer.js';
import type { AgentContext } from './useAgentContext.js';

const MAX_TOOL_STEPS = 20;

interface UseAgentStreamOptions {
  cwd: string;
  skipConfirm: boolean;
  seed: ReturnType<typeof import('@seedkit-ai/ai-sdk-provider').createSeed>;
  dispatch: React.Dispatch<Action>;
  stateRef: React.MutableRefObject<{ totalTokens: number }>;
  context: AgentContext;
}

export interface AgentStream {
  messages: React.MutableRefObject<ModelMessage[]>;
  turnCount: React.MutableRefObject<number>;
  inFlight: React.MutableRefObject<boolean>;
  abortRef: React.MutableRefObject<boolean>;
  todoStore: React.MutableRefObject<ReturnType<typeof createTodoStore>>;
  runStream: (cfg: Config) => Promise<void>;
  runCompact: (cfg: Config) => Promise<void>;
}

function buildToolDescription(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'read':
    case 'edit':
    case 'write':
      return String(input.path ?? '');
    case 'glob':
      return String(input.pattern ?? '');
    case 'grep':
      return `${input.pattern} in ${input.fileGlob}`;
    case 'bash':
      return String(input.command ?? '');
    case 'webSearch':
      return String(input.query ?? '');
    case 'webFetch':
      return String(input.url ?? '');
    case 'listDisplays':
      return 'list displays';
    case 'screenshot':
      return `display ${input.displayId ?? 1}`;
    case 'todoWrite':
      return input.id ? `update task ${input.id}` : `create: ${input.subject}`;
    case 'todoRead':
      return input.id ? `read task ${input.id}` : 'list all tasks';
    default:
      return JSON.stringify(input);
  }
}

export function useAgentStream({
  cwd, skipConfirm, seed, dispatch, stateRef, context,
}: UseAgentStreamOptions): AgentStream {
  const messages = useRef<ModelMessage[]>([]);
  const turnCount = useRef(0);
  const inFlight = useRef(false);
  const abortRef = useRef(false);
  const todoStore = useRef(createTodoStore());

  const runStream = async (cfg: Config) => {
    let accumulated = '';
    let accReasoning = '';
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let reasoningFlushTimer: ReturnType<typeof setTimeout> | null = null;

    const confirm: ConfirmFn = (pending) => {
      dispatch({ type: 'SET_PENDING_CONFIRM', pending });
    };

    const askQuestion: AskQuestionFn = (pending) => {
      dispatch({ type: 'SET_PENDING_QUESTION', pending });
    };

    const tools = buildTools({ cwd, confirm, askQuestion, skipConfirm, todoStore: todoStore.current });

    const scheduleFlush = (text: string, done: boolean) => {
      accumulated = text;
      if (done) {
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        dispatch({ type: 'STREAM_TICK', text: accumulated });
        return;
      }
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        dispatch({ type: 'STREAM_TICK', text: accumulated });
      }, 50);
    };

    const scheduleReasoningFlush = (text: string) => {
      accReasoning = text;
      if (reasoningFlushTimer) return;
      reasoningFlushTimer = setTimeout(() => {
        reasoningFlushTimer = null;
        dispatch({ type: 'REASONING_TICK', text: accReasoning });
      }, 80);
    };

    // Inject pending media (screenshots) as user message parts
    const pendingMediaIds = allMediaIds();
    if (pendingMediaIds.length > 0) {
      const fileParts = pendingMediaIds
        .map((id) => getMedia(id))
        .filter((m): m is NonNullable<typeof m> => m !== undefined)
        .map((m) => ({ type: 'file' as const, data: m.data, mediaType: m.mediaType as `${string}/${string}` }));

      if (fileParts.length > 0) {
        messages.current.push({
          role: 'user',
          content: [...fileParts, { type: 'text', text: `[${fileParts.length} screenshot(s) attached above]` }],
        });
      }
      for (const id of pendingMediaIds) deleteMedia(id);
    }

    try {
      const result = streamText({
        model: seed.chat(cfg.model as Parameters<typeof seed.chat>[0]),
        system: context.getEffectiveSystemPrompt(),
        messages: messages.current,
        tools,
        stopWhen: stepCountIs(MAX_TOOL_STEPS),
        ...(cfg.thinking ? { providerOptions: { seed: { thinking: true } } } : {}),
        onStepFinish: (step) => {
          const stepReasoning = step.reasoningText ?? '';

          if (step.text) {
            if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
            if (reasoningFlushTimer) { clearTimeout(reasoningFlushTimer); reasoningFlushTimer = null; }

            dispatch({
              type: 'PUSH_STATIC',
              entry: { type: 'assistant', content: step.text, done: false, reasoning: stepReasoning || undefined },
            });
            accumulated = '';
            dispatch({ type: 'STEP_FINISH' });
          }

          if (step.toolCalls && step.toolCalls.length > 0) {
            for (const tc of step.toolCalls) {
              const tr = step.toolResults?.find((r) => r.toolCallId === tc.toolCallId);
              const isError = isToolError(tr?.output);
              const entry: ToolCallEntry = {
                id: tc.toolCallId,
                toolName: tc.toolName as import('../../tools/index.js').ToolName,
                description: buildToolDescription(tc.toolName, tc.input as Record<string, unknown>),
                status: isError ? 'error' : 'done',
                output: isError ? (tr?.output as import('../../tools/index.js').ToolError).error : undefined,
              };
              dispatch({ type: 'PUSH_STATIC', entry: { type: 'toolcall', entry } });
            }
            dispatch({ type: 'FLUSH_TOOL_CALLS' });
          }

          if (step.stepNumber + 1 >= MAX_TOOL_STEPS) {
            dispatch({
              type: 'PUSH_STATIC',
              entry: { type: 'error', content: `Hard limit reached: ${MAX_TOOL_STEPS} tool steps in one turn. Stopping.` },
            });
            abortRef.current = true;
          }
        },
        onFinish: (result) => {
          if (result.usage) {
            dispatch({ type: 'ADD_TOKENS', count: result.usage.totalTokens ?? 0 });
          }
        },
      });

      for await (const part of result.fullStream) {
        if (abortRef.current) break;
        if (part.type === 'reasoning-delta') {
          scheduleReasoningFlush(accReasoning + part.text);
        } else if (part.type === 'text-delta') {
          scheduleFlush(accumulated + part.text, false);
        }
      }
    } catch (err) {
      if (flushTimer) clearTimeout(flushTimer);
      if (reasoningFlushTimer) clearTimeout(reasoningFlushTimer);
      messages.current.pop();
      const msg = err instanceof Error ? err.message : String(err);
      const isAuthError = msg.includes('401') || msg.toLowerCase().includes('invalid api key');

      let content: string;
      if (isAuthError) {
        content = 'Invalid API key. Set ARK_API_KEY or reconfigure with /model.';
      } else if (msg.includes('network') || msg.includes('ECONNREFUSED')) {
        content = `Network error: ${msg}\n(Check your connection and try again.)`;
      } else {
        content = `Error: ${msg}`;
      }

      dispatch({ type: 'STREAM_ERROR', content });
      inFlight.current = false;
      return;
    }

    if (reasoningFlushTimer) { clearTimeout(reasoningFlushTimer); reasoningFlushTimer = null; }
    scheduleFlush(accumulated, true);
    dispatch({ type: 'STREAM_END' });

    if (!abortRef.current && accumulated) {
      messages.current.push({ role: 'assistant', content: accumulated });
      dispatch({ type: 'PUSH_STATIC', entry: { type: 'assistant', content: accumulated, done: true } });
    } else if (abortRef.current) {
      messages.current.pop();
    }

    saveSession(cwd, context.sessionIdRef.current, messages.current);
    inFlight.current = false;
  };

  const runCompact = async (cfg: Config) => {
    if (messages.current.length === 0) {
      dispatch({ type: 'PUSH_STATIC', entry: { type: 'info', content: 'Nothing to compact.' } });
      return;
    }

    inFlight.current = true;
    dispatch({ type: 'STREAM_START' });
    dispatch({ type: 'PUSH_STATIC', entry: { type: 'info', content: '⏳ Compacting conversation...' } });

    try {
      const summary = await generateText({
        model: seed.chat(cfg.model as Parameters<typeof seed.chat>[0]),
        messages: [
          ...messages.current,
          {
            role: 'user' as const,
            content:
              'Produce a compact context summary of this conversation for your own use in continuing the session. Write in first-person as the assistant. Cover: decisions made, files modified, key facts established, and any open tasks. ≤500 words. Output only the summary text, no headings.',
          },
        ],
      });

      const tokensBefore = stateRef.current.totalTokens;
      const summaryTokens = Math.ceil((summary.text?.length ?? 0) / 4);
      messages.current = [{ role: 'assistant', content: summary.text ?? '' }];
      dispatch({ type: 'SET_TOTAL_TOKENS', count: summaryTokens });
      dispatch({ type: 'PUSH_STATIC', entry: { type: 'info', content: `✓ Compacted: ~${tokensBefore} → ~${summaryTokens} tokens` } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      dispatch({ type: 'PUSH_STATIC', entry: { type: 'error', content: `Compact failed: ${msg}` } });
    }

    inFlight.current = false;
    dispatch({ type: 'STREAM_END' });
  };

  return { messages, turnCount, inFlight, abortRef, todoStore, runStream, runCompact };
}
