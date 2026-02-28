import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { deleteLeftOfCursor } from './inputEditing';
import { SLASH_COMMANDS, AVAILABLE_MODELS } from '../commands/slash.js';
import { globFiles } from '../tools/glob.js';
import type { SessionEntry } from '../sessions/index.js';

const HISTORY_MAX = 100;

const EMPTY_SKILLS: Array<{ name: string; scope: 'global' | 'project' }> = [];

interface QuestionOption {
  label: string;
  description?: string;
}

interface InputBoxProps {
  streaming: boolean;
  waitingForConfirm?: boolean;
  /** When set, the agent is asking the user a question; value is the question text */
  waitingForQuestion?: string;
  /** Optional recommended options alongside the question */
  questionOptions?: QuestionOption[];
  waitingForModel?: boolean;
  currentModel?: string;
  availableSkills?: Array<{ name: string; scope: 'global' | 'project' }>;
  resumeSessions?: SessionEntry[] | null;
  /** Working directory used for @mention file glob suggestions */
  cwd?: string;
  onSubmit: (value: string) => void;
  onInterrupt: () => void;
  onConfirm?: (approved: boolean) => void;
  /** Called with the user's free-text answer to the agent's question */
  onAnswer?: (answer: string) => void;
  onModelSelect?: (model: string | null) => void;
  onResumeSelect?: (sessionId: string | null) => void;
}

type Suggestion = { label: string; complete: string; desc: string };

function getSuggestions(
  val: string,
  skills: Array<{ name: string; scope: 'global' | 'project' }>
): Suggestion[] | null {
  if (!val.startsWith('/')) return null;
  const raw = val.slice(1);

  if (raw.toLowerCase().startsWith('skills:')) {
    const query = raw.slice('skills:'.length).toLowerCase();
    const matches = skills.filter((s) => s.name.toLowerCase().startsWith(query));
    if (matches.length === 0) return null;
    if (matches.length === 1 && matches[0].name.toLowerCase() === query) return null;
    return matches.map((s) => ({
      label: `/skills:${s.name}`,
      complete: `/skills:${s.name}`,
      desc: `[${s.scope[0]}]`,
    }));
  }

  if (raw.includes(' ')) return null;
  const query = raw.toLowerCase();
  const matches = SLASH_COMMANDS.filter((c) => c.name.startsWith(query));
  if (matches.length === 0 || (matches.length === 1 && matches[0].name === query)) return null;
  return matches.map((c) => ({
    label: `/${c.name}${c.args ? ' ' + c.args : ''}`,
    complete: c.args ? `/${c.name} ` : `/${c.name}`,
    desc: c.desc,
  }));
}

export function InputBox({
  streaming,
  waitingForConfirm = false,
  waitingForQuestion,
  questionOptions,
  waitingForModel = false,
  currentModel,
  availableSkills = EMPTY_SKILLS,
  resumeSessions = null,
  cwd,
  onSubmit,
  onInterrupt,
  onConfirm,
  onAnswer,
  onModelSelect,
  onResumeSelect,
}: InputBoxProps) {
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);
  const [suggestionIdx, setSuggestionIdx] = useState(0);
  const [resumeIdx, setResumeIdx] = useState(0);
  // -1 means "typing freely", 0..N-1 means option highlighted
  const [questionOptIdx, setQuestionOptIdx] = useState(-1);
  // File suggestions from async glob for @mention autocomplete
  const [fileSuggestions, setFileSuggestions] = useState<Suggestion[] | null>(null);
  const fileSuggestionsRef = useRef<Suggestion[] | null>(null);
  fileSuggestionsRef.current = fileSuggestions;
  const [modelIdx, setModelIdx] = useState(() => {
    const idx = AVAILABLE_MODELS.indexOf(currentModel as typeof AVAILABLE_MODELS[number]);
    return idx >= 0 ? idx : 0;
  });

  const valueRef = useRef(value);
  const cursorRef = useRef(cursor);
  const suggestionIdxRef = useRef(suggestionIdx);
  const modelIdxRef = useRef(modelIdx);
  const resumeIdxRef = useRef(resumeIdx);
  const questionOptIdxRef = useRef(questionOptIdx);
  valueRef.current = value;
  cursorRef.current = cursor;
  questionOptIdxRef.current = questionOptIdx;
  suggestionIdxRef.current = suggestionIdx;
  modelIdxRef.current = modelIdx;
  resumeIdxRef.current = resumeIdx;

  const historyRef = useRef<string[]>([]);
  const historyIdxRef = useRef(-1);
  const draftRef = useRef('');
  const pendingLinesRef = useRef<string[]>([]);

  // Computed unconditionally (Rules of Hooks) — used only in the normal input render path.
  const slashSuggestions = useMemo(() => getSuggestions(value, availableSkills), [value, availableSkills]);

  // Async @mention file suggestions — triggered by value changes
  useEffect(() => {
    if (!cwd) { setFileSuggestions(null); return; }
    // Match the last @token at or before the cursor (end of current word)
    const atMatch = /(?:^|\s)@(\S+)$/.exec(value);
    if (!atMatch || atMatch[1].length < 1) {
      setFileSuggestions(null);
      return;
    }
    const prefix = atMatch[1];
    let cancelled = false;
    globFiles(`**/*${prefix}*`, cwd).then(({ files }) => {
      if (cancelled) return;
      const sug = files.slice(0, 8).map((f) => {
        // Show path relative to cwd for readability
        const rel = f.startsWith(cwd + '/') ? f.slice(cwd.length + 1) : f;
        return { label: `@${rel}`, complete: `@${rel}`, desc: 'file' };
      });
      setFileSuggestions(sug.length > 0 ? sug : null);
    }).catch(() => setFileSuggestions(null));
    return () => { cancelled = true; };
  }, [value, cwd]);

  // Combined suggestions: file suggestions take priority over slash suggestions
  const suggestions = fileSuggestions ?? slashSuggestions;

  // Reset resume picker index when session list changes (new picker opened).
  // Derive during render to avoid an extra re-render cycle from useEffect.
  const prevResumeSessionsRef = useRef(resumeSessions);
  if (prevResumeSessionsRef.current !== resumeSessions) {
    prevResumeSessionsRef.current = resumeSessions;
    if (resumeSessions) {
      resumeIdxRef.current = 0;
      // Sync state so the picker renders at index 0 immediately.
      if (resumeIdx !== 0) setResumeIdx(0);
    }
  }

  const update = (newValue: string, newCursor: number) => {
    valueRef.current = newValue;
    cursorRef.current = newCursor;
    setValue(newValue);
    setCursor(newCursor);
  };

  const reset = () => {
    update('', 0);
    historyIdxRef.current = -1;
    draftRef.current = '';
    setSuggestionIdx(0);
  };

  useInput(
    (input, key) => {
      const val = valueRef.current;
      const cur = cursorRef.current;
      const sugIdx = suggestionIdxRef.current;

      if (key.ctrl && input === 'c') {
        if (resumeSessions) { onResumeSelect?.(null); return; }
        if (waitingForModel) { onModelSelect?.(null); return; }
        if (streaming || waitingForConfirm) { onInterrupt(); return; }
        if (val.length > 0 || pendingLinesRef.current.length > 0) {
          pendingLinesRef.current = [];
          reset();
        } else {
          onInterrupt();
        }
        return;
      }

      // ── Resume picker mode ─────────────────────────────────────────────
      if (resumeSessions) {
        const sessions = resumeSessions;
        const idx = resumeIdxRef.current;
        if (key.upArrow) {
          const next = idx <= 0 ? sessions.length - 1 : idx - 1;
          setResumeIdx(next);
          resumeIdxRef.current = next;
          return;
        }
        if (key.downArrow) {
          const next = idx >= sessions.length - 1 ? 0 : idx + 1;
          setResumeIdx(next);
          resumeIdxRef.current = next;
          return;
        }
        if (key.return) { onResumeSelect?.(sessions[idx].sessionId); return; }
        if (key.escape) { onResumeSelect?.(null); return; }
        return;
      }

      // ── Model picker mode ──────────────────────────────────────────────
      if (waitingForModel) {
        const idx = modelIdxRef.current;
        if (key.upArrow) {
          const next = idx <= 0 ? AVAILABLE_MODELS.length - 1 : idx - 1;
          setModelIdx(next);
          modelIdxRef.current = next;
          return;
        }
        if (key.downArrow) {
          const next = idx >= AVAILABLE_MODELS.length - 1 ? 0 : idx + 1;
          setModelIdx(next);
          modelIdxRef.current = next;
          return;
        }
        if (key.return) { onModelSelect?.(AVAILABLE_MODELS[idx]); return; }
        if (key.escape) { onModelSelect?.(null); return; }
        return;
      }

      // ── Confirm mode ───────────────────────────────────────────────────
      if (waitingForConfirm && onConfirm) {
        if (input === 'y' || input === 'Y') { onConfirm(true); return; }
        if (input === 'n' || input === 'N' || key.escape) { onConfirm(false); return; }
        return;
      }

      // ── Question mode (free-text answer or option pick) ────────────────
      if (waitingForQuestion && onAnswer) {
        const opts = questionOptions ?? [];
        const optIdx = questionOptIdxRef.current;

        if (key.upArrow && opts.length > 0) {
          const next = optIdx <= 0 ? opts.length - 1 : optIdx - 1;
          setQuestionOptIdx(next);
          questionOptIdxRef.current = next;
          return;
        }
        if (key.downArrow && opts.length > 0) {
          const next = optIdx >= opts.length - 1 ? 0 : optIdx + 1;
          setQuestionOptIdx(next);
          questionOptIdxRef.current = next;
          return;
        }
        if (key.return) {
          if (optIdx >= 0 && opts[optIdx]) {
            const answer = opts[optIdx].label;
            reset();
            setQuestionOptIdx(-1);
            onAnswer(answer);
          } else {
            const answer = val.trim();
            reset();
            setQuestionOptIdx(-1);
            onAnswer(answer);
          }
          return;
        }
        if (key.escape) { reset(); setQuestionOptIdx(-1); onAnswer(''); return; }
        // Any character typed clears option selection and enters free-text mode
        if (key.backspace || (key.delete && input === '\x7f')) {
          if (optIdx >= 0) { setQuestionOptIdx(-1); questionOptIdxRef.current = -1; return; }
          const next = deleteLeftOfCursor(val, cur); update(next.value, next.cursor); return;
        }
        if (key.leftArrow) { setQuestionOptIdx(-1); update(val, Math.max(0, cur - 1)); return; }
        if (key.rightArrow) { setQuestionOptIdx(-1); update(val, Math.min(val.length, cur + 1)); return; }
        if (!key.ctrl && !key.meta && input) {
          if (optIdx >= 0) setQuestionOptIdx(-1);
          update(val.slice(0, cur) + input + val.slice(cur), cur + input.length);
        }
        return;
      }

      if (streaming) return;

      if (key.escape) {
        setSuggestionIdx(0);
        setFileSuggestions(null);
        return;
      }

      // fileSuggestionsRef gives sync access to the async file-suggestion state.
      // File suggestions take priority over slash suggestions.
      const activeSuggestions = fileSuggestionsRef.current ?? getSuggestions(val, availableSkills);
      const isFileSuggestion = fileSuggestionsRef.current !== null;

      if (activeSuggestions && (key.upArrow || key.downArrow)) {
        const len = activeSuggestions.length;
        setSuggestionIdx(key.upArrow
          ? (sugIdx <= 0 ? len - 1 : sugIdx - 1)
          : (sugIdx >= len - 1 ? 0 : sugIdx + 1));
        return;
      }

      if (activeSuggestions && (input === '\t' || key.return)) {
        const sug = activeSuggestions[sugIdx] ?? activeSuggestions[0];
        setSuggestionIdx(0);

        if (isFileSuggestion) {
          // Replace the trailing @prefix token with the selected @fullpath
          const replaced = val.replace(/(?:^|\s)@\S+$/, (m) => {
            const leadingSpace = m.startsWith(' ') ? ' ' : '';
            return `${leadingSpace}${sug.complete}`;
          });
          update(replaced, replaced.length);
          setFileSuggestions(null);
          if (key.return) {
            const trimmed = replaced.trim();
            reset();
            if (trimmed) {
              if (historyRef.current[0] !== trimmed)
                historyRef.current = [trimmed, ...historyRef.current].slice(0, HISTORY_MAX);
              onSubmit(trimmed);
            }
          }
        } else {
          update(sug.complete, sug.complete.length);
          if (key.return && !sug.complete.endsWith(' ')) {
            const trimmed = sug.complete.trim();
            reset();
            if (historyRef.current[0] !== trimmed)
              historyRef.current = [trimmed, ...historyRef.current].slice(0, HISTORY_MAX);
            onSubmit(trimmed);
          }
        }
        return;
      }

      if (key.return) {
        if (val.endsWith('\\')) {
          pendingLinesRef.current = [...pendingLinesRef.current, val.slice(0, -1)];
          update('', 0);
          return;
        }
        const trimmed = [...pendingLinesRef.current, val].join('\n').trim();
        pendingLinesRef.current = [];
        reset();
        if (trimmed) {
          if (historyRef.current[0] !== trimmed)
            historyRef.current = [trimmed, ...historyRef.current].slice(0, HISTORY_MAX);
          onSubmit(trimmed);
        }
        return;
      }

      if (!activeSuggestions && pendingLinesRef.current.length === 0) {
        if (key.upArrow) {
          const history = historyRef.current;
          if (history.length === 0) return;
          if (historyIdxRef.current === -1) draftRef.current = val;
          const nextIdx = Math.min(historyIdxRef.current + 1, history.length - 1);
          historyIdxRef.current = nextIdx;
          const entry = history[nextIdx];
          update(entry, entry.length);
          return;
        }
        if (key.downArrow) {
          if (historyIdxRef.current === -1) return;
          const nextIdx = historyIdxRef.current - 1;
          historyIdxRef.current = nextIdx;
          if (nextIdx === -1) { const d = draftRef.current; update(d, d.length); }
          else { const e = historyRef.current[nextIdx]; update(e, e.length); }
          return;
        }
      }

      if (key.leftArrow) { update(val, Math.max(0, cur - 1)); return; }
      if (key.rightArrow) { update(val, Math.min(val.length, cur + 1)); return; }
      if ((key.meta && key.leftArrow) || (key.ctrl && input === 'b')) { update(val, prevWordBoundary(val, cur)); return; }
      if ((key.meta && key.rightArrow) || (key.ctrl && input === 'f')) { update(val, nextWordBoundary(val, cur)); return; }
      if (key.ctrl && input === 'a') { update(val, 0); return; }
      if (key.ctrl && input === 'e') { update(val, val.length); return; }
      if (key.ctrl && input === 'k') { update(val.slice(0, cur), cur); return; }
      if (key.ctrl && input === 'u') { update(val.slice(cur), 0); return; }

      if (key.backspace || (key.delete && input === '\x7f')) {
        const next = deleteLeftOfCursor(val, cur); update(next.value, next.cursor); return;
      }
      if (key.delete && input === '') {
        const next = deleteLeftOfCursor(val, cur); update(next.value, next.cursor); return;
      }

      if (key.ctrl || key.meta) return;

      if (input) {
        if (historyIdxRef.current !== -1) { historyIdxRef.current = -1; draftRef.current = ''; }
        setSuggestionIdx(0);
        update(val.slice(0, cur) + input + val.slice(cur), cur + input.length);
      }
    },
    { isActive: true }
  );

  // ── Resume picker UI ─────────────────────────────────────────────────────
  if (resumeSessions) {
    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text dimColor>  Resume session  </Text>
          <Text dimColor>↑↓ move · Enter confirm · Esc cancel</Text>
        </Box>
        {resumeSessions.map((s, i) => {
          const selected = i === resumeIdx;
          const date = new Date(s.modified).toLocaleString(undefined, {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
          });
          const preview = s.firstPrompt.length > 50
            ? s.firstPrompt.slice(0, 50) + '…'
            : s.firstPrompt;
          const label = `${s.sessionId.slice(0, 8)}  ${date}  (${s.messageCount} msgs)${s.gitBranch ? `  [${s.gitBranch}]` : ''}`;
          return (
            <Box key={s.sessionId} flexDirection="column" marginLeft={2}>
              {selected
                ? <Text bold color="cyan" inverse>{` ${label} `}</Text>
                : <Text>{label}</Text>
              }
              {preview && (
                <Box marginLeft={selected ? 1 : 0}>
                  <Text dimColor>{`  ${preview}`}</Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
    );
  }

  // ── Model picker UI ──────────────────────────────────────────────────────
  if (waitingForModel) {
    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text dimColor>  Select model  </Text>
          <Text dimColor>↑↓ move · Enter confirm · Esc cancel</Text>
        </Box>
        {AVAILABLE_MODELS.map((m, i) => {
          const selected = i === modelIdx;
          const isCurrent = m === currentModel;
          return (
            <Box key={m} marginLeft={2}>
              {selected
                ? <Text bold color="cyan" inverse>{` ${m} `}</Text>
                : <Text color={isCurrent ? 'cyan' : undefined}>{m}</Text>
              }
              {isCurrent && !selected && <Text dimColor>  current</Text>}
            </Box>
          );
        })}
      </Box>
    );
  }

  if (waitingForConfirm) {
    return (
      <Box>
        <Text dimColor>  [y/n to confirm · Ctrl+C to cancel]</Text>
      </Box>
    );
  }

  if (waitingForQuestion) {
    const opts = questionOptions ?? [];
    const hasOptions = opts.length > 0;
    const optIdx = questionOptIdx;
    const isFreeTyping = !hasOptions || optIdx < 0;
    const before = value.slice(0, cursor);
    const atCursor = value[cursor] ?? ' ';
    const after = value.slice(cursor + 1);
    return (
      <Box flexDirection="column" marginTop={1}>
        {/* Question header */}
        <Box gap={1}>
          <Text backgroundColor="cyan" color="black" bold>{' ? '}</Text>
          <Text bold color="cyan">{waitingForQuestion}</Text>
        </Box>

        {/* Option list */}
        {hasOptions && (
          <Box flexDirection="column" marginTop={1} marginLeft={2}>
            {opts.map((opt, i) => {
              const selected = i === optIdx;
              return (
                <Box key={i} flexDirection="column">
                  {selected
                    ? (
                      <Box gap={1}>
                        <Text color="cyan" bold>{'›'}</Text>
                        <Text bold color="cyan" inverse>{` ${opt.label} `}</Text>
                      </Box>
                    )
                    : (
                      <Box gap={1}>
                        <Text dimColor>{'·'}</Text>
                        <Text>{opt.label}</Text>
                      </Box>
                    )
                  }
                  {opt.description && (
                    <Box marginLeft={3}>
                      <Text dimColor>{opt.description}</Text>
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>
        )}

        {/* Free-text input row */}
        <Box marginTop={1}>
          <Text color="cyan" bold>{'› '}</Text>
          {isFreeTyping
            ? (
              <>
                <Text>{before}</Text>
                <Text inverse>{atCursor}</Text>
                <Text>{after}</Text>
              </>
            )
            : <Text dimColor>or type a custom answer…</Text>
          }
        </Box>
        <Box>
          <Text dimColor>
            {hasOptions
              ? '  ↑↓ pick option · Enter confirm · or type to answer freely · Esc skip'
              : '  Enter to answer · Esc to skip · Ctrl+C to cancel'
            }
          </Text>
        </Box>
      </Box>
    );
  }

  if (streaming) {
    return (
      <Box>
        <Text dimColor>  [Ctrl+C to interrupt]</Text>
      </Box>
    );
  }

  const before = value.slice(0, cursor);
  const atCursor = value[cursor] ?? ' ';
  const after = value.slice(cursor + 1);
  const isMultiline = pendingLinesRef.current.length > 0;

  return (
    <Box flexDirection="column">
      {isMultiline && (
        <Box flexDirection="column">
          {pendingLinesRef.current.map((line, i) => (
            <Box key={`pending-${i}`}>
              <Text dimColor>{'  '}</Text>
              <Text dimColor>{line}</Text>
            </Box>
          ))}
        </Box>
      )}
      <Box>
        <Text color="cyan" bold>{isMultiline ? '… ' : '› '}</Text>
        <Text>{before}</Text>
        <Text inverse>{atCursor}</Text>
        <Text>{after}</Text>
      </Box>
      {suggestions && (
        <Box flexDirection="column" marginLeft={2}>
          {suggestions.map((s, i) => {
            const selected = i === suggestionIdx;
            return (
              <Box key={s.complete}>
                {selected
                  ? <Text bold color="cyan" inverse>{` ${s.label} `}</Text>
                  : <Text color="cyan">{s.label}</Text>
                }
                {!selected && <Text dimColor>{`  ${s.desc}`}</Text>}
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

function prevWordBoundary(value: string, pos: number): number {
  let i = pos - 1;
  while (i > 0 && value[i] === ' ') i--;
  while (i > 0 && value[i - 1] !== ' ') i--;
  return Math.max(0, i);
}

function nextWordBoundary(value: string, pos: number): number {
  let i = pos;
  while (i < value.length && value[i] !== ' ') i++;
  while (i < value.length && value[i] === ' ') i++;
  return Math.min(value.length, i);
}
