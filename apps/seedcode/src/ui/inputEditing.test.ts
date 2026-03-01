import test from 'node:test';
import assert from 'node:assert/strict';
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
  pasteMarkerDisplayText,
  mapCursorToDisplay,
  cursorSkipMarker,
  findMarkerAtCursor,
} from './inputEditing';

// ── deleteLeftOfCursor ──────────────────────────────────────────────────────

test('deletes left char when cursor is at end', () => {
  assert.deepEqual(deleteLeftOfCursor('123', 3), { value: '12', cursor: 2 });
});

test('deletes left char when cursor is on current character highlight', () => {
  assert.deepEqual(deleteLeftOfCursor('123', 2), { value: '13', cursor: 1 });
});

test('does nothing when cursor is at start', () => {
  assert.deepEqual(deleteLeftOfCursor('123', 0), { value: '123', cursor: 0 });
});

test('deletes newline character between lines', () => {
  assert.deepEqual(deleteLeftOfCursor('ab\ncd', 3), { value: 'abcd', cursor: 2 });
});

// ── normalizeLineEndings ────────────────────────────────────────────────────

test('normalizeLineEndings: \\r\\n → \\n', () => {
  assert.equal(normalizeLineEndings('a\r\nb'), 'a\nb');
});

test('normalizeLineEndings: \\r → \\n', () => {
  assert.equal(normalizeLineEndings('a\rb'), 'a\nb');
});

test('normalizeLineEndings: \\n unchanged', () => {
  assert.equal(normalizeLineEndings('a\nb'), 'a\nb');
});

test('normalizeLineEndings: mixed \\r\\n and \\r', () => {
  assert.equal(normalizeLineEndings('a\r\nb\rc'), 'a\nb\nc');
});

test('normalizeLineEndings: no line endings', () => {
  assert.equal(normalizeLineEndings('hello'), 'hello');
});

test('normalizeLineEndings: empty string', () => {
  assert.equal(normalizeLineEndings(''), '');
});

test('normalizeLineEndings: consecutive \\r\\n pairs', () => {
  assert.equal(normalizeLineEndings('a\r\n\r\nb'), 'a\n\nb');
});

test('normalizeLineEndings: \\r\\n must not double-convert to \\n\\n', () => {
  // Regression: naive replace(\r,\n) after replace(\r\n,\n) would turn \r\n → \n\n
  const result = normalizeLineEndings('line1\r\nline2\r\nline3');
  assert.equal(result, 'line1\nline2\nline3');
  assert.equal(result.split('\n').length, 3);
});

// ── insertAtCursor ──────────────────────────────────────────────────────────

test('insertAtCursor: insert at end', () => {
  assert.deepEqual(insertAtCursor('ab', 2, 'cd'), { value: 'abcd', cursor: 4 });
});

test('insertAtCursor: insert at start', () => {
  assert.deepEqual(insertAtCursor('ab', 0, 'xy'), { value: 'xyab', cursor: 2 });
});

test('insertAtCursor: insert in middle', () => {
  assert.deepEqual(insertAtCursor('ad', 1, 'bc'), { value: 'abcd', cursor: 3 });
});

test('insertAtCursor: insert multiline paste', () => {
  const result = insertAtCursor('prefix', 6, 'line1\nline2\nline3');
  assert.equal(result.value, 'prefixline1\nline2\nline3');
  assert.equal(result.cursor, 23); // 6 + 17
});

test('insertAtCursor: insert into multiline value', () => {
  const result = insertAtCursor('aa\nbb', 3, 'XX');
  assert.equal(result.value, 'aa\nXXbb');
  assert.equal(result.cursor, 5);
});

test('insertAtCursor: empty insert does nothing', () => {
  assert.deepEqual(insertAtCursor('abc', 1, ''), { value: 'abc', cursor: 1 });
});

// ── isPaste ─────────────────────────────────────────────────────────────────

test('isPaste: single char is not paste', () => {
  assert.equal(isPaste('a'), false);
});

test('isPaste: multiple chars is paste', () => {
  assert.equal(isPaste('ab'), true);
});

test('isPaste: empty string is not paste', () => {
  assert.equal(isPaste(''), false);
});

// ── prevWordBoundary / nextWordBoundary ─────────────────────────────────────

test('prevWordBoundary: from end of second word', () => {
  assert.equal(prevWordBoundary('hello world', 11), 6);
});

test('prevWordBoundary: from middle of first word', () => {
  assert.equal(prevWordBoundary('hello', 3), 0);
});

test('prevWordBoundary: from start', () => {
  assert.equal(prevWordBoundary('hello', 0), 0);
});

test('prevWordBoundary: skips multiple spaces', () => {
  assert.equal(prevWordBoundary('a   b', 4), 0);
});

test('nextWordBoundary: from start of first word', () => {
  assert.equal(nextWordBoundary('hello world', 0), 6);
});

test('nextWordBoundary: from middle of word', () => {
  assert.equal(nextWordBoundary('hello world', 3), 6);
});

test('nextWordBoundary: from end', () => {
  assert.equal(nextWordBoundary('hello', 5), 5);
});

// ── getCursorLineCol ────────────────────────────────────────────────────────

test('getCursorLineCol: single line', () => {
  assert.deepEqual(getCursorLineCol('hello', 3), { lineIdx: 0, col: 3 });
});

test('getCursorLineCol: second line start', () => {
  assert.deepEqual(getCursorLineCol('ab\ncd', 3), { lineIdx: 1, col: 0 });
});

test('getCursorLineCol: second line middle', () => {
  assert.deepEqual(getCursorLineCol('ab\ncd', 4), { lineIdx: 1, col: 1 });
});

test('getCursorLineCol: at newline boundary', () => {
  // Cursor at position 2 is the '\n' itself — ends line 0
  assert.deepEqual(getCursorLineCol('ab\ncd', 2), { lineIdx: 0, col: 2 });
});

test('getCursorLineCol: three lines, cursor on third', () => {
  assert.deepEqual(getCursorLineCol('a\nb\nc', 4), { lineIdx: 2, col: 0 });
});

// ── computeMultilineViewport ────────────────────────────────────────────────

test('multiline viewport: basic two lines, cursor on first', () => {
  const result = computeMultilineViewport('hello\nworld', 3, 80, 10);
  assert.equal(result.totalLines, 2);
  assert.equal(result.visibleLines.length, 2);
  const cursorLine = result.visibleLines.find(l => l.hasCursor);
  assert.ok(cursorLine);
  assert.equal(cursorLine.before, 'hel');
  assert.equal(cursorLine.atCursor, 'l');
  assert.equal(cursorLine.after, 'o');
});

test('multiline viewport: cursor on second line', () => {
  const result = computeMultilineViewport('hello\nworld', 8, 80, 10);
  assert.equal(result.totalLines, 2);
  const cursorLine = result.visibleLines.find(l => l.hasCursor);
  assert.ok(cursorLine);
  assert.equal(cursorLine.before, 'wo');
  assert.equal(cursorLine.atCursor, 'r');
});

test('multiline viewport: window clips when > maxVisibleLines', () => {
  // Create 15 lines, cursor on line 12
  const lines = Array.from({ length: 15 }, (_, i) => `line${i}`);
  const val = lines.join('\n');
  // Cursor at the start of line 12
  const cursorPos = lines.slice(0, 12).join('\n').length + 1;
  const result = computeMultilineViewport(val, cursorPos, 80, 5);
  assert.equal(result.totalLines, 15);
  assert.equal(result.visibleLines.length, 5);
  // The cursor line should be visible
  assert.ok(result.visibleLines.some(l => l.hasCursor));
});

test('multiline viewport: horizontal scroll on long line with cursor', () => {
  const longLine = 'A'.repeat(200);
  const val = `short\n${longLine}`;
  // Cursor at position 150 in the long line
  const cursorPos = 6 + 150; // "short\n" = 6 chars
  const result = computeMultilineViewport(val, cursorPos, 40, 10);
  const cursorLine = result.visibleLines.find(l => l.hasCursor);
  assert.ok(cursorLine);
  // The displayed line should be clipped to viewportWidth
  const totalDisplayLen = cursorLine.before.length + cursorLine.atCursor.length + cursorLine.after.length;
  assert.ok(totalDisplayLen <= 40);
});

// ── soft-wrap tests ────────────────────────────────────────────────────────

test('multiline viewport: long line wraps into multiple visual lines', () => {
  // 100 chars in a viewport of 40 → 3 visual lines (40 + 40 + 20)
  const longLine = 'A'.repeat(100);
  const result = computeMultilineViewport(longLine + '\nshort', 0, 40, 20);
  // 3 visual lines for longLine + 1 for "short" = 4 total
  assert.equal(result.totalLines, 4);
  assert.equal(result.visibleLines[0].text, 'A'.repeat(40));
  assert.equal(result.visibleLines[1].text, 'A'.repeat(40));
  assert.equal(result.visibleLines[2].text, 'A'.repeat(20));
  assert.equal(result.visibleLines[3].text, 'short');
});

test('multiline viewport: cursor on wrapped continuation line', () => {
  // 80 chars, viewport 40 → wraps into 2 visual lines
  const line = 'B'.repeat(80);
  // Cursor at position 50 → should be on the second visual line (40..79), local offset 10
  const result = computeMultilineViewport(line, 50, 40, 20);
  assert.equal(result.totalLines, 2);
  const cursorLine = result.visibleLines.find(l => l.hasCursor);
  assert.ok(cursorLine);
  assert.equal(cursorLine.before, 'B'.repeat(10));
  assert.equal(cursorLine.atCursor, 'B');
  assert.equal(cursorLine.after, 'B'.repeat(29));
});

test('multiline viewport: isFirst only on first visual line', () => {
  const val = 'A'.repeat(80) + '\nB';
  const result = computeMultilineViewport(val, 0, 40, 20);
  assert.equal(result.visibleLines[0].isFirst, true);
  assert.equal(result.visibleLines[1].isFirst, false); // wrapped part of line 0
  assert.equal(result.visibleLines[2].isFirst, false); // logical line 1
});

test('multiline viewport: short lines not affected by wrapping', () => {
  const val = 'hello\nworld';
  const result = computeMultilineViewport(val, 3, 80, 10);
  assert.equal(result.totalLines, 2);
  assert.equal(result.visibleLines.length, 2);
  assert.equal(result.visibleLines[0].text, 'hello');
  assert.equal(result.visibleLines[1].text, 'world');
});

// ── computeSingleLineViewport ───────────────────────────────────────────────

test('single-line viewport: short value shows everything', () => {
  const result = computeSingleLineViewport('hello', 3, 80);
  assert.equal(result.before, 'hel');
  assert.equal(result.atCursor, 'l');
  assert.equal(result.after, 'o');
});

test('single-line viewport: cursor at end', () => {
  const result = computeSingleLineViewport('abc', 3, 80);
  assert.equal(result.before, 'abc');
  assert.equal(result.atCursor, ' '); // virtual cursor block
  assert.equal(result.after, '');
});

test('single-line viewport: long value scrolls to center cursor', () => {
  const long = 'A'.repeat(200);
  const result = computeSingleLineViewport(long, 100, 40);
  // Total displayed chars = viewportWidth
  const totalLen = result.before.length + result.atCursor.length + result.after.length;
  assert.equal(totalLen, 40);
});

// ── Integration: normalizeLineEndings + insertAtCursor ──────────────────────

test('paste with \\r converts to multiline value', () => {
  const raw = 'line1\rline2\rline3';
  const normalized = normalizeLineEndings(raw);
  const result = insertAtCursor('', 0, normalized);
  assert.equal(result.value, 'line1\nline2\nline3');
  assert.equal(result.value.split('\n').length, 3);
});

test('paste with \\r\\n converts to multiline value', () => {
  const raw = 'line1\r\nline2\r\nline3';
  const normalized = normalizeLineEndings(raw);
  const result = insertAtCursor('prefix ', 7, normalized);
  assert.equal(result.value, 'prefix line1\nline2\nline3');
  assert.equal(result.cursor, 24);
});

test('paste with \\n is already normalized', () => {
  const raw = 'line1\nline2';
  const normalized = normalizeLineEndings(raw);
  assert.equal(normalized, raw);
  const result = insertAtCursor('', 0, normalized);
  assert.equal(result.value, 'line1\nline2');
});

// ── makePasteMarker ──────────────────────────────────────────────────────────

test('makePasteMarker: creates correct sentinel', () => {
  assert.equal(makePasteMarker(1), '\x00PASTE:1\x00');
  assert.equal(makePasteMarker(42), '\x00PASTE:42\x00');
});

// ── expandPasteMarkers ───────────────────────────────────────────────────────

test('expandPasteMarkers: replaces single marker', () => {
  const blocks = new Map([[1, 'line1\nline2\nline3\nline4']]);
  const val = 'before \x00PASTE:1\x00 after';
  assert.equal(expandPasteMarkers(val, blocks), 'before line1\nline2\nline3\nline4 after');
});

test('expandPasteMarkers: replaces multiple markers', () => {
  const blocks = new Map([[1, 'AAA'], [2, 'BBB']]);
  const val = '\x00PASTE:1\x00 middle \x00PASTE:2\x00';
  assert.equal(expandPasteMarkers(val, blocks), 'AAA middle BBB');
});

test('expandPasteMarkers: missing block returns empty string', () => {
  const blocks = new Map<number, string>();
  const val = '\x00PASTE:99\x00';
  assert.equal(expandPasteMarkers(val, blocks), '');
});

test('expandPasteMarkers: no markers returns value unchanged', () => {
  const blocks = new Map([[1, 'content']]);
  assert.equal(expandPasteMarkers('no markers here', blocks), 'no markers here');
});

// ── pasteMarkerDisplayText ───────────────────────────────────────────────────

test('pasteMarkerDisplayText: formats correctly', () => {
  assert.equal(pasteMarkerDisplayText(1, 6), '[Pasted text #1 +6 lines]');
  assert.equal(pasteMarkerDisplayText(3, 12), '[Pasted text #3 +12 lines]');
});

// ── replaceMarkersForDisplay ─────────────────────────────────────────────────

test('replaceMarkersForDisplay: replaces markers with display text', () => {
  const blocks = new Map([[1, { lineCount: 6 }], [2, { lineCount: 12 }]]);
  const val = '\x00PASTE:1\x00 text \x00PASTE:2\x00';
  assert.equal(
    replaceMarkersForDisplay(val, blocks),
    '[Pasted text #1 +6 lines] text [Pasted text #2 +12 lines]',
  );
});

// ── cursorSkipMarker ─────────────────────────────────────────────────────────

test('cursorSkipMarker right: jumps over marker', () => {
  const val = 'ab\x00PASTE:1\x00cd';
  // Cursor at start of marker (pos 2)
  assert.equal(cursorSkipMarker(val, 2, 'right'), 2 + '\x00PASTE:1\x00'.length);
});

test('cursorSkipMarker right: no marker returns same position', () => {
  assert.equal(cursorSkipMarker('hello', 2, 'right'), 2);
});

test('cursorSkipMarker left: jumps over marker', () => {
  const marker = '\x00PASTE:1\x00';
  const val = 'ab' + marker + 'cd';
  // Cursor at end of marker
  assert.equal(cursorSkipMarker(val, 2 + marker.length, 'left'), 2);
});

test('cursorSkipMarker left: inside marker jumps to start', () => {
  const marker = '\x00PASTE:1\x00';
  const val = 'ab' + marker + 'cd';
  // Cursor inside the marker
  assert.equal(cursorSkipMarker(val, 5, 'left'), 2);
});

test('cursorSkipMarker left: no marker returns same position', () => {
  assert.equal(cursorSkipMarker('hello', 3, 'left'), 3);
});

// ── findMarkerAtCursor ───────────────────────────────────────────────────────

test('findMarkerAtCursor left: cursor at end of marker', () => {
  const marker = '\x00PASTE:5\x00';
  const val = 'x' + marker + 'y';
  const result = findMarkerAtCursor(val, 1 + marker.length, 'left');
  assert.ok(result);
  assert.equal(result!.start, 1);
  assert.equal(result!.end, 1 + marker.length);
  assert.equal(result!.id, 5);
});

test('findMarkerAtCursor right: cursor at start of marker', () => {
  const marker = '\x00PASTE:3\x00';
  const val = 'x' + marker + 'y';
  const result = findMarkerAtCursor(val, 1, 'right');
  assert.ok(result);
  assert.equal(result!.start, 1);
  assert.equal(result!.id, 3);
});

test('findMarkerAtCursor: no marker returns null', () => {
  assert.equal(findMarkerAtCursor('hello', 2, 'left'), null);
  assert.equal(findMarkerAtCursor('hello', 2, 'right'), null);
});

// ── deleteLeftOfCursor with markers ──────────────────────────────────────────

test('deleteLeftOfCursor: removes entire marker when cursor at end', () => {
  const marker = '\x00PASTE:1\x00';
  const val = 'ab' + marker + 'cd';
  const result = deleteLeftOfCursor(val, 2 + marker.length);
  assert.equal(result.value, 'abcd');
  assert.equal(result.cursor, 2);
  assert.equal(result.deletedMarkerId, 1);
});

test('deleteLeftOfCursor: removes entire marker when cursor inside', () => {
  const marker = '\x00PASTE:1\x00';
  const val = 'ab' + marker + 'cd';
  const result = deleteLeftOfCursor(val, 5); // inside the marker
  assert.equal(result.value, 'abcd');
  assert.equal(result.cursor, 2);
  assert.equal(result.deletedMarkerId, 1);
});

test('deleteLeftOfCursor: normal char when no marker', () => {
  const result = deleteLeftOfCursor('abc', 2);
  assert.equal(result.value, 'ac');
  assert.equal(result.cursor, 1);
  assert.equal(result.deletedMarkerId, undefined);
});

// ── mapCursorToDisplay ───────────────────────────────────────────────────────

test('mapCursorToDisplay: cursor before marker', () => {
  const marker = '\x00PASTE:1\x00';
  const val = 'ab' + marker + 'cd';
  const blocks = new Map([[1, { lineCount: 8 }]]);
  // Cursor at pos 1 (before marker) stays the same
  assert.equal(mapCursorToDisplay(val, 1, blocks), 1);
});

test('mapCursorToDisplay: cursor after marker shifts by length difference', () => {
  const marker = '\x00PASTE:1\x00';
  const val = 'ab' + marker + 'cd';
  const blocks = new Map([[1, { lineCount: 8 }]]);
  const displayText = '[Pasted text #1 +8 lines]';
  const rawEnd = 2 + marker.length + 1; // 'ab' + marker + 'c'
  const expectedDisplay = 2 + displayText.length + 1;
  assert.equal(mapCursorToDisplay(val, rawEnd, blocks), expectedDisplay);
});

test('mapCursorToDisplay: no markers returns same cursor', () => {
  const blocks = new Map<number, { lineCount: number }>();
  assert.equal(mapCursorToDisplay('hello', 3, blocks), 3);
});

// ── computeMultilineViewport with pre-replaced display text ──────────────────

test('multiline viewport: display-replaced text shows paste placeholder', () => {
  const blocks = new Map([[1, { lineCount: 8 }]]);
  // Simulate what InputBox does: replace markers before passing to viewport
  const displayVal = 'before\n[Pasted text #1 +8 lines]\nafter';
  const result = computeMultilineViewport(displayVal, 0, 80, 10);
  assert.equal(result.totalLines, 3);
  const markerLine = result.visibleLines[1];
  assert.equal(markerLine.text, '[Pasted text #1 +8 lines]');
});

test('multiline viewport: cursor on display-replaced line works correctly', () => {
  const displayVal = 'text [Pasted text #1 +5 lines] more';
  const cursorPos = 'text [Pasted text #1 +5 lines] '.length;
  const result = computeMultilineViewport(displayVal, cursorPos, 80, 10);
  const cursorLine = result.visibleLines.find((l) => l.hasCursor);
  assert.ok(cursorLine);
  assert.ok(cursorLine!.before.includes('[Pasted text #1 +5 lines]'));
});
