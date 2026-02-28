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
