import test from 'node:test';
import assert from 'node:assert/strict';
import { truncateBashOutput } from './bash.js';

test('returns output unchanged when under 150 lines', () => {
  const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
  const input = lines.join('\n');
  assert.equal(truncateBashOutput(input), input);
});

test('truncates output over 150 lines keeping first 100 and last 50', () => {
  const lines = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`);
  const input = lines.join('\n');
  const result = truncateBashOutput(input);
  const resultLines = result.split('\n');

  assert.equal(resultLines[0], 'line 1');
  assert.equal(resultLines[99], 'line 100');
  assert.match(resultLines[100], /\.\.\. 50 lines truncated \.\.\./);
  assert.equal(resultLines[101], 'line 151');
  assert.equal(resultLines[resultLines.length - 1], 'line 200');
});

test('truncation marker shows correct count', () => {
  const lines = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`);
  const result = truncateBashOutput(lines.join('\n'));
  assert.match(result, /\.\.\. 150 lines truncated \.\.\./);
});

test('returns empty string unchanged', () => {
  assert.equal(truncateBashOutput(''), '');
});

test('handles exactly 150 lines without truncation', () => {
  const lines = Array.from({ length: 150 }, (_, i) => `line ${i + 1}`);
  const input = lines.join('\n');
  assert.equal(truncateBashOutput(input), input);
});
