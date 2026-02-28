import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { ToolName } from '../tools/index.js';

export type ToolCallStatus =
  | 'pending'      // waiting for confirmation
  | 'running'      // executing
  | 'done'         // finished successfully
  | 'error'        // failed
  | 'denied';      // user denied

export interface ToolCallEntry {
  id: string;
  toolName: ToolName;
  description: string;
  status: ToolCallStatus;
  output?: string;
}

interface ToolCallLineProps {
  entry: ToolCallEntry;
  /** Only relevant when status === 'pending' */
  onConfirm?: (approved: boolean) => void;
}

export function ToolCallLine({ entry, onConfirm }: ToolCallLineProps) {
  useInput(
    (input, key) => {
      if (entry.status !== 'pending' || !onConfirm) return;
      if (input === 'y' || input === 'Y') {
        onConfirm(true);
      } else if (input === 'n' || input === 'N' || key.escape) {
        onConfirm(false);
      }
    },
    { isActive: entry.status === 'pending' }
  );

  const icon = {
    pending: '○',
    running: '◌',
    done: '●',
    error: '✕',
    denied: '◌',
  }[entry.status];

  const iconColor = {
    pending: 'yellow',
    running: 'cyan',
    done: 'green',
    error: 'red',
    denied: 'gray',
  }[entry.status] as string;

  const statusLabel = {
    pending: '',
    running: 'running',
    done: 'done',
    error: 'error',
    denied: 'denied',
  }[entry.status];

  return (
    <Box flexDirection="column" marginTop={1} paddingX={1}>
      <Box gap={1}>
        <Text color={iconColor}>{icon}</Text>
        <Text color={iconColor} bold>{entry.toolName}</Text>
        <Text dimColor>{entry.description}</Text>
        {statusLabel && <Text dimColor>· {statusLabel}</Text>}
      </Box>

      {entry.status === 'pending' && (
        <Box marginLeft={2} gap={1}>
          <Text dimColor>apply?</Text>
          <Text bold color="green">y</Text>
          <Text dimColor>/</Text>
          <Text bold color="red">n</Text>
        </Box>
      )}

      {entry.status === 'error' && entry.output && (
        <Box marginLeft={2}>
          <Text color="red" dimColor>{entry.output}</Text>
        </Box>
      )}

      {entry.status === 'done' && entry.output && (() => {
        const lines = entry.output.trim().split('\n');
        const preview = lines.slice(0, 5).join('\n');
        const truncated = lines.length > 5;
        return (
          <Box marginLeft={2} flexDirection="column">
            <Text dimColor>{preview}</Text>
            {truncated && <Text dimColor>… {lines.length - 5} more lines</Text>}
          </Box>
        );
      })()}
    </Box>
  );
}
