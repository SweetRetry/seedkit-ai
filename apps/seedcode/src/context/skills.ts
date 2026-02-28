import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';

const FrontmatterSchema = z.object({
  name: z.string(),
  description: z.string(),
});

export interface SkillEntry {
  name: string;
  description: string;
  scope: 'global' | 'project';
  skillMdPath: string;
}

export interface SkillsResult {
  skills: SkillEntry[];
  warnings: string[];
}

/**
 * Parse YAML frontmatter from a SKILL.md file.
 * Expected format:
 * ---
 * name: my-skill
 * description: What this skill does
 * ---
 */
function parseFrontmatter(content: string): { name?: string; description?: string } | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;

  const yaml = match[1];
  const result: Record<string, string> = {};

  let currentKey: string | null = null;
  let isFolded = false;
  const foldedLines: string[] = [];

  const flushFolded = () => {
    if (currentKey && isFolded) {
      result[currentKey] = foldedLines.join(' ').replace(/\s+/g, ' ').trim();
    }
    foldedLines.length = 0;
    isFolded = false;
  };

  for (const line of yaml.split('\n')) {
    // Continuation line for a folded scalar (starts with whitespace)
    if (isFolded && /^\s+\S/.test(line)) {
      foldedLines.push(line.trim());
      continue;
    }

    // End of folded block — flush before processing new key
    if (isFolded) flushFolded();

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    if (!key) continue;

    const rawValue = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');

    if (rawValue === '>') {
      // YAML folded block scalar
      currentKey = key;
      isFolded = true;
    } else {
      currentKey = key;
      result[key] = rawValue;
    }
  }

  if (isFolded) flushFolded();

  return result;
}

function scanSkillsDir(dir: string, scope: 'global' | 'project'): SkillEntry[] {
  if (!fs.existsSync(dir)) return [];

  const entries: SkillEntry[] = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const skillMdPath = path.join(dir, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) continue;

    const content = fs.readFileSync(skillMdPath, 'utf-8');
    const fm = parseFrontmatter(content);
    if (!fm) continue;

    const parsed = FrontmatterSchema.safeParse(fm);
    if (!parsed.success) continue;

    entries.push({
      name: parsed.data.name,
      description: parsed.data.description,
      scope,
      skillMdPath,
    });
  }

  return entries;
}

const MAX_SKILLS_DESCRIPTION_TOKENS = 2000;
const CHARS_PER_TOKEN = 4;

/**
 * Scan `~/.agents/skills/` (global) and `.seedcode/skills/` (project-local).
 * Project-local skills take precedence on name conflict.
 * Returns names + descriptions only (for startup budget). Full body loaded on demand.
 */
export function discoverSkills(cwd: string): SkillsResult {
  const warnings: string[] = [];

  const globalDir = path.join(os.homedir(), '.agents', 'skills');
  const projectDir = path.join(cwd, '.seedcode', 'skills');

  const globalSkills = scanSkillsDir(globalDir, 'global');
  const projectSkills = scanSkillsDir(projectDir, 'project');

  // Project takes precedence on name conflict
  const seen = new Set<string>();
  const merged: SkillEntry[] = [];

  for (const skill of [...projectSkills, ...globalSkills]) {
    if (!seen.has(skill.name)) {
      seen.add(skill.name);
      merged.push(skill);
    }
  }

  // Token budget check for descriptions
  const descTotal = merged.reduce((acc, s) => acc + s.name.length + s.description.length + 10, 0);
  const estimatedTokens = Math.ceil(descTotal / CHARS_PER_TOKEN);

  if (estimatedTokens > MAX_SKILLS_DESCRIPTION_TOKENS) {
    warnings.push(
      `Skills descriptions exceed ~2k token budget (estimated ~${estimatedTokens} tokens). Some skills may be dropped.`
    );
    // Drop from the end (global skills already sorted lower priority)
    let budget = MAX_SKILLS_DESCRIPTION_TOKENS * CHARS_PER_TOKEN;
    const trimmed: SkillEntry[] = [];
    for (const skill of merged) {
      const cost = skill.name.length + skill.description.length + 10;
      if (budget >= cost) {
        trimmed.push(skill);
        budget -= cost;
      }
    }
    return { skills: trimmed, warnings };
  }

  return { skills: merged, warnings };
}

/**
 * Load the full SKILL.md body for a skill (≤8k tokens).
 * Returns body text (without frontmatter), or null if not found.
 */
export function loadSkillBody(skill: SkillEntry): { body: string; truncated: boolean } | null {
  if (!fs.existsSync(skill.skillMdPath)) return null;

  const content = fs.readFileSync(skill.skillMdPath, 'utf-8');

  // Strip frontmatter
  const body = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '').trim();

  const maxChars = 8000 * CHARS_PER_TOKEN;
  if (body.length > maxChars) {
    return { body: body.slice(0, maxChars), truncated: true };
  }

  return { body, truncated: false };
}
