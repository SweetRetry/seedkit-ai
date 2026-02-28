import crypto from 'node:crypto';
import { z } from 'zod';
import { tool } from 'ai';

export interface TodoItem {
  id: string;
  subject: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface TodoStore {
  items: Map<string, TodoItem>;
  todoWrite: ReturnType<typeof buildTodoWriteTool>;
  todoRead: ReturnType<typeof buildTodoReadTool>;
}

function buildTodoWriteTool(items: Map<string, TodoItem>) {
  return tool({
    description:
      'Create or update a task in the session-scoped todo list. ' +
      'Omit id to create a new task. Provide id to update an existing task\'s subject, description, or status. ' +
      'Use this to maintain a structured plan during multi-step tasks.',
    inputSchema: z.object({
      id: z.string().optional().describe('Task ID to update (omit to create)'),
      subject: z.string().describe('Short, imperative task title'),
      description: z.string().optional().describe('Detailed description of what needs to be done'),
      status: z
        .enum(['pending', 'in_progress', 'completed'])
        .describe('Task status'),
    }),
    execute: async ({
      id,
      subject,
      description,
      status,
    }): Promise<{ task: TodoItem }> => {
      if (id && items.has(id)) {
        const existing = items.get(id)!;
        const updated: TodoItem = {
          ...existing,
          subject,
          ...(description !== undefined ? { description } : {}),
          status,
        };
        items.set(id, updated);
        return { task: updated };
      }

      const newId = id ?? crypto.randomUUID().slice(0, 8);
      const task: TodoItem = {
        id: newId,
        subject,
        ...(description !== undefined ? { description } : {}),
        status,
      };
      items.set(newId, task);
      return { task };
    },
  });
}

function buildTodoReadTool(items: Map<string, TodoItem>) {
  return tool({
    description:
      'Read tasks from the session-scoped todo list. ' +
      'Omit id to list all tasks. Provide id to read a single task.',
    inputSchema: z.object({
      id: z.string().optional().describe('Task ID to read (omit to list all)'),
    }),
    execute: async ({ id }): Promise<{ tasks: TodoItem[] } | { task: TodoItem } | { error: string }> => {
      if (id) {
        const task = items.get(id);
        if (!task) return { error: `Task not found: ${id}` };
        return { task };
      }
      return { tasks: Array.from(items.values()) };
    },
  });
}

export function createTodoStore(): TodoStore {
  const items = new Map<string, TodoItem>();
  return {
    items,
    todoWrite: buildTodoWriteTool(items),
    todoRead: buildTodoReadTool(items),
  };
}
