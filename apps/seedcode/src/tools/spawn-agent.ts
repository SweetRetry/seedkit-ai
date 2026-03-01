import { z } from 'zod';
import { tool, ToolLoopAgent, stepCountIs, type LanguageModel } from 'ai';
import { readFile } from './read.js';
import { globFiles } from './glob.js';
import { grepFiles } from './grep.js';
import { runBash, truncateBashOutput } from './bash.js';
import { webSearch, webFetch } from '@seedkit-ai/tools';
import type { TaskStore } from './task.js';
import type { ToolError } from './index.js';

const MAX_SUBAGENT_OUTPUT_CHARS = 8_000;

const MAX_SUBAGENT_STEPS = 10;

const SUB_AGENT_SYSTEM_PROMPT = `<persona>
You are a focused research sub-agent spawned by a parent coding assistant.
Your output is consumed by the parent agent, not shown to the user.
Communicate facts, not conversation — no greetings, hedging, or filler.
</persona>

<context>
Available tools (9 total, all read-only):
  Codebase:  glob (find files by pattern), grep (search contents by regex), read (read file regions)
  Execution: bash (read-only shell — git log, ls, type-check, etc.)
  Web:       webSearch (DuckDuckGo), webFetch (fetch URL as Markdown)
  Tasks:     taskList (list shared tasks), taskGet (task details), taskUpdate (update status/progress)

Hard limits:
- Tool steps: ${MAX_SUBAGENT_STEPS} maximum — plan your search before executing
- Output: ${MAX_SUBAGENT_OUTPUT_CHARS} chars maximum — every sentence must carry information
- Access: read-only — you cannot edit, write, or create files
</context>

<task>
Complete the assigned subtask and return structured findings.

Tool selection — follow this decision order:
1. Need to find files by name/path? → glob
2. Need to find a symbol, string, or pattern in code? → grep (with targeted fileGlob like "src/**/*.ts")
3. Need to read file content? → read (use offset/limit for files > 200 lines)
4. Need git history, directory listing, or type-check output? → bash
5. Need external documentation or current info? → webSearch → webFetch
6. Need shared context from parent/sibling agents? → taskList / taskGet

Search strategy:
1. Start broad: glob or grep to find candidate files
2. Narrow: read the specific regions that matter
3. Parallelize: if you need 3 searches, call them in one step — do not serialize

Task coordination:
- Check taskList at start if the task description references shared work
- Use taskUpdate to mark your assigned task in_progress when starting, completed when done
</task>

<constraints>
- Do NOT use bash for tasks that glob, grep, or read can handle
- Do NOT read entire large files — use grep to find line numbers first, then read that region
- Do NOT output raw file contents — summarize findings with file paths and line numbers
- When you cannot find what was asked: state clearly what you searched (patterns, globs, files read) so the parent can adjust
</constraints>

<format>
Structure your final response as:

**Finding**: [direct answer in 1-2 sentences]

**Evidence**:
- file_path:line — relevant detail
- file_path:line — relevant detail

**Notes** (optional): [caveats, related findings, or suggestions for the parent]
</format>`;


/**
 * Build a read-only tool set for sub-agents.
 * Excludes edit/write/confirm to avoid nested confirmation flows.
 * Includes taskList/taskGet/taskUpdate for shared task coordination.
 */
function buildSubAgentTools(cwd: string, taskStore: TaskStore) {
  return {
    read: tool({
      description: 'Read a file (up to 2000 lines by default). Use offset/limit for large files.',
      inputSchema: z.object({
        path: z.string(),
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).optional(),
      }),
      execute: async ({ path: filePath, offset, limit }) => {
        try { return readFile(filePath, offset, limit); }
        catch (err) { return { error: err instanceof Error ? err.message : String(err) }; }
      },
    }),
    glob: tool({
      description: 'Match files using a glob pattern.',
      inputSchema: z.object({
        pattern: z.string(),
        cwd: z.string().optional(),
      }),
      execute: async ({ pattern, cwd: overrideCwd }) => {
        try { return await globFiles(pattern, overrideCwd ?? cwd); }
        catch (err) { return { error: err instanceof Error ? err.message : String(err) }; }
      },
    }),
    grep: tool({
      description: 'Search file contents with a regex pattern.',
      inputSchema: z.object({
        pattern: z.string(),
        fileGlob: z.string(),
        cwd: z.string().optional(),
      }),
      execute: async ({ pattern, fileGlob, cwd: overrideCwd }) => {
        try { return await grepFiles(pattern, fileGlob, overrideCwd ?? cwd); }
        catch (err) { return { error: err instanceof Error ? err.message : String(err) }; }
      },
    }),
    bash: tool({
      description: 'Run a read-only shell command (no file modifications).',
      inputSchema: z.object({ command: z.string() }),
      execute: async ({ command }) => {
        try {
          const result = runBash(command, cwd);
          return {
            ...result,
            stdout: truncateBashOutput(result.stdout),
            stderr: truncateBashOutput(result.stderr),
          };
        }
        catch (err) { return { error: err instanceof Error ? err.message : String(err) }; }
      },
    }),
    webSearch: tool({
      description: 'Search the web using DuckDuckGo.',
      inputSchema: z.object({
        query: z.string(),
        limit: z.number().int().min(1).max(10).optional().default(5),
      }),
      execute: async ({ query, limit }) => {
        try { return await webSearch(query, limit); }
        catch (err) { return { error: err instanceof Error ? err.message : String(err) }; }
      },
    }),
    webFetch: tool({
      description: 'Fetch a URL and extract its main content as Markdown.',
      inputSchema: z.object({ url: z.string().url() }),
      execute: async ({ url }) => {
        try { return await webFetch(url); }
        catch (err) { return { error: err instanceof Error ? err.message : String(err) }; }
      },
    }),
    // Shared task tools — sub-agents can read and update tasks, but NOT create new ones
    taskList: taskStore.taskList,
    taskGet: taskStore.taskGet,
    taskUpdate: taskStore.taskUpdate,
  };
}

/**
 * Build the spawnAgent tool.
 * Sub-agents share the same model, CWD, and task store but run in isolation (no shared messages).
 * Multiple spawnAgent calls in a single step execute in parallel via AI SDK's parallel tool calls.
 */
export function buildSpawnAgentTool(opts: { model: LanguageModel; cwd: string; taskStore: TaskStore }) {
  const { model, cwd, taskStore } = opts;

  return tool({
    description:
      'Spawn an isolated sub-agent to handle an independent subtask in parallel. ' +
      'The sub-agent has access to read, glob, grep, bash (read-only), webSearch, webFetch, and shared task tools (taskList, taskGet, taskUpdate). ' +
      'Use this to parallelize independent research or exploration tasks. ' +
      'Do NOT use for tasks that require file edits or user confirmation — do those in the main agent. ' +
      'Returns the sub-agent\'s final answer as a string.',
    inputSchema: z.object({
      task: z.string().describe('Complete, self-contained description of the subtask to execute'),
      context: z.string().optional().describe('Any relevant context the sub-agent needs (file paths, constraints, etc.)'),
    }),
    execute: async ({ task, context }): Promise<{ result: string } | ToolError> => {
      try {
        const subAgent = new ToolLoopAgent({
          model,
          instructions: SUB_AGENT_SYSTEM_PROMPT,
          tools: buildSubAgentTools(cwd, taskStore),
          stopWhen: stepCountIs(MAX_SUBAGENT_STEPS),
        });

        const prompt = context
          ? `Context:\n${context}\n\nTask:\n${task}`
          : task;

        const result = await subAgent.generate({ prompt });
        let text = result.text ?? '(sub-agent returned no text)';
        if (text.length > MAX_SUBAGENT_OUTPUT_CHARS) {
          text = text.slice(0, MAX_SUBAGENT_OUTPUT_CHARS) + '\n\n[output truncated — exceeded 8k char limit]';
        }
        return { result: text };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  });
}
