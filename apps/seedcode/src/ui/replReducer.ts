import { PLAN_PRESETS, type Plan } from '../config/schema.js';
import type { Config } from '../config/schema.js';
import type { PendingConfirm, PendingQuestion } from '../tools/index.js';
import type { TaskItem } from '../tools/task.js';
import type { ToolCallEntry } from './ToolCallView.js';
import type { SessionEntry } from '../sessions/index.js';
import type { SkillEntry } from '../context/index.js';
import type { McpServerStatus } from '../mcp/manager.js';

export type TurnEntry =
  | { type: 'user'; content: string }
  | { type: 'assistant'; content: string; done: boolean; reasoning?: string }
  | { type: 'error'; content: string }
  | { type: 'info'; content: string }
  | { type: 'toolcall'; entry: ToolCallEntry };

export interface AppState {
  staticTurns: TurnEntry[];
  activeTurn: string | null;
  activeReasoning: string | null;
  streaming: boolean;
  activeToolCalls: ToolCallEntry[];
  activeTasks: TaskItem[];
  pendingConfirm: PendingConfirm | null;
  pendingQuestion: PendingQuestion | null;
  liveConfig: Config;
  totalTokens: number;
  waitingForModel: boolean;
  availableSkills: SkillEntry[];
  resumeSessions: SessionEntry[] | null;
  memoryPicker: boolean;
  mcpPicker: boolean;
  mcpServers: McpServerStatus[];
  /** Current tool step number (1-based) during streaming, null when idle */
  currentStep: number | null;
}

export type Action =
  | { type: 'PUSH_STATIC'; entry: TurnEntry }
  | { type: 'SET_STATIC_TURNS'; turns: TurnEntry[] }
  | { type: 'STREAM_START' }
  | { type: 'STREAM_TICK'; text: string }
  | { type: 'REASONING_TICK'; text: string }
  | { type: 'STEP_FINISH' }
  | { type: 'STREAM_END' }
  | { type: 'STREAM_ERROR'; content: string }
  | { type: 'PUSH_ACTIVE_TOOL_CALL'; entry: ToolCallEntry }
  | { type: 'FLUSH_TOOL_CALLS' }
  | { type: 'CONFIRM_TOOL'; approved: boolean }
  | { type: 'SET_PENDING_CONFIRM'; pending: PendingConfirm | null }
  | { type: 'SET_PENDING_QUESTION'; pending: PendingQuestion | null }
  | { type: 'SET_ACTIVE_TASKS'; tasks: TaskItem[] }
  | { type: 'SET_MODEL'; model: string }
  | { type: 'SET_PLAN'; plan: Plan }
  | { type: 'TOGGLE_THINKING' }
  | { type: 'ADD_TOKENS'; count: number }
  | { type: 'SET_TOTAL_TOKENS'; count: number }
  | { type: 'SET_WAITING_FOR_MODEL'; value: boolean }
  | { type: 'SET_AVAILABLE_SKILLS'; skills: SkillEntry[] }
  | { type: 'SET_RESUME_SESSIONS'; sessions: SessionEntry[] | null }
  | { type: 'SET_MEMORY_PICKER'; value: boolean }
  | { type: 'SET_MCP_PICKER'; value: boolean }
  | { type: 'SET_MCP_SERVERS'; servers: McpServerStatus[] }
  | { type: 'SET_STEP'; step: number }
  | { type: 'UPDATE_TOOL_CALL_PROGRESS'; toolName: string; progress: string }
  | { type: 'CLEAR' };

export function replReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'PUSH_STATIC':
      return { ...state, staticTurns: [...state.staticTurns, action.entry] };

    case 'SET_STATIC_TURNS':
      return { ...state, staticTurns: action.turns };

    case 'STREAM_START':
      return { ...state, streaming: true, activeTurn: '', activeToolCalls: [], activeTasks: [], currentStep: null };

    case 'STREAM_TICK':
      return { ...state, activeTurn: action.text };

    case 'REASONING_TICK':
      return { ...state, activeReasoning: action.text || null };

    case 'STEP_FINISH':
      return { ...state, activeTurn: '', activeReasoning: null, activeToolCalls: [] };

    case 'STREAM_END':
      return {
        ...state,
        streaming: false,
        activeTurn: null,
        activeReasoning: null,
        activeToolCalls: [],
        pendingConfirm: null,
        pendingQuestion: null,
        currentStep: null,
      };

    case 'STREAM_ERROR':
      return {
        ...state,
        streaming: false,
        activeTurn: null,
        activeReasoning: null,
        activeToolCalls: [],
        activeTasks: [],
        pendingConfirm: null,
        pendingQuestion: null,
        currentStep: null,
        staticTurns: [...state.staticTurns, { type: 'error', content: action.content }],
      };

    case 'PUSH_ACTIVE_TOOL_CALL':
      return { ...state, activeToolCalls: [...state.activeToolCalls, action.entry] };

    case 'FLUSH_TOOL_CALLS':
      return { ...state, activeToolCalls: [] };

    case 'CONFIRM_TOOL': {
      const { approved } = action;
      return {
        ...state,
        pendingConfirm: null,
        activeToolCalls: state.activeToolCalls.map((tc) =>
          tc.status === 'pending'
            ? { ...tc, status: approved ? ('running' as const) : ('denied' as const) }
            : tc
        ),
      };
    }

    case 'SET_PENDING_CONFIRM':
      return { ...state, pendingConfirm: action.pending };

    case 'SET_PENDING_QUESTION':
      return { ...state, pendingQuestion: action.pending };

    case 'SET_ACTIVE_TASKS':
      return { ...state, activeTasks: action.tasks };

    case 'SET_MODEL':
      return { ...state, liveConfig: { ...state.liveConfig, model: action.model } };

    case 'SET_PLAN': {
      const preset = PLAN_PRESETS[action.plan];
      return { ...state, liveConfig: { ...state.liveConfig, plan: action.plan, model: preset.model } };
    }

    case 'TOGGLE_THINKING':
      return { ...state, liveConfig: { ...state.liveConfig, thinking: !state.liveConfig.thinking } };

    case 'ADD_TOKENS':
      return { ...state, totalTokens: state.totalTokens + action.count };

    case 'SET_TOTAL_TOKENS':
      return { ...state, totalTokens: action.count };

    case 'SET_WAITING_FOR_MODEL':
      return { ...state, waitingForModel: action.value };

    case 'SET_AVAILABLE_SKILLS':
      return { ...state, availableSkills: action.skills };

    case 'SET_RESUME_SESSIONS':
      return { ...state, resumeSessions: action.sessions };

    case 'SET_MEMORY_PICKER':
      return { ...state, memoryPicker: action.value };

    case 'SET_MCP_PICKER':
      return { ...state, mcpPicker: action.value };

    case 'SET_MCP_SERVERS':
      return { ...state, mcpServers: action.servers };

    case 'SET_STEP':
      return { ...state, currentStep: action.step };

    case 'UPDATE_TOOL_CALL_PROGRESS': {
      // Update progress on the first matching running tool call
      let found = false;
      const updated = state.activeToolCalls.map((tc) => {
        if (!found && tc.toolName === action.toolName && tc.status === 'running') {
          found = true;
          return { ...tc, progress: action.progress };
        }
        return tc;
      });
      return found ? { ...state, activeToolCalls: updated } : state;
    }

    case 'CLEAR':
      return {
        ...state,
        staticTurns: [],
        activeTurn: null,
        activeReasoning: null,
        streaming: false,
        activeToolCalls: [],
        activeTasks: [],
        pendingConfirm: null,
        pendingQuestion: null,
        totalTokens: 0,
        currentStep: null,
      };
  }
}
