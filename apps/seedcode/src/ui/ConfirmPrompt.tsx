import React, { memo } from 'react';
import { Box, Text } from 'ink';
import type { PendingConfirm } from '../tools/index.js';
import { computeDiffStats } from '../tools/diffStats.js';

interface ConfirmPromptProps {
  pending: PendingConfirm | null;
}

export const ConfirmPrompt = memo(function ConfirmPrompt({ pending }: ConfirmPromptProps) {
  if (!pending) return null;

  const { diffHunk } = pending;
  const hasDiff = diffHunk && diffHunk.length > 0;

  const stats = hasDiff ? computeDiffStats(diffHunk!) : null;

  // Compute line number column width for alignment
  const maxLineNo = hasDiff
    ? Math.max(...diffHunk!.filter((l) => l.lineNo !== undefined).map((l) => l.lineNo!), 1)
    : 1;
  const lineNoWidth = String(maxLineNo).length;

  return (
    <Box flexDirection="column" marginTop={1} paddingX={1}>
      {/* Header */}
      <Box gap={2}>
        <Text color="yellow" bold>{pending.toolName}</Text>
        <Text dimColor>{pending.description}</Text>
      </Box>

      {/* Diff stats summary */}
      {stats && (stats.added > 0 || stats.removed > 0) && (
        <Box marginTop={1} gap={1}>
          {stats.added > 0 && <Text color="green">+{stats.added}</Text>}
          {stats.removed > 0 && <Text color="red">-{stats.removed}</Text>}
          <Text dimColor>lines</Text>
        </Box>
      )}

      {/* Unified diff block */}
      {hasDiff && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          marginTop={1}
          paddingX={1}
        >
          {diffHunk!.map((line, i) => {
            if (line.kind === 'context' && line.text === '⋮') {
              return (
                <Box key={i}>
                  <Text dimColor>{'⋮'}</Text>
                </Box>
              );
            }

            const lineNoStr = line.lineNo !== undefined
              ? String(line.lineNo).padStart(lineNoWidth)
              : ' '.repeat(lineNoWidth);

            if (line.kind === 'removed') {
              return (
                <Box key={i} gap={1}>
                  <Text dimColor>{lineNoStr}</Text>
                  <Text color="red" bold>{'-'}</Text>
                  <Text color="red">{line.text}</Text>
                </Box>
              );
            }
            if (line.kind === 'added') {
              return (
                <Box key={i} gap={1}>
                  <Text dimColor>{' '.repeat(lineNoWidth)}</Text>
                  <Text color="green" bold>{'+'}</Text>
                  <Text color="green">{line.text}</Text>
                </Box>
              );
            }
            // context
            return (
              <Box key={i} gap={1}>
                <Text dimColor>{lineNoStr}</Text>
                <Text dimColor>{' '}</Text>
                <Text dimColor>{line.text}</Text>
              </Box>
            );
          })}
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
