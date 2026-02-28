export interface InputEditState {
  value: string;
  cursor: number;
}

/**
 * Delete the character immediately left of the cursor block.
 * The cursor block can sit on a character or at end-of-line blank space.
 */
export function deleteLeftOfCursor(value: string, cursor: number): InputEditState {
  if (cursor <= 0) {
    return { value, cursor: 0 };
  }

  return {
    value: value.slice(0, cursor - 1) + value.slice(cursor),
    cursor: cursor - 1,
  };
}

/**
 * Normalize line endings in raw terminal input.
 *
 * Terminals use inconsistent line-break bytes depending on platform, terminal
 * emulator, and whether the text was typed or pasted:
 *   - Enter key (raw mode): `\r` (0x0D)
 *   - macOS paste: `\r` per line
 *   - Windows paste: `\r\n` per line
 *   - Unix pipe / some terminals: `\n` (0x0A)
 *
 * Our internal model uses `\n` exclusively. This function converts all
 * variants to `\n` so the rest of the editing pipeline never sees `\r`.
 */
export function normalizeLineEndings(raw: string): string {
  return raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Insert text at cursor position.
 * `text` may contain newlines (e.g. multi-line paste); they are kept as-is.
 */
export function insertAtCursor(value: string, cursor: number, text: string): InputEditState {
  return {
    value: value.slice(0, cursor) + text + value.slice(cursor),
    cursor: cursor + text.length,
  };
}

/**
 * Detect whether a raw input string is a multi-character paste
 * (as opposed to a single typed character).
 */
export function isPaste(input: string): boolean {
  return input.length > 1;
}

/** Move cursor to previous word boundary (word = non-space run). */
export function prevWordBoundary(value: string, pos: number): number {
  let i = pos - 1;
  while (i > 0 && value[i] === ' ') i--;
  while (i > 0 && value[i - 1] !== ' ') i--;
  return Math.max(0, i);
}

/** Move cursor to next word boundary. */
export function nextWordBoundary(value: string, pos: number): number {
  let i = pos;
  while (i < value.length && value[i] !== ' ') i++;
  while (i < value.length && value[i] === ' ') i++;
  return Math.min(value.length, i);
}

/** Returns line index and column for a cursor position in a multiline value. */
export function getCursorLineCol(value: string, pos: number): { lineIdx: number; col: number } {
  const before = value.slice(0, pos);
  const linesBefore = before.split('\n');
  const lineIdx = linesBefore.length - 1;
  const col = linesBefore[lineIdx].length;
  return { lineIdx, col };
}

/** Compute a viewport window for multiline text. */
export function computeMultilineViewport(
  value: string,
  cursor: number,
  viewportWidth: number,
  maxVisibleLines: number,
) {
  const lines = value.split('\n');
  let pos = 0;
  let cursorLineIdx = 0;
  const allLines = lines.map((line, i) => {
    const lineStart = pos;
    const lineEnd = pos + line.length;
    pos += line.length + 1;
    const hasCursor = cursor >= lineStart && cursor <= lineEnd;
    if (hasCursor) cursorLineIdx = i;
    const localCur = hasCursor ? cursor - lineStart : -1;
    let displayLine = line;
    let displayBefore = '';
    let displayAtCursor = '';
    let displayAfter = '';
    if (hasCursor) {
      let hStart = 0;
      if (line.length > viewportWidth) {
        hStart = Math.max(0, localCur - Math.floor(viewportWidth / 2));
        hStart = Math.min(hStart, Math.max(0, line.length - viewportWidth));
      }
      const hEnd = hStart + viewportWidth;
      const clippedLine = line.slice(hStart, hEnd);
      const adjustedCur = localCur - hStart;
      displayBefore = clippedLine.slice(0, adjustedCur);
      displayAtCursor = clippedLine[adjustedCur] ?? ' ';
      displayAfter = clippedLine.slice(adjustedCur + 1);
      displayLine = clippedLine;
    } else {
      displayLine = line.length > viewportWidth ? line.slice(0, viewportWidth) + '\u2026' : line;
    }
    return {
      text: displayLine,
      hasCursor,
      before: displayBefore,
      atCursor: displayAtCursor,
      after: displayAfter,
      isFirst: i === 0,
      origIdx: i,
    };
  });

  let windowStart = 0;
  if (allLines.length > maxVisibleLines) {
    windowStart = Math.max(0, cursorLineIdx - Math.floor(maxVisibleLines / 2));
    windowStart = Math.min(windowStart, allLines.length - maxVisibleLines);
  }
  const windowEnd = Math.min(windowStart + maxVisibleLines, allLines.length);
  return {
    visibleLines: allLines.slice(windowStart, windowEnd),
    cursorLineInWindow: cursorLineIdx - windowStart,
    totalLines: allLines.length,
  };
}

/** Compute single-line viewport with horizontal scrolling. */
export function computeSingleLineViewport(
  value: string,
  cursor: number,
  viewportWidth: number,
) {
  let hStart = 0;
  if (value.length > viewportWidth) {
    hStart = Math.max(0, cursor - Math.floor(viewportWidth / 2));
    hStart = Math.min(hStart, Math.max(0, value.length - viewportWidth));
  }
  const hEnd = hStart + viewportWidth;
  const clipped = value.slice(hStart, hEnd);
  const adjustedCur = cursor - hStart;
  return {
    before: clipped.slice(0, adjustedCur),
    atCursor: clipped[adjustedCur] ?? ' ',
    after: clipped.slice(adjustedCur + 1),
  };
}
