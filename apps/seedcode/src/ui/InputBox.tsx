import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import {
  deleteLeftOfCursor,
  normalizeLineEndings,
  insertAtCursor,
  isPaste,
  prevWordBoundary,
  nextWordBoundary,
  getCursorLineCol,
  computeMultilineViewport,
  computeSingleLineViewport,
  makePasteMarker,
  expandPasteMarkers,
  replaceMarkersForDisplay,
  mapCursorToDisplay,
  cursorSkipMarker,
  PASTE_MARKER_RE,
} from './inputEditing.js';
import { SLASH_COMMANDS } from '../commands/slash.js';
import { searchTrackedFiles } from '../tools/glob.js';

const HISTORY_MAX = 100;
const PASTE_LINE_THRESHOLD = 3; // pastes with >3 newlines (4+ lines) get collapsed
const PASTE_COALESCE_MS = 16;   // time window to coalesce chunked terminal paste

interface PastedBlock {
  id: number;
  content: string;
  lineCount: number;
}

/**
 * Pending paste accumulator — collects rapid-fire useInput chunks that
 * belong to a single terminal paste operation.  After PASTE_COALESCE_MS
 * of silence the accumulated text is evaluated: if it exceeds the line
 * threshold it gets collapsed into a marker; otherwise it stays inline.
 */
interface PendingPaste {
  insertStart: number; // cursor position *before* the first chunk was inserted
  totalLen: number;    // total characters inserted so far
  timer: ReturnType<typeof setTimeout>;
}

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
  onSubmit: (value: string, displayValue?: string) => void;
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
  const [pastedBlocks, setPastedBlocks] = useState<PastedBlock[]>([]);
  const pastedBlocksRef = useRef(pastedBlocks);
  pastedBlocksRef.current = pastedBlocks;
  const pasteCounterRef = useRef(0);
  const pendingPasteRef = useRef<PendingPaste | null>(null);
  // Render-visible snapshot of pendingPaste so viewport can suppress pending region
  const [pendingPasteSnap, setPendingPasteSnap] = useState<{ insertStart: number; totalLen: number } | null>(null);

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

  // Cleanup pending paste timer on unmount
  useEffect(() => () => {
    if (pendingPasteRef.current) clearTimeout(pendingPasteRef.current.timer);
  }, []);

  const slashSuggestions = useMemo(() => getSuggestions(value, availableSkills), [value, availableSkills]);

  const termCols = stdout?.columns ?? 80;
  // Account for border (2) + paddingLeft (1) + paddingRight (1) + prompt "› " (2)
  const viewportWidth = Math.max(10, termCols - 6);

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

  /**
   * Called when the paste coalesce timer fires — checks if the accumulated
   * paste text is long enough to collapse into a marker.
   */
  const finalizePaste = () => {
    const pp = pendingPasteRef.current;
    if (!pp) return;
    pendingPasteRef.current = null;
    setPendingPasteSnap(null);

    const val = valueRef.current;
    const cur = cursorRef.current;
    const pastedText = val.slice(pp.insertStart, pp.insertStart + pp.totalLen);
    const nlCount = (pastedText.match(/\n/g) ?? []).length;

    if (nlCount > PASTE_LINE_THRESHOLD) {
      const id = ++pasteCounterRef.current;
      const lineCount = nlCount + 1;
      const block: PastedBlock = { id, content: pastedText, lineCount };
      setPastedBlocks((prev) => [...prev, block]);
      pastedBlocksRef.current = [...pastedBlocksRef.current, block];

      const marker = makePasteMarker(id);
      const newVal = val.slice(0, pp.insertStart) + marker + val.slice(pp.insertStart + pp.totalLen);
      // Adjust cursor: if cursor was within or after the pasted region, remap
      let newCur: number;
      if (cur >= pp.insertStart + pp.totalLen) {
        newCur = cur - pp.totalLen + marker.length;
      } else if (cur > pp.insertStart) {
        newCur = pp.insertStart + marker.length;
      } else {
        newCur = cur;
      }
      update(newVal, newCur);
    }
    // If not long enough, text stays inline as-is — nothing to do.
  };

  const reset = () => {
    if (pendingPasteRef.current) {
      clearTimeout(pendingPasteRef.current.timer);
      pendingPasteRef.current = null;
    }
    setPendingPasteSnap(null);
    update('', 0);
    historyIdxRef.current = -1;
    draftRef.current = '';
    setSuggestionIdx(0);
    setPendingImages([]);
    imageCounterRef.current = 0;
    setImageSelectIdx(-1);
    imageSelectIdxRef.current = -1;
    setPastedBlocks([]);
    pastedBlocksRef.current = [];
    pasteCounterRef.current = 0;
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

        // Flush any pending paste coalesce before submit
        let submitSrc = val;
        let allBlocks = [...pastedBlocksRef.current];
        const pp = pendingPasteRef.current;
        if (pp) {
          clearTimeout(pp.timer);
          pendingPasteRef.current = null;
          const pastedText = val.slice(pp.insertStart, pp.insertStart + pp.totalLen);
          const nlCount = (pastedText.match(/\n/g) ?? []).length;
          if (nlCount > PASTE_LINE_THRESHOLD) {
            const id = ++pasteCounterRef.current;
            const lineCount = nlCount + 1;
            allBlocks.push({ id, content: pastedText, lineCount });
            const marker = makePasteMarker(id);
            submitSrc = val.slice(0, pp.insertStart) + marker + val.slice(pp.insertStart + pp.totalLen);
          }
        }

        // Expand paste markers to full content before submitting
        let submitVal = submitSrc;
        if (allBlocks.length > 0) {
          const blocksMap = new Map(allBlocks.map((b) => [b.id, b.content]));
          submitVal = expandPasteMarkers(submitSrc, blocksMap);
        }
        const trimmed = submitVal.trim();
        // Build display version with placeholders for PUSH_STATIC
        const displayBlocksMap = new Map(allBlocks.map((b) => [b.id, { lineCount: b.lineCount }]));
        const displayVal = allBlocks.length > 0 ? replaceMarkersForDisplay(submitSrc, displayBlocksMap).trim() : trimmed;
        reset();
        if (trimmed) {
          if (historyRef.current[0] !== trimmed)
            historyRef.current = [trimmed, ...historyRef.current].slice(0, HISTORY_MAX);
          onSubmit(trimmed, displayVal !== trimmed ? displayVal : undefined);
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
        let newCur = cur > 0 && val[cur - 1] === '\n' ? cur - 1 : Math.max(0, cur - 1);
        newCur = cursorSkipMarker(val, newCur, 'left');
        update(val, newCur);
        return;
      }
      if (key.rightArrow) {
        let newCur = cur < val.length && val[cur] === '\n' ? cur + 1 : Math.min(val.length, cur + 1);
        newCur = cursorSkipMarker(val, newCur, 'right');
        update(val, newCur);
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
        const next = deleteLeftOfCursor(val, cur);
        if (next.deletedMarkerId != null) {
          setPastedBlocks((prev) => prev.filter((b) => b.id !== next.deletedMarkerId));
          pastedBlocksRef.current = pastedBlocksRef.current.filter((b) => b.id !== next.deletedMarkerId);
        }
        update(next.value, next.cursor);
        return;
      }
      if (key.delete && input === '') {
        // Some terminals report Backspace as key.delete + empty input
        // (not key.backspace), so this must also delete LEFT, not right.
        const next = deleteLeftOfCursor(val, cur);
        if (next.deletedMarkerId != null) {
          setPastedBlocks((prev) => prev.filter((b) => b.id !== next.deletedMarkerId));
          pastedBlocksRef.current = pastedBlocksRef.current.filter((b) => b.id !== next.deletedMarkerId);
        }
        update(next.value, next.cursor);
        return;
      }

      if (key.ctrl || key.meta) return;

      if (input) {
        if (historyIdxRef.current !== -1) { historyIdxRef.current = -1; draftRef.current = ''; }
        setSuggestionIdx(0);

        // Always insert text immediately for responsive feel
        const inserted = insertAtCursor(val, cur, input);
        update(inserted.value, inserted.cursor);

        // Accumulate paste chunks — terminal may split a single paste across
        // multiple useInput calls delivered within a few milliseconds.
        if (isPaste(input)) {
          const pp = pendingPasteRef.current;
          if (pp) {
            // Extend existing pending paste
            clearTimeout(pp.timer);
            pp.totalLen += input.length;
            pp.timer = setTimeout(finalizePaste, PASTE_COALESCE_MS);
          } else {
            // Start new pending paste
            pendingPasteRef.current = {
              insertStart: cur,
              totalLen: input.length,
              timer: setTimeout(finalizePaste, PASTE_COALESCE_MS),
            };
          }
          // Update render-visible snapshot so viewport can hide the pending region
          const snap = pendingPasteRef.current!;
          setPendingPasteSnap({ insertStart: snap.insertStart, totalLen: snap.totalLen });
        }
      }
    },
    { isActive: true }
  );

  // ── Pre-compute viewport (must run before any early return to satisfy hooks rules) ──

  // Build display-info map for paste blocks (finalized)
  const pasteDisplayMap = useMemo(() => {
    if (pastedBlocks.length === 0) return undefined;
    return new Map(pastedBlocks.map((b) => [b.id, { lineCount: b.lineCount }]));
  }, [pastedBlocks]);

  // Build a display-ready value with all markers (finalized + pending)
  // replaced by human-readable text, and cursor mapped to display coordinates.
  // This ensures viewport rendering and cursor position are always in sync.
  const { displayValue, displayCursor } = useMemo(() => {
    let dv = value;
    let dc = cursor;

    // 1) Replace pending paste region with temporary placeholder
    if (pendingPasteSnap) {
      const { insertStart, totalLen } = pendingPasteSnap;
      const pastedText = dv.slice(insertStart, insertStart + totalLen);
      const nlCount = (pastedText.match(/\n/g) ?? []).length;
      if (nlCount > PASTE_LINE_THRESHOLD) {
        const placeholder = `[Pasting… +${nlCount + 1} lines]`;
        dv = dv.slice(0, insertStart) + placeholder + dv.slice(insertStart + totalLen);
        if (dc >= insertStart + totalLen) {
          dc = dc - totalLen + placeholder.length;
        } else if (dc > insertStart) {
          dc = insertStart + placeholder.length;
        }
      }
    }

    // 2) Replace finalized paste markers with display text
    if (pasteDisplayMap && pasteDisplayMap.size > 0) {
      dc = mapCursorToDisplay(dv, dc, pasteDisplayMap);
      dv = replaceMarkersForDisplay(dv, pasteDisplayMap);
    }

    return { displayValue: dv, displayCursor: dc };
  }, [value, cursor, pendingPasteSnap, pasteDisplayMap]);

  const isMultiline = displayValue.includes('\n');
  const MAX_VISIBLE_LINES = 10;

  const { visibleLines, totalLines } = useMemo(
    () => computeMultilineViewport(displayValue, displayCursor, viewportWidth, MAX_VISIBLE_LINES),
    [displayValue, displayCursor, viewportWidth],
  );

  const singleLineView = useMemo(
    () => isMultiline ? { before: '', atCursor: '', after: '' } : computeSingleLineViewport(displayValue, displayCursor, viewportWidth),
    [displayValue, displayCursor, viewportWidth, isMultiline],
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
      <Box borderStyle="round" borderColor="gray" paddingLeft={1} paddingRight={1}>
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
                  <Box>
                    <Text dimColor>{`  ↑ ${visibleLines[0].origIdx} more line${visibleLines[0].origIdx > 1 ? 's' : ''}`}</Text>
                  </Box>
                )}
                {visibleLines.map((rl, i) => {
                  const isPasteDisplay = /^\[Pasted text #\d+ \+\d+ lines\]$/.test(rl.text) || /^\[Pasting… \+\d+ lines\]$/.test(rl.text);
                  return (
                    <Box key={i}>
                      <Text color="cyan" bold>{rl.isFirst ? '› ' : '… '}</Text>
                      {rl.hasCursor
                        ? <><Text>{rl.before}</Text><Text inverse>{rl.atCursor}</Text><Text>{rl.after}</Text></>
                        : isPasteDisplay
                          ? <Text dimColor>{rl.text}</Text>
                          : <Text>{rl.text}</Text>
                      }
                    </Box>
                  );
                })}
                {totalLines > MAX_VISIBLE_LINES && (
                  <Box>
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
