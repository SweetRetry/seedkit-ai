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

/** Pretty display name in function-call style: `Read(src/index.ts)` */
function formatToolLabel(toolName: ToolName, description: string): string {
  const DISPLAY_NAMES: Record<string, string> = {
    read: 'Read',
    edit: 'Edit',
    write: 'Write',
    glob: 'Glob',
    grep: 'Grep',
    bash: 'Bash',
    webSearch: 'Web Search',
    webFetch: 'Fetch',
    screenshot: 'Screenshot',
    taskCreate: 'Task Create',
    taskUpdate: 'Task Update',
    taskGet: 'Task Get',
    taskList: 'Task List',
    loadSkill: 'Load Skill',
    spawnAgent: 'Agent',
    askQuestion: 'Ask',
  };
  const name = DISPLAY_NAMES[toolName] ?? toolName;
  // Truncate long descriptions (e.g. bash commands, URLs)
  const maxDescLen = 72;
  const desc = description.length > maxDescLen
    ? description.slice(0, maxDescLen) + '…'
    : description;
  return desc ? `${name}(${desc})` : name;
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

  const isError = entry.status === 'error';
  const isDenied = entry.status === 'denied';
  const isRunning = entry.status === 'running';
  const isPending = entry.status === 'pending';
  const isDone = entry.status === 'done';

  const iconColor = isError ? 'red' : isDenied ? 'gray' : isPending ? 'yellow' : 'cyan';
  const label = formatToolLabel(entry.toolName, entry.description);

  // Task tools: compact single line (TaskListView provides full view)
  const isTaskTool = entry.toolName === 'taskCreate' || entry.toolName === 'taskUpdate'
    || entry.toolName === 'taskGet' || entry.toolName === 'taskList';

  if (isTaskTool) {
    return (
      <Box paddingX={1} gap={1}>
        <Text color={iconColor}>⏺</Text>
        <Text dimColor>{label}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Header line: ⏺ ToolName(description) */}
      <Box gap={1}>
        <Text color={iconColor}>{isRunning ? '⏺' : '⏺'}</Text>
        <Text bold={!isDone && !isDenied} color={isDenied ? 'gray' : undefined}>
          {label}
        </Text>
      </Box>

      {/* Result line with ⎿ tree connector */}
      {isDone && entry.output && (
        <ResultLine>{entry.output}</ResultLine>
      )}

      {isError && entry.output && (
        <ResultLine color="red">Error: {entry.output}</ResultLine>
      )}

      {isDenied && (
        <ResultLine color="gray">Denied by user</ResultLine>
      )}

      {/* Pending confirmation prompt */}
      {isPending && (
        <Box marginLeft={3} gap={1}>
          <Text dimColor>apply?</Text>
          <Text bold color="green">y</Text>
          <Text dimColor>/</Text>
          <Text bold color="red">n</Text>
        </Box>
      )}
    </Box>
  );
}

/** Result line with ⎿ tree connector, truncated to a reasonable preview */
function ResultLine({ children, color }: { children: React.ReactNode; color?: string }) {
  const text = String(children);
  const lines = text.trim().split('\n');
  const preview = lines[0].length > 120 ? lines[0].slice(0, 120) + '…' : lines[0];
  const moreCount = lines.length - 1;

  return (
    <Box marginLeft={3} gap={1}>
      <Text dimColor>⎿</Text>
      <Text color={color} dimColor={!color}>
        {preview}
        {moreCount > 0 ? ` (+${moreCount} lines)` : ''}
      </Text>
    </Box>
  );
}
