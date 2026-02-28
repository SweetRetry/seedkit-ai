import type { Config } from '../config/schema.js';
import type { SkillEntry } from '../context/index.js';
import { listSessions, resolveSessionId } from '../sessions/index.js';

export const AVAILABLE_MODELS = [
  'doubao-seed-2-0-pro-260215',
  'doubao-seed-2-0-lite-260215',
  'doubao-seed-2-0-mini-260215',
  'doubao-seed-2-0-code-preview-260215',
  'doubao-seed-1-8-251228',
  'doubao-seed-code-preview-251028',
] as const;

export type SlashCommandResult =
  | { type: 'handled'; output?: string }
  | { type: 'exit' }
  | { type: 'clear' }
  | { type: 'model_change'; model: string }
  | { type: 'model_picker' }
  | { type: 'thinking_toggle' }
  | { type: 'compact' }
  | { type: 'resume'; sessionId: string }
  | { type: 'resume_picker' }
  | { type: 'not_command' };

export interface SessionState {
  config: Config;
  turnCount: number;
  version: string;
  totalTokens: number;
  availableSkills: SkillEntry[];
  sessionId: string;
  cwd: string;
  systemPrompt: string;
  /** Serialised byte length of the current message history (for token estimation) */
  messageHistoryChars: number;
}

export function handleSlashCommand(
  input: string,
  state: SessionState
): SlashCommandResult {
  if (!input.startsWith('/')) return { type: 'not_command' };

  const raw = input.slice(1).trim();
  const [cmd, ...args] = raw.split(/\s+/);

  switch (cmd.toLowerCase()) {
    case 'exit':
    case 'quit':
      return { type: 'exit' };

    case 'help':
      return { type: 'handled', output: buildHelp() };

    case 'status':
      return { type: 'handled', output: buildStatus(state) };

    case 'clear':
      return { type: 'clear' };

    case 'model': {
      const model = args[0];
      if (!model) return { type: 'model_picker' };
      return { type: 'model_change', model };
    }

    case 'thinking':
      return { type: 'thinking_toggle' };

    case 'skills':
      return { type: 'handled', output: buildSkillsList(state) };

    case 'context':
      return { type: 'handled', output: buildContextInfo(state) };

    case 'compact':
      return { type: 'compact' };

    case 'sessions':
      return { type: 'handled', output: buildSessionsList(state) };

    case 'resume': {
      const prefix = args[0];
      if (!prefix) return { type: 'resume_picker' };
      const fullId = resolveSessionId(state.cwd, prefix);
      if (!fullId) return { type: 'handled', output: `No session found matching: ${prefix}` };
      return { type: 'resume', sessionId: fullId };
    }

    default:
      // /skills:<name> and any unrecognised slash-prefixed text are passed through as normal messages
      return { type: 'not_command' };
  }
}

export const SLASH_COMMANDS: Array<{ name: string; args?: string; desc: string }> = [
  { name: 'help',     desc: 'show commands' },
  { name: 'status',   desc: 'session info + token usage' },
  { name: 'context',  desc: 'show system prompt token breakdown' },
  { name: 'clear',    desc: 'reset history, reload context' },
  { name: 'sessions', desc: 'list past sessions for this directory' },
  { name: 'resume',   args: '<id>', desc: 'resume a past session' },
  { name: 'model',    args: '<id>', desc: 'switch model' },
  { name: 'thinking', desc: 'toggle extended thinking' },
  { name: 'skills',   desc: 'list skills · /skills:<name> to activate' },
  { name: 'compact',  desc: 'summarise history' },
  { name: 'exit',     desc: 'end session' },
];

function buildHelp(): string {
  const lines = SLASH_COMMANDS.map((c) => {
    const cmd = c.args ? `/${c.name} ${c.args}` : `/${c.name}`;
    return `  ${cmd.padEnd(18)} ${c.desc}`;
  });
  return lines.join('\n');
}

function buildStatus(state: SessionState): string {
  const { config, turnCount, version, totalTokens, sessionId } = state;
  const maskedKey = config.apiKey
    ? config.apiKey.slice(0, 6) + '...' + config.apiKey.slice(-4)
    : '✗ not set';

  return [
    'Session Status:',
    `  Version:        ${version}`,
    `  Session ID:     ${sessionId.slice(0, 8)}`,
    `  Model:          ${config.model}`,
    `  API Key:        ${maskedKey}`,
    `  Thinking:       ${config.thinking ? 'on' : 'off'}`,
    `  Turns:          ${turnCount}`,
    `  Tokens (est):   ${totalTokens > 0 ? totalTokens.toLocaleString() : 'n/a'}`,
  ].join('\n');
}

function buildSkillsList(state: SessionState): string {
  const { availableSkills } = state;

  if (availableSkills.length === 0) {
    return 'No skills. Add SKILL.md files to ~/.agents/skills/ or .seedcode/skills/';
  }

  return availableSkills
    .map((s) => {
      const scope = s.scope === 'project' ? 'p' : 'g';
      return `  /skills:${s.name} [${scope}]`;
    })
    .join('\n');
}

function buildContextInfo(state: SessionState): string {
  const { systemPrompt, availableSkills, messageHistoryChars, turnCount } = state;

  const est = (chars: number) => Math.ceil(chars / 4);
  const bar = (tokens: number, scale: number) =>
    '█'.repeat(Math.min(Math.round(tokens / scale), 40));

  const systemTokens = est(systemPrompt.length);
  const historyTokens = est(messageHistoryChars);
  const totalTokens = systemTokens + historyTokens;
  const contextLimit = 256_000;
  const pct = ((totalTokens / contextLimit) * 100).toFixed(1);

  const lines: string[] = ['Context Window Usage:', ''];

  // ── Top-level summary ──────────────────────────────────────────────────
  const scale = Math.max(Math.ceil(totalTokens / 400), 50);
  lines.push(`  ${'System prompt'.padEnd(22)} ~${systemTokens.toLocaleString().padStart(6)} tok  ${bar(systemTokens, scale)}`);
  lines.push(`  ${'Message history'.padEnd(22)} ~${historyTokens.toLocaleString().padStart(6)} tok  ${bar(historyTokens, scale)}`);
  lines.push('');
  lines.push(`  ${'Total (est)'.padEnd(22)} ~${totalTokens.toLocaleString().padStart(6)} tok  (${pct}% of 256k)`);
  lines.push(`  ${'Turns'.padEnd(22)}  ${turnCount}`);

  // ── System prompt breakdown ────────────────────────────────────────────
  const sections = systemPrompt.split(/\n\n---\n\n/);
  const sectionLabels = [
    'Base prompt',
    'Global AGENTS.md',
    'Project AGENTS.md',
    'Skills (descriptions)',
  ];

  lines.push('');
  lines.push('  System Prompt Breakdown:');
  sections.forEach((sec, i) => {
    const label = sectionLabels[i] ?? `Section ${i + 1}`;
    const tokens = est(sec.length);
    lines.push(`    ${label.padEnd(20)} ~${tokens.toLocaleString().padStart(5)} tok`);
  });

  // ── Skills detail ──────────────────────────────────────────────────────
  if (availableSkills.length > 0) {
    lines.push('');
    lines.push('  Skill descriptions:');
    for (const s of availableSkills) {
      const skTokens = est(s.name.length + s.description.length);
      lines.push(`    [${s.scope[0]}] ${s.name.padEnd(24)} ~${skTokens} tok`);
    }
    lines.push('  (Full skill body loaded on-demand via loadSkill)');
  }

  lines.push('');
  lines.push('  Note: ~4 chars/token estimate. Actual billed tokens may differ.');
  return lines.join('\n');
}

function buildSessionsList(state: SessionState): string {
  const sessions = listSessions(state.cwd);
  if (sessions.length === 0) {
    return 'No saved sessions for this directory.';
  }

  const current = state.sessionId;
  const lines = ['Past sessions (newest first):', ''];
  for (const s of sessions) {
    const isCurrent = s.sessionId === current;
    const marker = isCurrent ? ' ← current' : '';
    const date = new Date(s.modified).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    const preview = s.firstPrompt.length > 60
      ? s.firstPrompt.slice(0, 60) + '…'
      : s.firstPrompt;
    const branch = s.gitBranch ? `  [${s.gitBranch}]` : '';
    lines.push(`  ${s.sessionId.slice(0, 8)}  ${date}  (${s.messageCount} msgs)${branch}${marker}`);
    if (preview) lines.push(`           ${preview}`);
  }
  lines.push('');
  lines.push('  /resume <id>  to restore a session');
  return lines.join('\n');
}
