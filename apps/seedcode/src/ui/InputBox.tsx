import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import {
  deleteLeftOfCursor,
  normalizeLineEndings,
  insertAtCursor,
  prevWordBoundary,
  nextWordBoundary,
  getCursorLineCol,
  computeMultilineViewport,
  computeSingleLineViewport,
} from './inputEditing.js';
import { SLASH_COMMANDS } from '../commands/slash.js';
import { searchTrackedFiles } from '../tools/glob.js';

const HISTORY_MAX = 100;

const EMPTY_SKILLS: Array<{ name: string; scope: 'global' | 'project' }> = [];

type Suggestion = { label: string; complete: string; desc: string };

function getSuggestions(
  val: string,
  skills: Array<{ name: string; scope: 'global' | 'project' }>
): Suggestion[] | null {
  if (!val.startsWith('/')) return null;
  const raw = val.slice(1);
  if (raw.includes(' ')) return null;

  const query = raw.toLowerCase();

  const cmdMatches = SLASH_COMMANDS.filter((c) => c.name.startsWith(query));
  const skillMatches = skills.filter((s) => `skills:${s.name}`.startsWith(query));

  const cmdSuggestions: Suggestion[] = cmdMatches.map((c) => ({
    label: `/${c.name}${c.args ? ' ' + c.args : ''}`,
    complete: c.args ? `/${c.name} ` : `/${c.name}`,
    desc: c.desc,
  }));
  const skillSuggestions: Suggestion[] = skillMatches.map((s) => ({
    label: `/skills:${s.name}`,
    complete: `/skills:${s.name} `,
    desc: `skill [${s.scope[0]}]`,
  }));

  const all = [...cmdSuggestions, ...skillSuggestions];
  if (all.length === 0) return null;
  if (all.length === 1 && cmdMatches.length === 1 && cmdMatches[0].name === query && skillMatches.length === 0) return null;
  return all;
}

interface InputBoxProps {
  streaming: boolean;
  waitingForConfirm?: boolean;
  availableSkills?: Array<{ name: string; scope: 'global' | 'project' }>;
  /** Working directory used for @mention file glob suggestions */
  cwd?: string;
  onSubmit: (value: string) => void;
  onInterrupt: () => void;
  onConfirm?: (approved: boolean) => void;
  onPasteImage?: () => { mediaId: string; byteSize: number } | null;
}

export function InputBox({
  streaming,
  waitingForConfirm = false,
  availableSkills = EMPTY_SKILLS,
  cwd,
  onSubmit,
  onInterrupt,
  onConfirm,
  onPasteImage,
}: InputBoxProps) {
  // ── Hooks called unconditionally at the top ─────────────────────────────
  const { stdout } = useStdout();

  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);
  const [suggestionIdx, setSuggestionIdx] = useState(0);
  const [pendingImages, setPendingImages] = useState<Array<{ mediaId: string; byteSize: number; index: number }>>([]);
  const pendingImagesRef = useRef(pendingImages);
  pendingImagesRef.current = pendingImages;
  const imageCounterRef = useRef(0);
  const [imageSelectIdx, setImageSelectIdx] = useState(-1);
  const imageSelectIdxRef = useRef(-1);
  imageSelectIdxRef.current = imageSelectIdx;
  const [fileSuggestions, setFileSuggestions] = useState<Suggestion[] | null>(null);
  const fileSuggestionsRef = useRef<Suggestion[] | null>(null);
  fileSuggestionsRef.current = fileSuggestions;

  const valueRef = useRef(value);
  const cursorRef = useRef(cursor);
  const suggestionIdxRef = useRef(suggestionIdx);
  valueRef.current = value;
  cursorRef.current = cursor;
  suggestionIdxRef.current = suggestionIdx;

  const historyRef = useRef<string[]>([]);
  const historyIdxRef = useRef(-1);
  const draftRef = useRef('');
  const lastHistoryNavRef = useRef(0);

  const slashSuggestions = useMemo(() => getSuggestions(value, availableSkills), [value, availableSkills]);

  const termCols = stdout?.columns ?? 80;
  const viewportWidth = Math.max(10, termCols - 3);

  // Auto-convert pasted image file paths
  useEffect(() => {
    if (!onPasteImage) return;
    const trimmed = value.trim();
    if (!trimmed || trimmed !== value || !trimmed.startsWith('/')) return;
    const dotIdx = trimmed.lastIndexOf('.');
    if (dotIdx < 0) return;
    const ext = trimmed.slice(dotIdx).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)) return;

    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      try {
        const { loadImageFromPath } = require('../libs/clipboard.js') as typeof import('../libs/clipboard.js');
        const result = loadImageFromPath(trimmed);
        if (cancelled || !result) return;
        const index = ++imageCounterRef.current;
        setPendingImages((prev) => [...prev, { ...result, index }]);
        update('', 0);
      } catch {
        // Not a valid image path or module unavailable
      }
    });
    return () => { cancelled = true; };
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  // Async @mention file suggestions
  useEffect(() => {
    if (!cwd) { setFileSuggestions(null); return; }
    const atMatch = /(?:^|\s)@(\S+)$/.exec(value);
    if (!atMatch || atMatch[1].length < 1) {
      setFileSuggestions(null);
      return;
    }
    const prefix = atMatch[1];
    let cancelled = false;
    searchTrackedFiles(prefix, cwd).then((files) => {
      if (cancelled) return;
      const sug = files.map((f) => ({ label: `@${f}`, complete: `@${f}`, desc: 'file' }));
      setFileSuggestions(sug.length > 0 ? sug : null);
    }).catch(() => setFileSuggestions(null));
    return () => { cancelled = true; };
  }, [value, cwd]);

  const suggestions = fileSuggestions ?? slashSuggestions;

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
    setPendingImages([]);
    imageCounterRef.current = 0;
    setImageSelectIdx(-1);
    imageSelectIdxRef.current = -1;
  };

  useInput(
    (rawInput, key) => {
      // Normalize \r\n and \r to \n so the editing model never sees \r.
      // Terminals send \r for Enter and for line breaks in pasted text;
      // multi-char pastes arrive as one string containing raw \r bytes.
      const input = normalizeLineEndings(rawInput);

      const val = valueRef.current;
      const cur = cursorRef.current;
      const sugIdx = suggestionIdxRef.current;

      if (key.ctrl && input === 'c') {
        if (streaming || waitingForConfirm) { onInterrupt(); return; }
        if (val.length > 0) {
          reset();
        } else {
          onInterrupt();
        }
        return;
      }

      if (key.ctrl && input === 'p' && onPasteImage && !streaming && !waitingForConfirm) {
        const result = onPasteImage();
        if (result) {
          const index = ++imageCounterRef.current;
          setPendingImages((prev) => [...prev, { ...result, index }]);
          setImageSelectIdx(-1);
          imageSelectIdxRef.current = -1;
        }
        return;
      }

      // ── Image select mode ──────────────────────────────────────────────
      if (imageSelectIdxRef.current >= 0) {
        const imgs = pendingImagesRef.current;
        const imgIdx = imageSelectIdxRef.current;
        if (key.upArrow) {
          const next = imgIdx <= 0 ? 0 : imgIdx - 1;
          setImageSelectIdx(next);
          imageSelectIdxRef.current = next;
          return;
        }
        if (key.downArrow) {
          if (imgIdx >= imgs.length - 1) {
            setImageSelectIdx(-1);
            imageSelectIdxRef.current = -1;
          } else {
            const next = imgIdx + 1;
            setImageSelectIdx(next);
            imageSelectIdxRef.current = next;
          }
          return;
        }
        if (key.escape) {
          setImageSelectIdx(-1);
          imageSelectIdxRef.current = -1;
          return;
        }
        if (key.backspace || key.delete) {
          const newImgs = imgs.filter((_, i) => i !== imgIdx);
          setPendingImages(newImgs);
          pendingImagesRef.current = newImgs;
          if (newImgs.length === 0) {
            setImageSelectIdx(-1);
            imageSelectIdxRef.current = -1;
          } else {
            const next = Math.min(imgIdx, newImgs.length - 1);
            setImageSelectIdx(next);
            imageSelectIdxRef.current = next;
          }
          return;
        }
        if (!key.ctrl && !key.meta && input) {
          setImageSelectIdx(-1);
          imageSelectIdxRef.current = -1;
          const v = valueRef.current;
          const c = cursorRef.current;
          const inserted = insertAtCursor(v, c, input);
          update(inserted.value, inserted.cursor);
          return;
        }
        return;
      }

      // ── Confirm mode ───────────────────────────────────────────────────
      if (waitingForConfirm && onConfirm) {
        if (input === 'y' || input === 'Y') { onConfirm(true); return; }
        if (input === 'n' || input === 'N' || key.escape) { onConfirm(false); return; }
        return;
      }

      if (streaming) return;

      if (key.escape) {
        setSuggestionIdx(0);
        setFileSuggestions(null);
        return;
      }

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
          // Always just complete into the input — never auto-submit.
          // User can press Enter again (with no suggestions open) to send.
          const replaced = val.replace(/(?:^|\s)@\S+$/, (m) => {
            const leadingSpace = m.startsWith(' ') ? ' ' : '';
            return `${leadingSpace}${sug.complete} `;
          });
          update(replaced, replaced.length);
          setFileSuggestions(null);
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
          const newVal = val.slice(0, -1) + '\n';
          update(newVal, newVal.length);
          return;
        }
        const trimmed = val.trim();
        reset();
        if (trimmed) {
          if (historyRef.current[0] !== trimmed)
            historyRef.current = [trimmed, ...historyRef.current].slice(0, HISTORY_MAX);
          onSubmit(trimmed);
        }
        return;
      }

      const isMultilineVal = val.includes('\n');

      if (!activeSuggestions) {
        if (key.upArrow) {
          if (isMultilineVal) {
            const { lineIdx, col } = getCursorLineCol(val, cur);
            if (lineIdx > 0) {
              const lines = val.split('\n');
              const targetLine = lines[lineIdx - 1];
              const targetCol = Math.min(col, targetLine.length);
              const newPos = lines.slice(0, lineIdx - 1).join('\n').length + (lineIdx - 1 > 0 ? 1 : 0) + targetCol;
              update(val, newPos);
              return;
            }
            return;
          }
          const now = Date.now();
          if (now - lastHistoryNavRef.current < 150) return;
          lastHistoryNavRef.current = now;
          if (historyIdxRef.current === -1 && pendingImagesRef.current.length > 0) {
            const lastIdx = pendingImagesRef.current.length - 1;
            setImageSelectIdx(lastIdx);
            imageSelectIdxRef.current = lastIdx;
            return;
          }
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
          if (isMultilineVal) {
            const { lineIdx, col } = getCursorLineCol(val, cur);
            const lines = val.split('\n');
            if (lineIdx < lines.length - 1) {
              const targetLine = lines[lineIdx + 1];
              const targetCol = Math.min(col, targetLine.length);
              const newPos = lines.slice(0, lineIdx + 1).join('\n').length + 1 + targetCol;
              update(val, newPos);
              return;
            }
            return;
          }
          const now = Date.now();
          if (now - lastHistoryNavRef.current < 150) return;
          lastHistoryNavRef.current = now;
          if (historyIdxRef.current === -1) return;
          const nextIdx = historyIdxRef.current - 1;
          historyIdxRef.current = nextIdx;
          if (nextIdx === -1) { const d = draftRef.current; update(d, d.length); }
          else { const e = historyRef.current[nextIdx]; update(e, e.length); }
          return;
        }
      }

      if (key.leftArrow) {
        if (cur > 0 && val[cur - 1] === '\n') { update(val, cur - 1); }
        else { update(val, Math.max(0, cur - 1)); }
        return;
      }
      if (key.rightArrow) {
        if (cur < val.length && val[cur] === '\n') { update(val, cur + 1); }
        else { update(val, Math.min(val.length, cur + 1)); }
        return;
      }
      if ((key.meta && key.leftArrow) || (key.ctrl && input === 'b')) { update(val, prevWordBoundary(val, cur)); return; }
      if ((key.meta && key.rightArrow) || (key.ctrl && input === 'f')) { update(val, nextWordBoundary(val, cur)); return; }
      if (key.ctrl && input === 'a') {
        const lineStart = val.lastIndexOf('\n', cur - 1) + 1;
        update(val, lineStart);
        return;
      }
      if (key.ctrl && input === 'e') {
        const nextNl = val.indexOf('\n', cur);
        update(val, nextNl === -1 ? val.length : nextNl);
        return;
      }
      if (key.ctrl && input === 'k') {
        const nextNl = val.indexOf('\n', cur);
        if (nextNl === -1) { update(val.slice(0, cur), cur); }
        else { update(val.slice(0, cur) + val.slice(nextNl), cur); }
        return;
      }
      if (key.ctrl && input === 'u') {
        const lineStart = val.lastIndexOf('\n', cur - 1) + 1;
        update(val.slice(0, lineStart) + val.slice(cur), lineStart);
        return;
      }

      if (key.backspace || (key.delete && input === '\x7f')) {
        const next = deleteLeftOfCursor(val, cur); update(next.value, next.cursor);
        return;
      }
      if (key.delete && input === '') {
        const next = deleteLeftOfCursor(val, cur); update(next.value, next.cursor);
        return;
      }

      if (key.ctrl || key.meta) return;

      if (input) {
        if (historyIdxRef.current !== -1) { historyIdxRef.current = -1; draftRef.current = ''; }
        setSuggestionIdx(0);
        const inserted = insertAtCursor(val, cur, input);
        update(inserted.value, inserted.cursor);
      }
    },
    { isActive: true }
  );

  // ── Pre-compute viewport (must run before any early return to satisfy hooks rules) ──
  const isMultiline = value.includes('\n');
  const MAX_VISIBLE_LINES = 10;

  const { visibleLines, totalLines } = useMemo(
    () => computeMultilineViewport(value, cursor, viewportWidth, MAX_VISIBLE_LINES),
    [value, cursor, viewportWidth],
  );

  const singleLineView = useMemo(
    () => isMultiline ? { before: '', atCursor: '', after: '' } : computeSingleLineViewport(value, cursor, viewportWidth),
    [value, cursor, viewportWidth, isMultiline],
  );

  // ── Render ──────────────────────────────────────────────────────────────

  if (waitingForConfirm) {
    return (
      <Box>
        <Text dimColor>  [y/n to confirm · Ctrl+C to cancel]</Text>
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

  const isImageSelectMode = imageSelectIdx >= 0 && pendingImages.length > 0;

  return (
    <Box flexDirection="column">
      {pendingImages.length > 0 && (
        <Box flexDirection="column" marginBottom={0}>
          {pendingImages.map((img, i) => {
            const selected = isImageSelectMode && i === imageSelectIdx;
            const kb = Math.round(img.byteSize / 1024) || '<1';
            return (
              <Box key={img.mediaId} gap={1} paddingLeft={2}>
                {selected
                  ? (
                    <>
                      <Text color="cyan" bold>{'\u203A'}</Text>
                      <Text color="cyan" bold inverse>{` [Image ${img.index}] `}</Text>
                      <Text dimColor>{`${kb} KB`}</Text>
                      <Text dimColor>  Del to remove · ↓/Esc to exit</Text>
                    </>
                  )
                  : (
                    <>
                      <Text dimColor>{'  '}</Text>
                      <Text color="cyan">{`[Image ${img.index}]`}</Text>
                      <Text dimColor>{`${kb} KB`}</Text>
                    </>
                  )
                }
              </Box>
            );
          })}
          {!isImageSelectMode && (
            <Box paddingLeft={2}>
              <Text dimColor>Ctrl+P to paste more · ↑ to select · images will be sent with next message</Text>
            </Box>
          )}
        </Box>
      )}
      {isImageSelectMode
        ? (
          <Box>
            <Text dimColor>{'› '}</Text>
            <Text dimColor>{value || '(type a message)'}</Text>
          </Box>
        )
        : isMultiline
          ? (
            <Box flexDirection="column">
              {totalLines > MAX_VISIBLE_LINES && visibleLines[0]?.origIdx > 0 && (
                <Box marginLeft={2}>
                  <Text dimColor>{`  ↑ ${visibleLines[0].origIdx} more line${visibleLines[0].origIdx > 1 ? 's' : ''}`}</Text>
                </Box>
              )}
              {visibleLines.map((rl, i) => (
                <Box key={i}>
                  <Text color="cyan" bold>{rl.isFirst ? '› ' : '… '}</Text>
                  {rl.hasCursor
                    ? <><Text>{rl.before}</Text><Text inverse>{rl.atCursor}</Text><Text>{rl.after}</Text></>
                    : <Text>{rl.text}</Text>
                  }
                </Box>
              ))}
              {totalLines > MAX_VISIBLE_LINES && (
                <Box marginLeft={2}>
                  <Text dimColor>{`  ${totalLines} lines total · \\ to add newline`}</Text>
                </Box>
              )}
            </Box>
          )
          : (
            <Box>
              <Text color="cyan" bold>{'› '}</Text>
              <Text>{singleLineView.before}</Text>
              <Text inverse>{singleLineView.atCursor}</Text>
              <Text>{singleLineView.after}</Text>
            </Box>
          )
      }
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
