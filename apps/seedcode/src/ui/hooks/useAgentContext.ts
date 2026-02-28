import { useRef, useCallback, useEffect } from 'react';
import { buildContext, buildContextWithSkill, type SkillEntry } from '../../context/index.js';
import { createSession } from '../../sessions/index.js';
import type { Action } from '../replReducer.js';

interface UseAgentContextOptions {
  cwd: string;
  dispatch: React.Dispatch<Action>;
}

export interface AgentContext {
  systemPromptRef: React.MutableRefObject<string>;
  availableSkillsRef: React.MutableRefObject<SkillEntry[]>;
  activeSkillsRef: React.MutableRefObject<SkillEntry[]>;
  sessionIdRef: React.MutableRefObject<string>;
  getEffectiveSystemPrompt: () => string;
  loadContext: () => void;
}

export function useAgentContext({ cwd, dispatch }: UseAgentContextOptions): AgentContext {
  const systemPromptRef = useRef<string>('');
  const availableSkillsRef = useRef<SkillEntry[]>([]);
  const activeSkillsRef = useRef<SkillEntry[]>([]);
  const sessionIdRef = useRef<string>(createSession(cwd));

  const loadContext = useCallback(() => {
    const result = buildContext(cwd);
    systemPromptRef.current = result.systemPrompt;
    availableSkillsRef.current = result.skills;
    activeSkillsRef.current = [];
    for (const warning of result.warnings) {
      dispatch({ type: 'PUSH_STATIC', entry: { type: 'info', content: `⚠  ${warning}` } });
    }
  }, [cwd, dispatch]);

  useEffect(() => { loadContext(); }, [loadContext]);

  const getEffectiveSystemPrompt = useCallback((): string => {
    let prompt = systemPromptRef.current;
    for (const skill of activeSkillsRef.current) {
      prompt = buildContextWithSkill(prompt, skill);
    }
    return prompt;
  }, []);

  return { systemPromptRef, availableSkillsRef, activeSkillsRef, sessionIdRef, getEffectiveSystemPrompt, loadContext };
}
