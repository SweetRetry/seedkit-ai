import { useRef } from 'react';
import { streamText, stepCountIs, generateText, NoOutputGeneratedError, type ModelMessage } from 'ai';
import { createSeed } from '@seedkit-ai/ai-sdk-provider';
import { PLAN_PRESETS } from '../../config/schema.js';
import type { Config } from '../../config/schema.js';
import { buildTools, isToolError, createTaskStore, type ConfirmFn, type AskQuestionFn } from '../../tools/index.js';
import { allMediaIds, getMedia, deleteMedia } from '../../media-store.js';
import { saveSession } from '../../sessions/index.js';
import { withRetry, classifyError } from '../../utils/retry.js';
import type { ToolSet } from 'ai';
import type { ToolCallEntry } from '../ToolCallView.js';
import type { Action, TurnEntry } from '../replReducer.js';
import type { AgentContext } from './useAgentContext.js';
import type { McpManager } from '../../mcp/manager.js';

const MAX_TOOL_STEPS = 50;

const CONTEXT_LIMIT = 256_000;
/** Start warning in StatusBar above this fraction */
export const CONTEXT_WARN_THRESHOLD = 0.75;
/** Auto-compact before sending when estimated usage exceeds this fraction */
const CONTEXT_COMPACT_THRESHOLD = 0.70;

/** Rough token estimate: 4 chars per token */
function estimateTokens(systemPrompt: string, messages: ModelMessage[]): number {
  return Math.ceil((systemPrompt.length + JSON.stringify(messages).length) / 4);
}

export function estimateContextPct(systemPrompt: string, messages: ModelMessage[]): number {
  return estimateTokens(systemPrompt, messages) / CONTEXT_LIMIT;
}

interface UseAgentStreamOptions {
  cwd: string;
  skipConfirm: boolean;
  apiKey: string;
  dispatch: React.Dispatch<Action>;
  stateRef: React.MutableRefObject<{ totalTokens: number }>;
  context: AgentContext;
  mcpManager?: McpManager;
}

export interface AgentStream {
  messages: React.MutableRefObject<ModelMessage[]>;
  turnCount: React.MutableRefObject<number>;
  inFlight: React.MutableRefObject<boolean>;
  abortRef: React.MutableRefObject<boolean>;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  taskStore: React.MutableRefObject<ReturnType<typeof createTaskStore>>;
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
    case 'screenshot':
      return input.displayId ? `display ${input.displayId}` : 'auto-detect';
    case 'taskCreate':
      return `create: ${input.subject ?? ''}`;
    case 'taskUpdate':
      return `update ${input.taskId}${input.status ? ` → ${input.status}` : ''}`;
    case 'taskGet':
      return `get ${input.taskId}`;
    case 'taskList':
      return 'list tasks';
    case 'loadSkill':
      return String(input.name ?? '');
    case 'spawnAgent':
      return String(input.task ?? '').slice(0, 60);
    default:
      return JSON.stringify(input);
  }
}

export function useAgentStream({
  cwd, skipConfirm, apiKey, dispatch, stateRef, context, mcpManager,
}: UseAgentStreamOptions): AgentStream {
  const messages = useRef<ModelMessage[]>([]);
  const turnCount = useRef(0);
  const inFlight = useRef(false);
  const abortRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const taskStore = useRef(createTaskStore(cwd, context.sessionIdRef.current));

  const runStream = async (cfg: Config) => {
    let accumulated = '';
    let accReasoning = '';
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let reasoningFlushTimer: ReturnType<typeof setTimeout> | null = null;
    /** Text from the last step — rendered only when the entire stream ends. */
    let lastStepText = '';
    let lastStepReasoning = '';

    const confirm: ConfirmFn = (pending) => {
      dispatch({ type: 'SET_PENDING_CONFIRM', pending });
    };

    const askQuestion: AskQuestionFn = (pending) => {
      dispatch({ type: 'SET_PENDING_QUESTION', pending });
    };

    const preset = PLAN_PRESETS[cfg.plan];
    const seed = createSeed({ apiKey, baseURL: preset.baseURL });
    const model = seed.chat(cfg.model as Parameters<typeof seed.chat>[0]);
    const onTaskChange = (items: import('../../tools/task.js').TaskItem[]) => {
      dispatch({ type: 'SET_ACTIVE_TASKS', tasks: items });
    };
    const agentProgressLines: string[] = [];
    const onSpawnAgentProgress = (info: { step: number; maxSteps: number; toolCalls: string[] }) => {
      if (info.toolCalls.length > 0) {
        agentProgressLines.push(...info.toolCalls);
      }
      // Show last 3 tool calls + step counter header
      const recent = agentProgressLines.slice(-3);
      const header = `Step ${info.step}/${info.maxSteps}`;
      const progressText = recent.length > 0
        ? `${header}\n${recent.join('\n')}`
        : header;
      dispatch({ type: 'UPDATE_TOOL_CALL_PROGRESS', toolName: 'spawnAgent', progress: progressText });
    };
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const builtinTools = buildTools({ cwd, confirm, askQuestion, skipConfirm, taskStore: taskStore.current, availableSkills: context.availableSkillsRef.current, model, onTaskChange, onSpawnAgentProgress, abortSignal: abortController.signal });

    // Merge MCP tools (if any connected servers)
    let tools: typeof builtinTools & Record<string, ToolSet[string]> = builtinTools;
    if (mcpManager) {
      try {
        const mcpTools = await mcpManager.allTools();
        if (Object.keys(mcpTools).length > 0) {
          tools = { ...builtinTools, ...mcpTools } as typeof tools;
        }
      } catch {
        dispatch({ type: 'PUSH_STATIC', entry: { type: 'info', content: 'MCP tools unavailable' } });
      }
    }

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

    // Auto-compact if estimated context exceeds threshold
    const contextPct = estimateContextPct(context.getEffectiveSystemPrompt(), messages.current);
    if (contextPct >= CONTEXT_COMPACT_THRESHOLD) {
      dispatch({
        type: 'PUSH_STATIC',
        entry: { type: 'info', content: `⚡ Context at ${Math.round(contextPct * 100)}% — auto-compacting before continuing...` },
      });
      await compactCore(cfg);
    }

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

    // Declared outside try so we can await response after streaming.
    // Type uses `typeof tools` to preserve the concrete tool map and avoid ToolSet variance issues.
    type ToolsMap = typeof tools;
    let streamResult: ReturnType<typeof streamText<ToolsMap>> | null = null;

    try {
      await withRetry(async () => {
        // Reset streaming state for each attempt (retries start fresh)
        accumulated = '';
        accReasoning = '';
        lastStepText = '';
        lastStepReasoning = '';

        streamResult = streamText({
          model,
          system: context.getEffectiveSystemPrompt(),
          messages: messages.current,
          tools,
          abortSignal: abortController.signal,
          stopWhen: stepCountIs(MAX_TOOL_STEPS),
          ...(cfg.thinking ? { providerOptions: { seed: { thinking: true } } } : {}),
          onStepFinish: (step) => {
            dispatch({ type: 'SET_STEP', step: step.stepNumber + 1 });

            if (step.text) {
              if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
              if (reasoningFlushTimer) { clearTimeout(reasoningFlushTimer); reasoningFlushTimer = null; }

              // Don't push assistant text during the tool loop — save it.
              // Only the final step's text will be rendered when the stream ends.
              lastStepText = step.text;
              lastStepReasoning = step.reasoningText ?? '';
              accumulated = '';
              dispatch({ type: 'STEP_FINISH' });
            }

            if (step.toolCalls && step.toolCalls.length > 0) {
              for (const tc of step.toolCalls) {
                const tr = step.toolResults?.find((r) => r.toolCallId === tc.toolCallId);
                const isError = isToolError(tr?.output);
                let doneOutput: string | undefined;
                if (!isError && tc.toolName === 'bash' && tr?.output) {
                  const out = tr.output as { stdout?: string; stderr?: string };
                  const combined = [out.stdout, out.stderr].filter(Boolean).join('\n').trim();
                  doneOutput = combined || undefined;
                }
                const entry: ToolCallEntry = {
                  id: tc.toolCallId,
                  toolName: tc.toolName as import('../../tools/index.js').ToolName,
                  description: buildToolDescription(tc.toolName, tc.input as Record<string, unknown>),
                  status: isError ? 'error' : 'done',
                  output: isError ? (tr?.output as import('../../tools/index.js').ToolError).error : doneOutput,
                };
                dispatch({ type: 'PUSH_STATIC', entry: { type: 'toolcall', entry } });
              }
              dispatch({ type: 'FLUSH_TOOL_CALLS' });
            }

            const WARN_THRESHOLD = MAX_TOOL_STEPS - 5;
            if (step.stepNumber + 1 === WARN_THRESHOLD) {
              dispatch({
                type: 'PUSH_STATIC',
                entry: { type: 'info', content: `⚠ Step ${WARN_THRESHOLD}/${MAX_TOOL_STEPS} — approaching limit. Wrap up soon.` },
              });
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

        for await (const part of streamResult!.fullStream) {
          if (abortRef.current) break;
          if (part.type === 'reasoning-delta') {
            scheduleReasoningFlush(accReasoning + part.text);
          } else if (part.type === 'text-delta') {
            scheduleFlush(accumulated + part.text, false);
          } else if (part.type === 'tool-input-start') {
            // Tool call starting — discard any intermediate assistant text (e.g. "Let me search…").
            // This text will also appear in onStepFinish where we intentionally skip it for tool steps.
            if (accumulated) {
              if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
              if (reasoningFlushTimer) { clearTimeout(reasoningFlushTimer); reasoningFlushTimer = null; }
              accumulated = '';
              accReasoning = '';
              dispatch({ type: 'STEP_FINISH' });
            }
            dispatch({
              type: 'PUSH_ACTIVE_TOOL_CALL',
              entry: {
                id: part.id,
                toolName: part.toolName as import('../../tools/index.js').ToolName,
                description: part.toolName,
                status: 'running',
              },
            });
          }
        }
      },
      // onRetry: surface retry info to user
      (attempt, delayMs, err) => {
        const cls = classifyError(err);
        const label = cls === 'rate_limit' ? 'Rate limited' : 'Network error';
        dispatch({
          type: 'PUSH_STATIC',
          entry: { type: 'info', content: `⚠ ${label} — retrying in ${(delayMs / 1000).toFixed(1)}s (attempt ${attempt}/3)...` },
        });
      },
      abortController.signal);
    } catch (err) {
      if (flushTimer) clearTimeout(flushTimer);
      if (reasoningFlushTimer) clearTimeout(reasoningFlushTimer);

      // Abort: user pressed Ctrl+C — not an error, just clean up silently.
      if (err instanceof Error && err.name === 'AbortError') {
        messages.current.pop();
        dispatch({ type: 'STREAM_END' });
        inFlight.current = false;
        return;
      }

      // NoOutputGeneratedError: API returned empty response (no text, no tool calls).
      // This is recoverable — show a friendly message and let the user retry.
      if (NoOutputGeneratedError.isInstance(err)) {
        messages.current.pop();
        dispatch({ type: 'STREAM_ERROR', content: 'Model returned an empty response. Try rephrasing or sending again.' });
        inFlight.current = false;
        return;
      }

      messages.current.pop();
      const cls = classifyError(err);
      const msg = err instanceof Error ? err.message : String(err);

      let content: string;
      if (cls === 'auth') {
        content = 'Invalid API key. Set ARK_API_KEY or reconfigure with /model.';
      } else if (cls === 'network' || cls === 'rate_limit') {
        content = `Network error: ${msg}\n(Retries exhausted. Check your connection and try again.)`;
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

    if (abortRef.current) {
      // User interrupted — remove the user message we pushed
      messages.current.pop();
    } else {
      // Retrieve all response messages (assistant + tool) from the completed stream.
      // Includes intermediate tool-call and tool-result messages from multi-step loops.
      try {
        const { messages: responseMessages } = await streamResult!.response;
        messages.current.push(...(responseMessages as ModelMessage[]));
      } catch (err) {
        // Stream completed but response extraction failed (e.g. empty response).
        // Steps already dispatched via onStepFinish — just log and continue.
        if (!NoOutputGeneratedError.isInstance(err)) {
          dispatch({ type: 'PUSH_STATIC', entry: { type: 'error', content: `Warning: failed to extract response messages — ${err instanceof Error ? err.message : String(err)}` } });
        }
      }

      // Render the final assistant text — only the last step's text is shown.
      // `lastStepText` is set by onStepFinish; `accumulated` is a fallback for
      // streaming text that arrived after the last onStepFinish (unlikely but safe).
      const finalText = lastStepText || accumulated;
      if (finalText) {
        dispatch({
          type: 'PUSH_STATIC',
          entry: { type: 'assistant', content: finalText, done: true, reasoning: lastStepReasoning || undefined },
        });
      }
    }

    abortControllerRef.current = null;
    saveSession(cwd, context.sessionIdRef.current, messages.current);
    // Terminal bell — notifies the user when a (potentially long) turn completes
    process.stdout.write('\x07');
    inFlight.current = false;
  };

  /** Core compact logic — does not touch inFlight or STREAM_START/END. */
  const compactCore = async (cfg: Config): Promise<void> => {
    if (messages.current.length === 0) {
      dispatch({ type: 'PUSH_STATIC', entry: { type: 'info', content: 'Nothing to compact.' } });
      return;
    }

    dispatch({ type: 'PUSH_STATIC', entry: { type: 'info', content: '⏳ Compacting conversation...' } });

    try {
      const compactPreset = PLAN_PRESETS[cfg.plan];
      const compactSeed = createSeed({ apiKey, baseURL: compactPreset.baseURL });
      const summary = await generateText({
        model: compactSeed.chat(cfg.model as Parameters<typeof compactSeed.chat>[0]),
        messages: [
          ...messages.current,
          {
            role: 'user' as const,
            content:
              'Produce a compact context summary of this conversation for your own use in continuing the session. ' +
              'Write in first-person as the assistant. Be precise and technical — this summary will replace the full history. ' +
              'You MUST cover (omit sections that have no content):\n' +
              '1. FILES MODIFIED: exact paths, what changed and why\n' +
              '2. ERRORS & FIXES: error messages encountered and how they were resolved\n' +
              '3. KEY DECISIONS: architectural or approach choices made, with rationale\n' +
              '4. OPEN TASKS: any todo items or work still in progress\n' +
              '5. FACTS ESTABLISHED: API signatures, config values, dependency versions, or other facts confirmed\n' +
              'Preserve file paths, function names, and error messages verbatim. ≤600 words. Output only the summary text, no headings or labels.',
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
  };

  const runCompact = async (cfg: Config) => {
    inFlight.current = true;
    dispatch({ type: 'STREAM_START' });
    await compactCore(cfg);
    inFlight.current = false;
    dispatch({ type: 'STREAM_END' });
  };

  return { messages, turnCount, inFlight, abortRef, abortControllerRef, taskStore, runStream, runCompact };
}
