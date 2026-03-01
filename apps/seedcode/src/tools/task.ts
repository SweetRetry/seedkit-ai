import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';
import { tool } from 'ai';

// ── Data model ─────────────────────────────────────────────────────────────

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted';

export interface TaskItem {
  id: string;
  subject: string;
  description?: string;
  status: TaskStatus;
  activeForm?: string;
  owner?: string;
  blocks?: string[];
  blockedBy?: string[];
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface TaskStore {
  items: Map<string, TaskItem>;
  taskCreate: ReturnType<typeof buildTaskCreateTool>;
  taskUpdate: ReturnType<typeof buildTaskUpdateTool>;
  taskGet: ReturnType<typeof buildTaskGetTool>;
  taskList: ReturnType<typeof buildTaskListTool>;
}

// ── Persistence helpers ────────────────────────────────────────────────────

function taskPath(sessionId: string): string {
  return path.join(os.homedir(), '.seedcode', 'tasks', `${sessionId}.json`);
}

function saveTasks(sessionId: string, items: Map<string, TaskItem>): void {
  const filePath = taskPath(sessionId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  // Persist all non-deleted tasks
  const visible = Array.from(items.values()).filter((t) => t.status !== 'deleted');
  fs.writeFileSync(filePath, JSON.stringify(visible, null, 2), 'utf-8');
}

function loadTasks(sessionId: string): Map<string, TaskItem> {
  try {
    const raw = fs.readFileSync(taskPath(sessionId), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Map();
    return new Map(
      (parsed as TaskItem[])
        .filter((t) => t.id && t.subject && t.status)
        .map((t) => [t.id, t])
    );
  } catch {
    return new Map();
  }
}

// ── Helper: remove completed dependency refs ───────────────────────────────

function cleanDeps(items: Map<string, TaskItem>, ids: string[] | undefined): string[] {
  if (!ids || ids.length === 0) return [];
  return ids.filter((id) => {
    const t = items.get(id);
    return t && t.status !== 'completed' && t.status !== 'deleted';
  });
}

// ── Tool builders ──────────────────────────────────────────────────────────

function buildTaskCreateTool(items: Map<string, TaskItem>, sessionId: string) {
  return tool({
    description:
      'Create a new task to track work. Use for multi-step work, parallel subtasks, or complex operations. ' +
      'Returns the created task with its generated ID. Status is always "pending" on creation.',
    inputSchema: z.object({
      subject: z.string().describe('Brief imperative title (e.g. "Fix auth bug in login flow")'),
      description: z.string().optional().describe('Detailed context, acceptance criteria, or notes'),
      activeForm: z.string().optional().describe('Present continuous form shown in spinner when in_progress (e.g. "Fixing auth bug")'),
    }),
    execute: async ({ subject, description, activeForm }): Promise<{ task: TaskItem }> => {
      const now = Date.now();
      const task: TaskItem = {
        id: crypto.randomUUID().slice(0, 8),
        subject,
        description,
        status: 'pending',
        activeForm,
        createdAt: now,
        updatedAt: now,
      };
      items.set(task.id, task);
      saveTasks(sessionId, items);
      return { task };
    },
  });
}

function buildTaskUpdateTool(items: Map<string, TaskItem>, sessionId: string) {
  return tool({
    description:
      'Update an existing task. Can change status, subject, description, owner, or dependencies. ' +
      'Use status "deleted" to soft-delete a task. Mark "in_progress" before starting work, "completed" after finishing.',
    inputSchema: z.object({
      taskId: z.string().describe('The ID of the task to update'),
      status: z.enum(['pending', 'in_progress', 'completed', 'deleted']).optional().describe('New status'),
      subject: z.string().optional().describe('Updated title'),
      description: z.string().optional().describe('Updated description'),
      activeForm: z.string().optional().describe('Updated spinner text for in_progress'),
      owner: z.string().optional().describe('Agent identifier (e.g. "main" or sub-agent name)'),
      addBlocks: z.array(z.string()).optional().describe('Task IDs that this task blocks (cannot start until this completes)'),
      addBlockedBy: z.array(z.string()).optional().describe('Task IDs that must complete before this task can start'),
      metadata: z.record(z.string(), z.unknown()).optional().describe('Arbitrary metadata to merge into the task'),
    }),
    execute: async (input): Promise<{ task: TaskItem } | { error: string }> => {
      const existing = items.get(input.taskId);
      if (!existing) return { error: `Task not found: ${input.taskId}` };

      const updated: TaskItem = {
        ...existing,
        updatedAt: Date.now(),
      };

      if (input.status !== undefined) updated.status = input.status;
      if (input.subject !== undefined) updated.subject = input.subject;
      if (input.description !== undefined) updated.description = input.description;
      if (input.activeForm !== undefined) updated.activeForm = input.activeForm;
      if (input.owner !== undefined) updated.owner = input.owner;

      // Merge dependency arrays
      if (input.addBlocks) {
        const current = new Set(updated.blocks ?? []);
        for (const id of input.addBlocks) current.add(id);
        updated.blocks = [...current];
      }
      if (input.addBlockedBy) {
        const current = new Set(updated.blockedBy ?? []);
        for (const id of input.addBlockedBy) current.add(id);
        updated.blockedBy = [...current];
      }

      // Merge metadata
      if (input.metadata) {
        const meta = { ...(updated.metadata ?? {}) };
        for (const [k, v] of Object.entries(input.metadata)) {
          if (v === null) {
            delete meta[k];
          } else {
            meta[k] = v;
          }
        }
        updated.metadata = Object.keys(meta).length > 0 ? meta : undefined;
      }

      // Auto-clean completed/deleted deps
      updated.blocks = cleanDeps(items, updated.blocks);
      updated.blockedBy = cleanDeps(items, updated.blockedBy);
      if (updated.blocks.length === 0) updated.blocks = undefined;
      if (updated.blockedBy?.length === 0) updated.blockedBy = undefined;

      items.set(input.taskId, updated);
      saveTasks(sessionId, items);
      return { task: updated };
    },
  });
}

function buildTaskGetTool(items: Map<string, TaskItem>) {
  return tool({
    description:
      'Get the full details of a single task by ID, including description and dependencies.',
    inputSchema: z.object({
      taskId: z.string().describe('The ID of the task to retrieve'),
    }),
    execute: async ({ taskId }): Promise<{ task: TaskItem } | { error: string }> => {
      const task = items.get(taskId);
      if (!task || task.status === 'deleted') return { error: `Task not found: ${taskId}` };
      return { task };
    },
  });
}

function buildTaskListTool(items: Map<string, TaskItem>) {
  return tool({
    description:
      'List all tasks (excluding deleted). Returns a summary of each task with id, subject, status, owner, and blockedBy.',
    inputSchema: z.object({}),
    execute: async (): Promise<{ tasks: Array<{ id: string; subject: string; status: TaskStatus; owner?: string; blockedBy?: string[] }> }> => {
      const tasks = Array.from(items.values())
        .filter((t) => t.status !== 'deleted')
        .map((t) => {
          const liveDeps = cleanDeps(items, t.blockedBy);
          return {
            id: t.id,
            subject: t.subject,
            status: t.status,
            ...(t.owner ? { owner: t.owner } : {}),
            ...(liveDeps.length > 0 ? { blockedBy: liveDeps } : {}),
          };
        });
      return { tasks };
    },
  });
}

// ── Public API ─────────────────────────────────────────────────────────────

export function createTaskStore(cwd: string, sessionId: string): TaskStore {
  void cwd; // kept for API compatibility
  const items = loadTasks(sessionId);
  return {
    items,
    taskCreate: buildTaskCreateTool(items, sessionId),
    taskUpdate: buildTaskUpdateTool(items, sessionId),
    taskGet: buildTaskGetTool(items),
    taskList: buildTaskListTool(items),
  };
}
