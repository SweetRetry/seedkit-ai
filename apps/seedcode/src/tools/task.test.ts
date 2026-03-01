import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createTaskStore, type TaskItem } from './task.js';

// Each test gets a unique sessionId to avoid cross-test contamination.
// Cleanup removes the persisted JSON file after each test.
let sessionId: string;
function taskFilePath() {
  return path.join(os.homedir(), '.seedcode', 'tasks', `${sessionId}.json`);
}

beforeEach(() => {
  sessionId = `test-${crypto.randomUUID().slice(0, 8)}`;
});

afterEach(() => {
  try { fs.unlinkSync(taskFilePath()); } catch { /* no-op */ }
});

// Helper: call tool.execute with proper AI SDK tool call shape
// AI SDK tool.execute receives (input, options) — options can be empty object
async function exec<T>(toolObj: { execute?: (...args: unknown[]) => Promise<T> }, input: Record<string, unknown>): Promise<T> {
  return toolObj.execute!(input, {} as never);
}

// ── taskCreate ─────────────────────────────────────────────────────────────

describe('taskCreate', () => {
  test('creates a task with pending status and generated id', async () => {
    const store = createTaskStore('.', sessionId);
    const result = await exec(store.taskCreate, { subject: 'Write tests' }) as { task: TaskItem };

    assert.equal(result.task.subject, 'Write tests');
    assert.equal(result.task.status, 'pending');
    assert.equal(typeof result.task.id, 'string');
    assert.ok(result.task.id.length > 0);
    assert.equal(typeof result.task.createdAt, 'number');
    assert.equal(result.task.createdAt, result.task.updatedAt);
  });

  test('persists created task to disk', async () => {
    const store = createTaskStore('.', sessionId);
    const { task } = await exec(store.taskCreate, { subject: 'Persist me' }) as { task: TaskItem };

    const raw = JSON.parse(fs.readFileSync(taskFilePath(), 'utf-8')) as TaskItem[];
    assert.equal(raw.length, 1);
    assert.equal(raw[0].id, task.id);
    assert.equal(raw[0].subject, 'Persist me');
  });

  test('stores optional description and activeForm', async () => {
    const store = createTaskStore('.', sessionId);
    const { task } = await exec(store.taskCreate, {
      subject: 'Fix bug',
      description: 'Auth fails on empty email',
      activeForm: 'Fixing bug',
    }) as { task: TaskItem };

    assert.equal(task.description, 'Auth fails on empty email');
    assert.equal(task.activeForm, 'Fixing bug');
  });

  test('creates multiple tasks with unique ids', async () => {
    const store = createTaskStore('.', sessionId);
    const { task: t1 } = await exec(store.taskCreate, { subject: 'Task 1' }) as { task: TaskItem };
    const { task: t2 } = await exec(store.taskCreate, { subject: 'Task 2' }) as { task: TaskItem };

    assert.notEqual(t1.id, t2.id);
    assert.equal(store.items.size, 2);
  });
});

// ── taskUpdate ─────────────────────────────────────────────────────────────

describe('taskUpdate', () => {
  test('updates status from pending to in_progress', async () => {
    const store = createTaskStore('.', sessionId);
    const { task } = await exec(store.taskCreate, { subject: 'Do work' }) as { task: TaskItem };

    const result = await exec(store.taskUpdate, { taskId: task.id, status: 'in_progress' }) as { task: TaskItem };
    assert.equal(result.task.status, 'in_progress');
    assert.ok(result.task.updatedAt >= task.updatedAt);
  });

  test('returns error for nonexistent task', async () => {
    const store = createTaskStore('.', sessionId);
    const result = await exec(store.taskUpdate, { taskId: 'nope', status: 'completed' }) as { error: string };
    assert.ok(result.error.includes('nope'));
  });

  test('soft-deletes a task', async () => {
    const store = createTaskStore('.', sessionId);
    const { task } = await exec(store.taskCreate, { subject: 'Delete me' }) as { task: TaskItem };

    await exec(store.taskUpdate, { taskId: task.id, status: 'deleted' });

    // Deleted tasks excluded from persisted file
    const raw = JSON.parse(fs.readFileSync(taskFilePath(), 'utf-8')) as TaskItem[];
    assert.equal(raw.length, 0);

    // But still in memory (for dep tracking)
    assert.equal(store.items.get(task.id)!.status, 'deleted');
  });

  test('merges addBlocks and addBlockedBy', async () => {
    const store = createTaskStore('.', sessionId);
    const { task: t1 } = await exec(store.taskCreate, { subject: 'T1' }) as { task: TaskItem };
    const { task: t2 } = await exec(store.taskCreate, { subject: 'T2' }) as { task: TaskItem };
    const { task: t3 } = await exec(store.taskCreate, { subject: 'T3' }) as { task: TaskItem };

    // T1 blocks T2 and T3
    await exec(store.taskUpdate, { taskId: t1.id, addBlocks: [t2.id] });
    const r1 = await exec(store.taskUpdate, { taskId: t1.id, addBlocks: [t3.id] }) as { task: TaskItem };
    assert.deepEqual(r1.task.blocks!.sort(), [t2.id, t3.id].sort());

    // T2 blockedBy T1
    const r2 = await exec(store.taskUpdate, { taskId: t2.id, addBlockedBy: [t1.id] }) as { task: TaskItem };
    assert.deepEqual(r2.task.blockedBy, [t1.id]);
  });

  test('deduplicates dependency ids', async () => {
    const store = createTaskStore('.', sessionId);
    const { task: t1 } = await exec(store.taskCreate, { subject: 'T1' }) as { task: TaskItem };
    const { task: t2 } = await exec(store.taskCreate, { subject: 'T2' }) as { task: TaskItem };

    await exec(store.taskUpdate, { taskId: t1.id, addBlocks: [t2.id] });
    const result = await exec(store.taskUpdate, { taskId: t1.id, addBlocks: [t2.id] }) as { task: TaskItem };
    assert.equal(result.task.blocks!.length, 1);
  });

  test('auto-cleans completed deps', async () => {
    const store = createTaskStore('.', sessionId);
    const { task: blocker } = await exec(store.taskCreate, { subject: 'Blocker' }) as { task: TaskItem };
    const { task: blocked } = await exec(store.taskCreate, { subject: 'Blocked' }) as { task: TaskItem };

    await exec(store.taskUpdate, { taskId: blocked.id, addBlockedBy: [blocker.id] });
    // Complete the blocker
    await exec(store.taskUpdate, { taskId: blocker.id, status: 'completed' });
    // Update the blocked task — should auto-clean the completed dep
    const result = await exec(store.taskUpdate, { taskId: blocked.id, status: 'in_progress' }) as { task: TaskItem };
    assert.equal(result.task.blockedBy, undefined);
  });

  test('merges and deletes metadata keys', async () => {
    const store = createTaskStore('.', sessionId);
    const { task } = await exec(store.taskCreate, { subject: 'Meta' }) as { task: TaskItem };

    await exec(store.taskUpdate, { taskId: task.id, metadata: { foo: 1, bar: 'hello' } });
    const r1 = await exec(store.taskUpdate, { taskId: task.id, metadata: { foo: null, baz: true } }) as { task: TaskItem };

    assert.equal(r1.task.metadata!.foo, undefined);
    assert.equal(r1.task.metadata!.bar, 'hello');
    assert.equal(r1.task.metadata!.baz, true);
  });

  test('clears metadata entirely when all keys deleted', async () => {
    const store = createTaskStore('.', sessionId);
    const { task } = await exec(store.taskCreate, { subject: 'Meta' }) as { task: TaskItem };

    await exec(store.taskUpdate, { taskId: task.id, metadata: { only: 'one' } });
    const result = await exec(store.taskUpdate, { taskId: task.id, metadata: { only: null } }) as { task: TaskItem };
    assert.equal(result.task.metadata, undefined);
  });

  test('updates subject, description, activeForm, owner', async () => {
    const store = createTaskStore('.', sessionId);
    const { task } = await exec(store.taskCreate, { subject: 'Old' }) as { task: TaskItem };

    const result = await exec(store.taskUpdate, {
      taskId: task.id,
      subject: 'New',
      description: 'Updated desc',
      activeForm: 'Working on it',
      owner: 'sub-agent-1',
    }) as { task: TaskItem };

    assert.equal(result.task.subject, 'New');
    assert.equal(result.task.description, 'Updated desc');
    assert.equal(result.task.activeForm, 'Working on it');
    assert.equal(result.task.owner, 'sub-agent-1');
  });
});

// ── taskGet ────────────────────────────────────────────────────────────────

describe('taskGet', () => {
  test('returns task by id', async () => {
    const store = createTaskStore('.', sessionId);
    const { task } = await exec(store.taskCreate, { subject: 'Find me' }) as { task: TaskItem };

    const result = await exec(store.taskGet, { taskId: task.id }) as { task: TaskItem };
    assert.equal(result.task.subject, 'Find me');
  });

  test('returns error for nonexistent id', async () => {
    const store = createTaskStore('.', sessionId);
    const result = await exec(store.taskGet, { taskId: 'missing' }) as { error: string };
    assert.ok(result.error.includes('missing'));
  });

  test('returns error for deleted task', async () => {
    const store = createTaskStore('.', sessionId);
    const { task } = await exec(store.taskCreate, { subject: 'Bye' }) as { task: TaskItem };
    await exec(store.taskUpdate, { taskId: task.id, status: 'deleted' });

    const result = await exec(store.taskGet, { taskId: task.id }) as { error: string };
    assert.ok(result.error.includes(task.id));
  });
});

// ── taskList ───────────────────────────────────────────────────────────────

describe('taskList', () => {
  test('returns empty list when no tasks', async () => {
    const store = createTaskStore('.', sessionId);
    const result = await exec(store.taskList, {}) as { tasks: unknown[] };
    assert.equal(result.tasks.length, 0);
  });

  test('excludes deleted tasks', async () => {
    const store = createTaskStore('.', sessionId);
    const { task } = await exec(store.taskCreate, { subject: 'Gone' }) as { task: TaskItem };
    await exec(store.taskCreate, { subject: 'Stays' });
    await exec(store.taskUpdate, { taskId: task.id, status: 'deleted' });

    const result = await exec(store.taskList, {}) as { tasks: Array<{ subject: string }> };
    assert.equal(result.tasks.length, 1);
    assert.equal(result.tasks[0].subject, 'Stays');
  });

  test('includes owner and blockedBy in summary', async () => {
    const store = createTaskStore('.', sessionId);
    const { task: t1 } = await exec(store.taskCreate, { subject: 'T1' }) as { task: TaskItem };
    const { task: t2 } = await exec(store.taskCreate, { subject: 'T2' }) as { task: TaskItem };

    await exec(store.taskUpdate, { taskId: t2.id, owner: 'agent-x', addBlockedBy: [t1.id] });

    const result = await exec(store.taskList, {}) as { tasks: Array<{ id: string; owner?: string; blockedBy?: string[] }> };
    const t2Summary = result.tasks.find((t) => t.id === t2.id)!;
    assert.equal(t2Summary.owner, 'agent-x');
    assert.deepEqual(t2Summary.blockedBy, [t1.id]);
  });

  test('omits blockedBy when deps are all completed', async () => {
    const store = createTaskStore('.', sessionId);
    const { task: blocker } = await exec(store.taskCreate, { subject: 'Blocker' }) as { task: TaskItem };
    const { task: blocked } = await exec(store.taskCreate, { subject: 'Blocked' }) as { task: TaskItem };

    await exec(store.taskUpdate, { taskId: blocked.id, addBlockedBy: [blocker.id] });
    await exec(store.taskUpdate, { taskId: blocker.id, status: 'completed' });

    const result = await exec(store.taskList, {}) as { tasks: Array<{ id: string; blockedBy?: string[] }> };
    const bSummary = result.tasks.find((t) => t.id === blocked.id)!;
    assert.equal(bSummary.blockedBy, undefined);
  });
});

// ── Persistence round-trip ─────────────────────────────────────────────────

describe('persistence', () => {
  test('new store loads tasks from previous session file', async () => {
    const store1 = createTaskStore('.', sessionId);
    const { task } = await exec(store1.taskCreate, { subject: 'Survive reload' }) as { task: TaskItem };
    await exec(store1.taskUpdate, { taskId: task.id, status: 'in_progress', owner: 'main' });

    // Create a new store with the same sessionId — should load persisted state
    const store2 = createTaskStore('.', sessionId);
    assert.equal(store2.items.size, 1);
    const loaded = store2.items.get(task.id)!;
    assert.equal(loaded.subject, 'Survive reload');
    assert.equal(loaded.status, 'in_progress');
    assert.equal(loaded.owner, 'main');
  });

  test('returns empty store for nonexistent session', async () => {
    const store = createTaskStore('.', `nonexistent-${crypto.randomUUID()}`);
    assert.equal(store.items.size, 0);
  });

  test('handles corrupted JSON gracefully', async () => {
    const filePath = taskFilePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '{{invalid json}}', 'utf-8');

    const store = createTaskStore('.', sessionId);
    assert.equal(store.items.size, 0);
  });
});
