import React, { memo } from 'react';
import { Box, Text } from 'ink';
import type { TaskItem, TaskStatus } from '../tools/task.js';

interface TaskListViewProps {
  tasks: TaskItem[];
}

const STATUS_ICON: Record<TaskStatus, string> = {
  pending: '○',
  in_progress: '◎',
  completed: '✓',
  deleted: '✗',
};

const STATUS_COLOR: Record<TaskStatus, string> = {
  pending: 'gray',
  in_progress: 'cyan',
  completed: 'green',
  deleted: 'gray',
};

const STATUS_ORDER: Record<TaskStatus, number> = {
  in_progress: 0,
  pending: 1,
  completed: 2,
  deleted: 3,
};

export const TaskListView = memo(function TaskListView({ tasks }: TaskListViewProps) {
  if (tasks.length === 0) return null;

  const visible = tasks
    .filter((t) => t.status !== 'deleted')
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

  if (visible.length === 0) return null;

  return (
    <Box flexDirection="column" marginBottom={1} paddingLeft={1}>
      {visible.map((item) => {
        const icon = STATUS_ICON[item.status];
        const color = STATUS_COLOR[item.status] as 'gray' | 'cyan' | 'green';
        const isActive = item.status === 'in_progress';
        const isBlocked = item.blockedBy && item.blockedBy.length > 0;
        const label = isActive && item.activeForm ? item.activeForm : item.subject;

        return (
          <Box key={item.id} gap={1}>
            <Text color={color}>{icon}</Text>
            <Text color={color} bold={isActive}>{label}</Text>
            {item.owner && <Text dimColor>[{item.owner}]</Text>}
            {isBlocked && <Text color="yellow">blocked</Text>}
          </Box>
        );
      })}
    </Box>
  );
});
