import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';
import { tool } from 'ai';

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface TodoStore {
  items: Map<string, TodoItem>;
  todoWrite: ReturnType<typeof buildTodoWriteTool>;
  todoRead: ReturnType<typeof buildTodoReadTool>;
}

// ── Persistence helpers ────────────────────────────────────────────────────

/**
 * Path: ~/.seedcode/todos/{sessionId}.json
 * Flat structure — all sessions in one directory, same as ~/.claude/todos/
 */
function todoPath(sessionId: string): string {
  return path.join(os.homedir(), '.seedcode', 'todos', `${sessionId}.json`);
}

function saveTodos(sessionId: string, items: Map<string, TodoItem>): void {
  const filePath = todoPath(sessionId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(Array.from(items.values()), null, 2), 'utf-8');
}

function loadTodos(sessionId: string): Map<string, TodoItem> {
  try {
    const raw = fs.readFileSync(todoPath(sessionId), 'utf-8');
    const items = JSON.parse(raw) as TodoItem[];
    return new Map(items.map((t) => [t.id, t]));
  } catch {
    return new Map();
  }
}

// ── Tool builders ──────────────────────────────────────────────────────────

function buildTodoWriteTool(items: Map<string, TodoItem>, sessionId: string) {
  return tool({
    description:
      'Create or update a task in the todo list. ' +
      'Omit id to create a new task. Provide id to update an existing task. ' +
      'Use this to maintain a structured plan during multi-step tasks.',
    inputSchema: z.object({
      id: z.string().optional().describe('Task ID to update (omit to create)'),
      content: z.string().describe('Short, imperative task description'),
      status: z
        .enum(['pending', 'in_progress', 'completed'])
        .describe('Task status'),
    }),
    execute: async ({ id, content, status }): Promise<{ task: TodoItem }> => {
      if (id && items.has(id)) {
        const updated: TodoItem = { ...items.get(id)!, content, status };
        items.set(id, updated);
        saveTodos(sessionId, items);
        return { task: updated };
      }

      const newId = id ?? crypto.randomUUID().slice(0, 8);
      const task: TodoItem = { id: newId, content, status };
      items.set(newId, task);
      saveTodos(sessionId, items);
      return { task };
    },
  });
}

function buildTodoReadTool(items: Map<string, TodoItem>) {
  return tool({
    description:
      'Read tasks from the todo list. ' +
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

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Create a todo store backed by persistent storage.
 * Loads any existing todos for this session on creation.
 */
export function createTodoStore(cwd: string, sessionId: string): TodoStore {
  // cwd param kept for API compatibility but no longer used in path
  void cwd;
  const items = loadTodos(sessionId);
  return {
    items,
    todoWrite: buildTodoWriteTool(items, sessionId),
    todoRead: buildTodoReadTool(items),
  };
}
