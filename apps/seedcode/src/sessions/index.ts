import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ModelMessage } from 'ai';

// ── Storage layout ───────────────────────────────────────────────────────────
//  ~/.seedcode/projects/{cwd-slug}/
//    {uuid}.jsonl   — one JSON record per line, each containing:
//                     { type, sessionId, uuid, parentUuid, cwd, gitBranch,
//                       timestamp, isSidechain, message: ModelMessage }
//
//  No separate index file — metadata is derived from JSONL content directly.
//  This mirrors ~/.claude/projects/ design: index stays in sync by construction.

const SEEDCODE_DIR = path.join(os.homedir(), '.seedcode');

/** Convert an absolute CWD path to the directory slug, e.g. /Users/foo/proj → -Users-foo-proj */
function cwdSlug(cwd: string): string {
  return cwd.replace(/\//g, '-');
}

function projectDir(cwd: string): string {
  return path.join(SEEDCODE_DIR, 'projects', cwdSlug(cwd));
}

function sessionPath(cwd: string, sessionId: string): string {
  return path.join(projectDir(cwd), `${sessionId}.jsonl`);
}

// ── Wire format ───────────────────────────────────────────────────────────────

interface SessionRecord {
  type: 'user' | 'assistant' | 'tool';
  sessionId: string;
  uuid: string;
  parentUuid: string | null;
  cwd: string;
  gitBranch: string;
  timestamp: string;
  isSidechain: boolean;
  message: ModelMessage;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SessionEntry {
  sessionId: string;
  firstPrompt: string;
  messageCount: number;
  created: string;   // ISO — timestamp of first record
  modified: string;  // ISO — timestamp of last record
  gitBranch: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function readGitBranch(cwd: string): string {
  try {
    const headFile = path.join(cwd, '.git', 'HEAD');
    const head = fs.readFileSync(headFile, 'utf-8').trim();
    return head.startsWith('ref: refs/heads/')
      ? head.slice('ref: refs/heads/'.length)
      : head.slice(0, 8);
  } catch {
    return '';
  }
}

function firstPromptFromRecords(records: SessionRecord[]): string {
  const first = records.find((r) => r.message.role === 'user');
  if (!first) return '';
  const { content } = first.message;
  if (typeof content === 'string') return content.slice(0, 120);
  if (Array.isArray(content)) {
    const text = content
      .filter((p): p is { type: 'text'; text: string } => (p as { type: string }).type === 'text')
      .map((p) => p.text)
      .join(' ');
    return text.slice(0, 120);
  }
  return '';
}

/** Read all records from a JSONL file. Returns [] on any error. */
function readRecords(filePath: string): SessionRecord[] {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as SessionRecord);
  } catch {
    return [];
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Create a new session and return its ID. */
export function createSession(cwd: string): string {
  fs.mkdirSync(projectDir(cwd), { recursive: true });
  return randomUUID();
}

/**
 * Persist the current message list to disk.
 * Each message is written as a self-contained SessionRecord (mirrors Claude Code format).
 */
export function saveSession(
  cwd: string,
  sessionId: string,
  messages: ModelMessage[],
): void {
  if (messages.length === 0) return;

  fs.mkdirSync(projectDir(cwd), { recursive: true });

  const gitBranch = readGitBranch(cwd);
  const now = new Date().toISOString();

  // Load existing records to preserve original timestamps
  const existing = readRecords(sessionPath(cwd, sessionId));
  const existingByIdx = new Map(existing.map((r, i) => [i, r]));

  const records: SessionRecord[] = messages.map((message, i) => {
    const prev = existingByIdx.get(i);
    return {
      type: message.role as 'user' | 'assistant' | 'tool',
      sessionId,
      uuid: prev?.uuid ?? randomUUID(),
      parentUuid: i === 0 ? null : (existingByIdx.get(i - 1)?.uuid ?? null),
      cwd,
      gitBranch,
      timestamp: prev?.timestamp ?? now,
      isSidechain: false,
      message,
    };
  });

  const jsonl = records.map((r) => JSON.stringify(r)).join('\n');
  fs.writeFileSync(sessionPath(cwd, sessionId), jsonl, 'utf-8');
}

/** Load messages from a saved session JSONL file. Returns [] if not found. */
export function loadSession(cwd: string, sessionId: string): ModelMessage[] {
  return readRecords(sessionPath(cwd, sessionId)).map((r) => r.message);
}

/**
 * List all sessions for the given CWD by scanning the project directory.
 * Derives metadata from JSONL content — no separate index file needed.
 * Returns sessions sorted newest-first.
 */
export function listSessions(cwd: string): SessionEntry[] {
  const dir = projectDir(cwd);
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }

  const entries: SessionEntry[] = [];

  for (const file of files) {
    const sessionId = file.slice(0, -6); // strip .jsonl
    const records = readRecords(path.join(dir, file));
    if (records.length === 0) continue;

    entries.push({
      sessionId,
      firstPrompt: firstPromptFromRecords(records),
      messageCount: records.length,
      created: records[0].timestamp,
      modified: records[records.length - 1].timestamp,
      gitBranch: records[records.length - 1].gitBranch,
    });
  }

  return entries.sort((a, b) => b.modified.localeCompare(a.modified));
}

/**
 * Resolve a session ID from a prefix (first 8 chars is usually enough).
 * Returns the full session ID or null if not found / ambiguous.
 */
export function resolveSessionId(cwd: string, prefix: string): string | null {
  const entries = listSessions(cwd);
  const matches = entries.filter((e) => e.sessionId.startsWith(prefix));
  if (matches.length === 1) return matches[0].sessionId;
  return null;
}

/** Delete a session's JSONL file. */
export function deleteSession(cwd: string, sessionId: string): boolean {
  try {
    fs.unlinkSync(sessionPath(cwd, sessionId));
    return true;
  } catch {
    return false;
  }
}
