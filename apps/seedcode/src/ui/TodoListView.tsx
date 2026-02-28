import React, { memo } from 'react';
import { Box, Text } from 'ink';
import type { TodoItem } from '../tools/todo.js';

interface TodoListViewProps {
  todos: TodoItem[];
}

const STATUS_ICON: Record<TodoItem['status'], string> = {
  pending: '○',
  in_progress: '◎',
  completed: '✓',
};

const STATUS_COLOR: Record<TodoItem['status'], string> = {
  pending: 'gray',
  in_progress: 'cyan',
  completed: 'green',
};

export const TodoListView = memo(function TodoListView({ todos }: TodoListViewProps) {
  if (todos.length === 0) return null;

  return (
    <Box flexDirection="column" marginBottom={1} paddingLeft={1}>
      {todos.map((item) => {
        const icon = STATUS_ICON[item.status];
        const color = STATUS_COLOR[item.status] as 'gray' | 'cyan' | 'green';
        const isActive = item.status === 'in_progress';
        return (
          <Box key={item.id} gap={1}>
            <Text color={color}>{icon}</Text>
            <Text color={color} bold={isActive}>{item.content}</Text>
          </Box>
        );
      })}
    </Box>
  );
});
