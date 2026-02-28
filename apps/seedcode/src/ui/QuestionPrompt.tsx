import React, { useState, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { deleteLeftOfCursor } from './inputEditing.js';

export interface QuestionOption {
  label: string;
  description?: string;
}

interface QuestionPromptProps {
  question: string;
  options?: QuestionOption[];
  onAnswer: (answer: string) => void;
  onInterrupt: () => void;
}

export function QuestionPrompt({ question, options = [], onAnswer, onInterrupt }: QuestionPromptProps) {
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);
  // -1 means free-text mode, 0..N-1 means option highlighted
  const [optIdx, setOptIdx] = useState(-1);

  const valueRef = useRef(value);
  const cursorRef = useRef(cursor);
  const optIdxRef = useRef(optIdx);
  valueRef.current = value;
  cursorRef.current = cursor;
  optIdxRef.current = optIdx;

  const update = (newValue: string, newCursor: number) => {
    valueRef.current = newValue;
    cursorRef.current = newCursor;
    setValue(newValue);
    setCursor(newCursor);
  };

  const reset = () => {
    update('', 0);
    setOptIdx(-1);
  };

  useInput((input, key) => {
    const val = valueRef.current;
    const cur = cursorRef.current;
    const idx = optIdxRef.current;

    if (key.ctrl && input === 'c') { onInterrupt(); return; }

    if (key.upArrow && options.length > 0) {
      const next = idx <= 0 ? options.length - 1 : idx - 1;
      setOptIdx(next); optIdxRef.current = next; return;
    }
    if (key.downArrow && options.length > 0) {
      const next = idx >= options.length - 1 ? 0 : idx + 1;
      setOptIdx(next); optIdxRef.current = next; return;
    }
    if (key.return) {
      if (idx >= 0 && options[idx]) {
        const answer = options[idx].label;
        reset();
        onAnswer(answer);
      } else {
        const answer = val.trim();
        reset();
        onAnswer(answer);
      }
      return;
    }
    if (key.escape) { reset(); onAnswer(''); return; }

    // Any character typed clears option selection and enters free-text mode
    if (key.backspace || (key.delete && input === '\x7f')) {
      if (idx >= 0) { setOptIdx(-1); optIdxRef.current = -1; return; }
      const next = deleteLeftOfCursor(val, cur);
      update(next.value, next.cursor);
      return;
    }
    if (key.leftArrow) { setOptIdx(-1); update(val, Math.max(0, cur - 1)); return; }
    if (key.rightArrow) { setOptIdx(-1); update(val, Math.min(val.length, cur + 1)); return; }
    if (!key.ctrl && !key.meta && input) {
      if (idx >= 0) setOptIdx(-1);
      update(val.slice(0, cur) + input + val.slice(cur), cur + input.length);
    }
  });

  const hasOptions = options.length > 0;
  const isFreeTyping = !hasOptions || optIdx < 0;
  const before = value.slice(0, cursor);
  const atCursor = value[cursor] ?? ' ';
  const after = value.slice(cursor + 1);

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* Question header */}
      <Box gap={1}>
        <Text backgroundColor="cyan" color="black" bold>{' ? '}</Text>
        <Text bold color="cyan">{question}</Text>
      </Box>

      {/* Option list */}
      {hasOptions && (
        <Box flexDirection="column" marginTop={1} marginLeft={2}>
          {options.map((opt, i) => {
            const selected = i === optIdx;
            return (
              <Box key={i} flexDirection="column">
                {selected
                  ? (
                    <Box gap={1}>
                      <Text color="cyan" bold>{'\u203A'}</Text>
                      <Text bold color="cyan" inverse>{` ${opt.label} `}</Text>
                    </Box>
                  )
                  : (
                    <Box gap={1}>
                      <Text dimColor>{'\u00B7'}</Text>
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
        <Text color="cyan" bold>{'\u203A '}</Text>
        {isFreeTyping
          ? (
            <>
              <Text>{before}</Text>
              <Text inverse>{atCursor}</Text>
              <Text>{after}</Text>
            </>
          )
          : <Text dimColor>or type a custom answer\u2026</Text>
        }
      </Box>
      <Box>
        <Text dimColor>
          {hasOptions
            ? '  \u2191\u2193 pick option \u00B7 Enter confirm \u00B7 or type to answer freely \u00B7 Esc skip'
            : '  Enter to answer \u00B7 Esc to skip \u00B7 Ctrl+C to cancel'
          }
        </Text>
      </Box>
    </Box>
  );
}
