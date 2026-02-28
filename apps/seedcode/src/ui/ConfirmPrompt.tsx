import React, { memo } from 'react';
import { Box, Text } from 'ink';
import type { PendingConfirm } from '../tools/index.js';

interface ConfirmPromptProps {
  pending: PendingConfirm | null;
}

const DIFF_LINES_MAX = 12;

export const ConfirmPrompt = memo(function ConfirmPrompt({ pending }: ConfirmPromptProps) {
  if (!pending) return null;

  const hasDiff = pending.diffLines && (
    pending.diffLines.removed.length > 0 || pending.diffLines.added.length > 0
  );

  return (
    <Box flexDirection="column" marginTop={1} paddingX={1}>
      {/* Header bar */}
      <Box gap={2}>
        <Text color="yellow" bold>{pending.toolName}</Text>
        <Text dimColor>{pending.description}</Text>
      </Box>

      {/* Diff block */}
      {hasDiff && pending.diffLines && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          marginTop={1}
          paddingX={1}
        >
          {/* removed lines */}
          {pending.diffLines.removed.slice(0, DIFF_LINES_MAX).map((line, i) => (
            <Box key={`r${i}`} gap={1}>
              <Text color="red">-</Text>
              <Text color="red" dimColor>{line}</Text>
            </Box>
          ))}
          {pending.diffLines.removed.length > DIFF_LINES_MAX && (
            <Text dimColor>{`… ${pending.diffLines.removed.length - DIFF_LINES_MAX} more removed`}</Text>
          )}

          {/* separator when both sides present */}
          {pending.diffLines.removed.length > 0 && pending.diffLines.added.length > 0 && (
            <Text dimColor>──</Text>
          )}

          {/* added lines */}
          {pending.diffLines.added.slice(0, DIFF_LINES_MAX).map((line, i) => (
            <Box key={`a${i}`} gap={1}>
              <Text color="green">+</Text>
              <Text color="green" dimColor>{line}</Text>
            </Box>
          ))}
          {pending.diffLines.added.length > DIFF_LINES_MAX && (
            <Text dimColor>{`… ${pending.diffLines.added.length - DIFF_LINES_MAX} more added`}</Text>
          )}
        </Box>
      )}

      {/* Prompt row */}
      <Box marginTop={1} gap={1}>
        <Text dimColor>apply?</Text>
        <Text bold color="green">y</Text>
        <Text dimColor>·</Text>
        <Text bold color="red">n</Text>
      </Box>
    </Box>
  );
});
