export interface InputEditState {
  value: string;
  cursor: number;
}

// ── Paste marker utilities ───────────────────────────────────────────────────

/** Regex matching a paste marker token: \x00PASTE:N\x00 */
export const PASTE_MARKER_RE = /\x00PASTE:(\d+)\x00/g;

/** Build a paste marker sentinel for the given block id. */
export function makePasteMarker(id: number): string {
  return `\x00PASTE:${id}\x00`;
}

/** Expand all paste markers back to their full content. */
export function expandPasteMarkers(value: string, blocks: Map<number, string>): string {
  return value.replace(PASTE_MARKER_RE, (_, idStr) => {
    const id = Number(idStr);
    return blocks.get(id) ?? '';
  });
}

/** Build display text for a paste marker. */
export function pasteMarkerDisplayText(id: number, lineCount: number): string {
  return `[Pasted text #${id} +${lineCount} lines]`;
}

/**
 * Replace all paste markers in a string with their display text for rendering.
 * `blocks` maps id → { lineCount }.
 */
export function replaceMarkersForDisplay(
  value: string,
  blocks: Map<number, { lineCount: number }>,
): string {
  return value.replace(PASTE_MARKER_RE, (match, idStr) => {
    const id = Number(idStr);
    const block = blocks.get(id);
    return block ? pasteMarkerDisplayText(id, block.lineCount) : match;
  });
}

/**
 * Map a cursor position from raw value (with markers) to display value
 * (where markers are replaced with display text of different length).
 */
export function mapCursorToDisplay(
  value: string,
  cursor: number,
  blocks: Map<number, { lineCount: number }>,
): number {
  let offset = 0; // cumulative length difference
  const re = new RegExp(PASTE_MARKER_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    const markerStart = m.index;
    const markerEnd = markerStart + m[0].length;
    const id = Number(m[1]);
    const block = blocks.get(id);
    const displayLen = block ? pasteMarkerDisplayText(id, block.lineCount).length : m[0].length;
    const lenDiff = displayLen - m[0].length;

    if (cursor <= markerStart) {
      // Cursor is before this marker
      break;
    } else if (cursor >= markerEnd) {
      // Cursor is after this marker
      offset += lenDiff;
    } else {
      // Cursor is inside the marker — map to end of display text
      offset += displayLen - (cursor - markerStart);
      break;
    }
  }
  return cursor + offset;
}

/**
 * If the cursor is inside or adjacent to a paste marker, find the marker's
 * start and end positions. Returns null if cursor isn't touching a marker.
 */
export function findMarkerAtCursor(
  value: string,
  cursor: number,
  direction: 'left' | 'right',
): { start: number; end: number; id: number } | null {
  const re = new RegExp(PASTE_MARKER_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (direction === 'left') {
      // Backspace: cursor is anywhere inside or at the end of the marker
      if (cursor > start && cursor <= end) {
        return { start, end, id: Number(m[1]) };
      }
    } else {
      // Delete: cursor is at the start or inside the marker
      if (cursor >= start && cursor < end) {
        return { start, end, id: Number(m[1]) };
      }
    }
  }
  return null;
}

/**
 * Move cursor to skip over a paste marker atomically.
 * Returns the new cursor position, or the original if no marker to skip.
 */
export function cursorSkipMarker(
  value: string,
  cursor: number,
  direction: 'left' | 'right',
): number {
  const re = new RegExp(PASTE_MARKER_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (direction === 'right') {
      // Moving right: if cursor is at start or inside, jump to end
      if (cursor >= start && cursor < end) return end;
    } else {
      // Moving left: if cursor is at end or inside, jump to start
      if (cursor > start && cursor <= end) return start;
    }
  }
  return cursor;
}

/**
 * Delete the character immediately left of the cursor block.
 * If the cursor is inside or at the end of a paste marker, the entire marker
 * is removed atomically. Returns `{ deletedMarkerId }` when a marker was removed.
 */
export function deleteLeftOfCursor(
  value: string,
  cursor: number,
): InputEditState & { deletedMarkerId?: number } {
  if (cursor <= 0) {
    return { value, cursor: 0 };
  }

  const marker = findMarkerAtCursor(value, cursor, 'left');
  if (marker) {
    return {
      value: value.slice(0, marker.start) + value.slice(marker.end),
      cursor: marker.start,
      deletedMarkerId: marker.id,
    };
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

/** Soft-wrap a single logical line into multiple visual lines of at most `width` chars. */
function wrapLine(line: string, width: number): string[] {
  if (line.length <= width) return [line];
  const result: string[] = [];
  for (let i = 0; i < line.length; i += width) {
    result.push(line.slice(i, i + width));
  }
  return result;
}

export interface VisualLine {
  text: string;
  hasCursor: boolean;
  before: string;
  atCursor: string;
  after: string;
  /** true only for the first visual line of logical line 0 */
  isFirst: boolean;
  /** index of the original logical line (for "↑ N more lines" indicator) */
  origIdx: number;
}

/** Compute a viewport window for multiline text with soft-wrapping. */
export function computeMultilineViewport(
  value: string,
  cursor: number,
  viewportWidth: number,
  maxVisibleLines: number,
) {
  const logicalLines = value.split('\n');
  let pos = 0;
  const allVisualLines: VisualLine[] = [];
  let cursorVisualIdx = 0;

  for (let i = 0; i < logicalLines.length; i++) {
    const line = logicalLines[i];
    const lineStart = pos;
    const lineEnd = pos + line.length;
    const hasCursorInLine = cursor >= lineStart && cursor <= lineEnd;
    const localCur = hasCursorInLine ? cursor - lineStart : -1;
    pos += line.length + 1; // +1 for the '\n'

    const wrappedSegments = wrapLine(line, viewportWidth);

    let segOffset = 0;
    for (let s = 0; s < wrappedSegments.length; s++) {
      const seg = wrappedSegments[s];
      const segStart = segOffset;
      const segEnd = segOffset + seg.length;
      // cursor is on this visual line if it falls within [segStart, segEnd]
      // (for last segment of a logical line, cursor can sit at segEnd)
      const isLastSeg = s === wrappedSegments.length - 1;
      const cursorOnSeg = hasCursorInLine && (
        isLastSeg
          ? localCur >= segStart && localCur <= segEnd
          : localCur >= segStart && localCur < segEnd
      );

      let displayBefore = '';
      let displayAtCursor = '';
      let displayAfter = '';

      if (cursorOnSeg) {
        cursorVisualIdx = allVisualLines.length;
        const adjCur = localCur - segStart;
        displayBefore = seg.slice(0, adjCur);
        displayAtCursor = seg[adjCur] ?? ' ';
        displayAfter = seg.slice(adjCur + 1);
      }

      allVisualLines.push({
        text: seg,
        hasCursor: cursorOnSeg,
        before: displayBefore,
        atCursor: displayAtCursor,
        after: displayAfter,
        isFirst: i === 0 && s === 0,
        origIdx: i,
      });

      segOffset += seg.length;
    }
  }

  let windowStart = 0;
  if (allVisualLines.length > maxVisibleLines) {
    windowStart = Math.max(0, cursorVisualIdx - Math.floor(maxVisibleLines / 2));
    windowStart = Math.min(windowStart, allVisualLines.length - maxVisibleLines);
  }
  const windowEnd = Math.min(windowStart + maxVisibleLines, allVisualLines.length);
  const visibleLines = allVisualLines.slice(windowStart, windowEnd);

  return {
    visibleLines,
    cursorLineInWindow: cursorVisualIdx - windowStart,
    totalLines: allVisualLines.length,
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
