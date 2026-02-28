import React, { useReducer, useCallback, useRef, useEffect } from 'react';
import { Box } from 'ink';
import type { ModelMessage } from 'ai';
import type { Config } from '../config/schema.js';
import type { SkillEntry } from '../context/index.js';
import { handleSlashCommand, type SessionState } from '../commands/slash.js';
import { createTodoStore } from '../tools/index.js';
import { resolveMentions } from '../context/mentions.js';
import { createSession, loadSession, listSessions, type SessionEntry } from '../sessions/index.js';
import { clearMediaStore } from '../media-store.js';
import { InputBox } from './InputBox.js';
import { ModelPicker } from './pickers/ModelPicker.js';
import { ResumePicker } from './pickers/ResumePicker.js';
import { MemoryPicker } from './pickers/MemoryPicker.js';
import { QuestionPrompt } from './QuestionPrompt.js';
import { MessageList } from './MessageList.js';
import { StatusBar } from './StatusBar.js';
import { ActiveToolCallsView } from './ActiveToolCallsView.js';
import { ConfirmPrompt } from './ConfirmPrompt.js';
import { TodoListView } from './TodoListView.js';
import { replReducer, type AppState } from './replReducer.js';
import { useAgentContext } from './hooks/useAgentContext.js';
import { useAgentStream, estimateContextPct } from './hooks/useAgentStream.js';

export type { TurnEntry } from './replReducer.js';

export interface SavedReplState {
  messages: ModelMessage[];
  sessionId: string;
  turnCount: number;
  staticTurns: import('./replReducer.js').TurnEntry[];
  totalTokens: number;
}

interface ReplAppProps {
  config: Config;
  version: string;
  seed: ReturnType<typeof import('@seedkit-ai/ai-sdk-provider').createSeed>;
  onExit: () => void;
  onOpenEditor: (filePath: string, saved: SavedReplState) => void;
  skipConfirm?: boolean;
  initialSkills?: SkillEntry[];
  savedState?: SavedReplState;
}

const INITIAL_STATE = (initialConfig: Config, initialSkills: SkillEntry[]): AppState => ({
  staticTurns: [],
  activeTurn: null,
  activeReasoning: null,
  streaming: false,
  activeToolCalls: [],
  activeTodos: [],
  pendingConfirm: null,
  pendingQuestion: null,
  liveConfig: initialConfig,
  totalTokens: 0,
  waitingForModel: false,
  availableSkills: initialSkills,
  resumeSessions: null,
  memoryPicker: false,
});

export function ReplApp({ config: initialConfig, version, seed, onExit, onOpenEditor, skipConfirm = false, initialSkills = [], savedState }: ReplAppProps) {
  const cwd = process.cwd();

  const [state, dispatch] = useReducer(replReducer, undefined, () => {
    const base = INITIAL_STATE(initialConfig, initialSkills);
    if (!savedState) return base;
    return { ...base, staticTurns: savedState.staticTurns, totalTokens: savedState.totalTokens };
  });

  // Single ref that always reflects current state — used by stable callbacks
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; });

  const context = useAgentContext({ cwd, dispatch });

  const stream = useAgentStream({ cwd, skipConfirm, seed, dispatch, stateRef, context });

  // Restore conversation state after returning from editor
  useEffect(() => {
    if (!savedState) return;
    stream.messages.current = savedState.messages;
    stream.turnCount.current = savedState.turnCount;
    context.sessionIdRef.current = savedState.sessionId;
    stream.todoStore.current = createTodoStore(cwd, savedState.sessionId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Session management ─────────────────────────────────────────────────

  const handleResumeSelect = useCallback((sessionId: string | null) => {
    dispatch({ type: 'SET_RESUME_SESSIONS', sessions: null });
    if (!sessionId) return;
    const loaded = loadSession(cwd, sessionId);
    if (loaded.length === 0) {
      dispatch({ type: 'PUSH_STATIC', entry: { type: 'info', content: '✗ Session not found or empty.' } });
      return;
    }
    stream.messages.current = loaded;
    stream.turnCount.current = loaded.filter((m) => m.role === 'user').length;
    context.sessionIdRef.current = sessionId;
    stream.todoStore.current = createTodoStore(cwd, sessionId);

    const turns = loaded.flatMap((m): import('./replReducer.js').TurnEntry[] => {
      if (m.role === 'user') {
        const text = typeof m.content === 'string'
          ? m.content
          : (m.content as Array<{ type: string; text?: string }>)
              .filter((p) => p.type === 'text')
              .map((p) => p.text ?? '')
              .join('');
        return text ? [{ type: 'user', content: text }] : [];
      }

      if (m.role === 'assistant') {
        const entries: import('./replReducer.js').TurnEntry[] = [];

        // Reconstruct tool call records
        const parts = Array.isArray(m.content) ? m.content as Array<{ type: string; toolName?: string; toolCallId?: string; input?: unknown; args?: unknown }> : [];
        for (const part of parts) {
          if (part.type === 'tool-call') {
            entries.push({
              type: 'toolcall',
              entry: {
                id: part.toolCallId ?? '',
                toolName: (part.toolName ?? 'unknown') as import('../tools/index.js').ToolName,
                description: part.toolName ?? '',
                status: 'done',
              },
            });
          }
        }

        // Extract text content
        const text = typeof m.content === 'string'
          ? m.content
          : parts.filter((p) => p.type === 'text').map((p) => (p as { text?: string }).text ?? '').join('');

        if (text) entries.push({ type: 'assistant', content: text, done: true });
        return entries;
      }

      return [];
    });
    turns.push({ type: 'info', content: `✓ Resumed session ${sessionId.slice(0, 8)} (${loaded.length} messages)` });
    dispatch({ type: 'SET_STATIC_TURNS', turns });
  }, [cwd, context, stream]);

  // ── Input / slash command handler ──────────────────────────────────────

  const handleSubmit = useCallback((input: string) => {
    if (stream.inFlight.current) return;

    const { liveConfig, totalTokens } = stateRef.current;

    const cmdResult = handleSlashCommand(input, {
      config: liveConfig,
      turnCount: stream.turnCount.current,
      version,
      totalTokens,
      availableSkills: context.availableSkillsRef.current,
      sessionId: context.sessionIdRef.current,
      cwd,
      systemPrompt: context.systemPromptRef.current,
      memoryFilePath: context.memoryFilePathRef.current,
      messageHistoryChars: JSON.stringify(stream.messages.current).length,
    } satisfies SessionState);

    if (cmdResult.type === 'exit') { onExit(); return; }
    if (cmdResult.type === 'clear') {
      stream.messages.current = [];
      stream.turnCount.current = 0;
      const newSessionId = createSession(cwd);
      context.sessionIdRef.current = newSessionId;
      clearMediaStore();
      stream.todoStore.current = createTodoStore(cwd, newSessionId);
      dispatch({ type: 'CLEAR' });
      context.loadContext();
      dispatch({ type: 'PUSH_STATIC', entry: { type: 'info', content: '✓ Conversation cleared. Context reloaded.' } });
      return;
    }
    if (cmdResult.type === 'model_picker') {
      dispatch({ type: 'SET_WAITING_FOR_MODEL', value: true });
      return;
    }
    if (cmdResult.type === 'resume_picker') {
      const sessions = listSessions(cwd).filter((s) => s.sessionId !== context.sessionIdRef.current);
      if (sessions.length === 0) {
        dispatch({ type: 'PUSH_STATIC', entry: { type: 'info', content: 'No other saved sessions for this directory.' } });
        return;
      }
      dispatch({ type: 'SET_RESUME_SESSIONS', sessions });
      return;
    }
    if (cmdResult.type === 'model_change') {
      dispatch({ type: 'SET_MODEL', model: cmdResult.model });
      dispatch({ type: 'PUSH_STATIC', entry: { type: 'info', content: `✓ Model: ${cmdResult.model}` } });
      return;
    }
    if (cmdResult.type === 'thinking_toggle') {
      dispatch({ type: 'TOGGLE_THINKING' });
      dispatch({ type: 'PUSH_STATIC', entry: { type: 'info', content: `✓ Thinking mode: ${!liveConfig.thinking ? 'on' : 'off'}` } });
      return;
    }

    if (cmdResult.type === 'compact') {
      void stream.runCompact(liveConfig);
      return;
    }
    if (cmdResult.type === 'memory_picker') {
      dispatch({ type: 'SET_MEMORY_PICKER', value: true });
      return;
    }
    if (cmdResult.type === 'resume') {
      handleResumeSelect(cmdResult.sessionId);
      return;
    }
    if (cmdResult.type === 'handled') {
      if (cmdResult.output) dispatch({ type: 'PUSH_STATIC', entry: { type: 'info', content: cmdResult.output } });
      return;
    }

    stream.inFlight.current = true;
    stream.abortRef.current = false;

    const { cleanText, injected } = resolveMentions(input, cwd);
    if (injected.length > 0) {
      stream.messages.current.push({
        role: 'user',
        content: [
          ...injected.map((f) => ({ type: 'text' as const, text: `<file path="${f.path}">\n${f.content}\n</file>` })),
          { type: 'text' as const, text: cleanText || input },
        ],
      });
    } else {
      stream.messages.current.push({ role: 'user', content: input });
    }
    dispatch({ type: 'PUSH_STATIC', entry: { type: 'user', content: input } });
    stream.turnCount.current++;
    dispatch({ type: 'STREAM_START' });

    void stream.runStream(liveConfig);
  }, [version, onExit, context, stream, handleResumeSelect, cwd]);

  // ── Stable event handlers ──────────────────────────────────────────────

  const handleInterrupt = useCallback(() => {
    if (stream.inFlight.current) {
      stream.abortRef.current = true;
      const { pendingConfirm, pendingQuestion } = stateRef.current;
      if (pendingConfirm) {
        pendingConfirm.resolve(false);
        dispatch({ type: 'SET_PENDING_CONFIRM', pending: null });
      }
      if (pendingQuestion) {
        pendingQuestion.resolve('');
        dispatch({ type: 'SET_PENDING_QUESTION', pending: null });
      }
    } else {
      onExit();
    }
  }, [onExit, stream]);

  const handleAnswer = useCallback((answer: string) => {
    const { pendingQuestion } = stateRef.current;
    if (!pendingQuestion) return;
    pendingQuestion.resolve(answer);
    dispatch({ type: 'SET_PENDING_QUESTION', pending: null });
  }, []);

  const handleModelSelect = useCallback((model: string | null) => {
    dispatch({ type: 'SET_WAITING_FOR_MODEL', value: false });
    if (model) {
      dispatch({ type: 'SET_MODEL', model });
      dispatch({ type: 'PUSH_STATIC', entry: { type: 'info', content: `✓ Model: ${model}` } });
    }
  }, []);

  const handleConfirm = useCallback((approved: boolean) => {
    const { pendingConfirm } = stateRef.current;
    if (!pendingConfirm) return;
    pendingConfirm.resolve(approved);
    dispatch({ type: 'CONFIRM_TOOL', approved });
  }, []);

  const handleMemorySelect = useCallback((filePath: string | null) => {
    dispatch({ type: 'SET_MEMORY_PICKER', value: false });
    if (filePath) {
      onOpenEditor(filePath, {
        messages: stream.messages.current,
        sessionId: context.sessionIdRef.current,
        turnCount: stream.turnCount.current,
        staticTurns: stateRef.current.staticTurns,
        totalTokens: stateRef.current.totalTokens,
      });
    }
  }, [onOpenEditor, stream, context, stateRef]);

  const handlePasteImage = useCallback((): { mediaId: string; byteSize: number } | null => {
    try {
      // Dynamic require to avoid top-level import on non-macOS
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { pasteImageFromClipboard } = require('../libs/clipboard.js') as typeof import('../libs/clipboard.js');
      return pasteImageFromClipboard();
    } catch {
      return null;
    }
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────

  const {
    staticTurns, activeTurn, activeReasoning, streaming,
    activeToolCalls, activeTodos, pendingConfirm, pendingQuestion,
    liveConfig, waitingForModel, availableSkills, resumeSessions, memoryPicker,
  } = state;

  const maskedKey = liveConfig.apiKey
    ? liveConfig.apiKey.slice(0, 6) + '...' + liveConfig.apiKey.slice(-4)
    : '✗';

  const contextPct = estimateContextPct(context.systemPromptRef.current, stream.messages.current);

  const activeTurnEntry =
    activeTurn !== null ? ({ type: 'assistant', content: activeTurn, done: false } as const) : null;

  const isThinking = activeReasoning !== null && activeTurn === '';
  const isWaitingForConfirm = pendingConfirm !== null;
  const isWaitingForQuestion = pendingQuestion !== null;

  return (
    <Box flexDirection="column">
      <StatusBar version={version} model={liveConfig.model} maskedKey={maskedKey} contextPct={contextPct} />

      <MessageList
        staticTurns={staticTurns}
        activeTurn={activeTurnEntry}
        activeReasoning={activeReasoning}
        isThinking={isThinking}
      />

      <TodoListView todos={activeTodos} />

      <ActiveToolCallsView calls={activeToolCalls} onConfirm={handleConfirm} />

      <ConfirmPrompt pending={pendingConfirm} />

      {waitingForModel ? (
        <ModelPicker currentModel={liveConfig.model} onSelect={handleModelSelect} />
      ) : resumeSessions ? (
        <ResumePicker sessions={resumeSessions} onSelect={handleResumeSelect} />
      ) : memoryPicker ? (
        <MemoryPicker memoryFilePath={context.memoryFilePathRef.current} onSelect={handleMemorySelect} />
      ) : isWaitingForQuestion ? (
        <QuestionPrompt
          question={pendingQuestion!.question}
          options={pendingQuestion!.options}
          onAnswer={handleAnswer}
          onInterrupt={handleInterrupt}
        />
      ) : (
        <InputBox
          streaming={streaming}
          waitingForConfirm={isWaitingForConfirm}
          availableSkills={availableSkills}
          cwd={cwd}
          onSubmit={handleSubmit}
          onInterrupt={handleInterrupt}
          onConfirm={isWaitingForConfirm ? handleConfirm : undefined}
          onPasteImage={handlePasteImage}
        />
      )}
    </Box>
  );
}
