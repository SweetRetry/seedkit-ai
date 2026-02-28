import { z } from 'zod';
import { tool, ToolLoopAgent, stepCountIs, type LanguageModel } from 'ai';
import { readFile } from './read.js';
import { globFiles } from './glob.js';
import { grepFiles } from './grep.js';
import { runBash } from './bash.js';
import { webSearch, webFetch } from '@seedkit-ai/tools';
import type { ToolError } from './index.js';

const MAX_SUBAGENT_STEPS = 10;

/**
 * Build a read-only tool set for sub-agents.
 * Excludes edit/write/confirm to avoid nested confirmation flows.
 */
function buildSubAgentTools(cwd: string) {
  return {
    read: tool({
      description: 'Read the contents of a file.',
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path: filePath }) => {
        try { return readFile(filePath); }
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
        try { return runBash(command, cwd); }
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
  };
}

/**
 * Build the spawnAgent tool.
 * Sub-agents share the same model and CWD but run in isolation (no shared messages).
 * Multiple spawnAgent calls in a single step execute in parallel via AI SDK's parallel tool calls.
 */
export function buildSpawnAgentTool(model: LanguageModel, cwd: string) {
  return tool({
    description:
      'Spawn an isolated sub-agent to handle an independent subtask in parallel. ' +
      'The sub-agent has access to read, glob, grep, bash (read-only), webSearch, and webFetch. ' +
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
          instructions:
            'You are a focused sub-agent. Complete the assigned task precisely and return your findings. ' +
            'Be concise — your output will be consumed by a parent agent, not shown directly to the user.',
          tools: buildSubAgentTools(cwd),
          stopWhen: stepCountIs(MAX_SUBAGENT_STEPS),
        });

        const prompt = context
          ? `Context:\n${context}\n\nTask:\n${task}`
          : task;

        const result = await subAgent.generate({ prompt });
        return { result: result.text ?? '(sub-agent returned no text)' };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  });
}
