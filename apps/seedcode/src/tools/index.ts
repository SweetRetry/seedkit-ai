import { z } from 'zod';
import { tool, type LanguageModel } from 'ai';
import { readFile } from './read.js';
import { computeDiff, writeFile } from './write.js';
import { computeEditDiff, applyEdit } from './edit.js';
import { globFiles } from './glob.js';
import { grepFiles } from './grep.js';
import { runBash, truncateBashOutput } from './bash.js';
import { webSearch, webFetch } from '@seedkit-ai/tools';
import { captureScreenshot, getDisplayList } from './screenshot.js';
import { createTaskStore } from './task.js';
import { loadSkillBody, type SkillEntry } from '../context/skills.js';
import { runDiagnostics, formatDiagnostics } from './diagnostics.js';
import { buildSpawnAgentTool } from './spawn-agent.js';

export type ToolName = 'read' | 'edit' | 'write' | 'glob' | 'grep' | 'bash' | 'webSearch' | 'webFetch' | 'screenshot' | 'taskCreate' | 'taskUpdate' | 'taskGet' | 'taskList' | 'askQuestion' | 'loadSkill' | 'spawnAgent';

export { createTaskStore };
export type { TaskStore, TaskItem, TaskStatus } from './task.js';

export type DiffHunkLine = { kind: 'context' | 'removed' | 'added'; text: string; lineNo?: number };

export type PendingConfirm = {
  toolName: ToolName;
  description: string;
  /** Unified diff hunk lines to show in confirmation */
  diffHunk?: DiffHunkLine[];
  /** Resolve with true=approved, false=denied */
  resolve: (approved: boolean) => void;
};

// Callback so the agent loop can request confirmation from the UI
export type ConfirmFn = (pending: PendingConfirm) => void;

export type PendingQuestionOption = {
  label: string;
  description?: string;
};

export type PendingQuestion = {
  question: string;
  /** Optional recommended options the agent proposes — user can pick one or type freely */
  options?: PendingQuestionOption[];
  /** Resolve with the user's answer string */
  resolve: (answer: string) => void;
};

// Callback so the agent loop can ask the user a free-text question
export type AskQuestionFn = (pending: PendingQuestion) => void;

/** Sentinel field present on all tool error responses. UI checks this to determine status. */
export interface ToolError {
  error: string;
}

export function isToolError(output: unknown): output is ToolError {
  return typeof output === 'object' && output !== null && 'error' in output;
}

export type TaskChangeFn = (items: import('./task.js').TaskItem[]) => void;

export function buildTools(opts: {
  cwd: string;
  confirm: ConfirmFn;
  askQuestion: AskQuestionFn;
  skipConfirm: boolean;
  taskStore: ReturnType<typeof createTaskStore>;
  availableSkills: SkillEntry[];
  model: LanguageModel;
  onTaskChange?: TaskChangeFn;
}) {
  const { cwd, confirm, askQuestion, skipConfirm, taskStore, availableSkills, model, onTaskChange } = opts;

  const requestConfirm = (
    toolName: ToolName,
    description: string,
    diffHunk?: DiffHunkLine[]
  ): Promise<boolean> => {
    if (skipConfirm) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      confirm({ toolName, description, diffHunk, resolve });
    });
  };

  // Wrap a task tool's execute to fire the onTaskChange callback
  function wrapTaskTool<T extends { execute?: (...args: unknown[]) => Promise<unknown> }>(t: T): T {
    if (!onTaskChange || !t.execute) return t;
    const original = t.execute;
    return {
      ...t,
      execute: async (...args: unknown[]) => {
        const result = await original(...args);
        onTaskChange(Array.from(taskStore.items.values()).filter((i) => i.status !== 'deleted'));
        return result;
      },
    };
  }

  return {
    read: tool({
      description:
        'Read a file. By default reads up to 2000 lines from the start. ' +
        'Use offset and limit to paginate through large files. ' +
        'Lines longer than 2000 chars are truncated. Returns cat -n formatted output with line numbers. ' +
        'For image files (.png/.jpg/.jpeg/.gif/.webp/.bmp), stores the image for display and returns a mediaId.',
      inputSchema: z.object({
        path: z.string().describe('Path to the file to read (absolute or relative to CWD)'),
        offset: z.number().int().min(0).optional().describe('Line offset to start reading from (0-based). Omit to start from the beginning.'),
        limit: z.number().int().min(1).optional().describe('Max number of lines to return (default: 2000).'),
      }),
      execute: async ({ path: filePath, offset, limit }): Promise<{ content: string; lineCount: number; warning?: string } | { mediaId: string; mediaType: string; byteSize: number } | ToolError> => {
        try {
          const result = readFile(filePath, offset, limit);
          if ('mediaId' in result) return result;
          const { content, lineCount, warning } = result;
          return { content, lineCount, ...(warning ? { warning } : {}) };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    edit: tool({
      description:
        'Apply a targeted find-and-replace patch to a file. old_string must match exactly once. Safer than write for modifying existing files.',
      inputSchema: z.object({
        path: z.string().describe('Path to the file to edit'),
        old_string: z.string().describe('Exact text to find — must appear exactly once in the file'),
        new_string: z.string().describe('Text to replace it with'),
      }),
      execute: async ({ path: filePath, old_string, new_string }): Promise<{ success: true; message: string; diagnostics?: string } | ToolError> => {
        try {
          const diff = computeEditDiff(filePath, old_string, new_string);
          if ('error' in diff) return diff;

          const approved = await requestConfirm('edit', `Edit ${filePath}`, diff.hunk);
          if (!approved) {
            return { error: 'User denied edit operation.' };
          }

          const result = applyEdit(filePath, old_string, new_string);
          if ('error' in result) return result;
          const diagOutput = formatDiagnostics(runDiagnostics(filePath, cwd));
          return { success: true, message: result.message, ...(diagOutput ? { diagnostics: diagOutput } : {}) };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    write: tool({
      description:
        'Write content to a file. Shows a diff summary before writing and waits for confirmation.',
      inputSchema: z.object({
        path: z.string().describe('Path to the file to write'),
        content: z.string().describe('Content to write to the file'),
      }),
      execute: async ({ path: filePath, content }): Promise<{ success: true; message: string; diagnostics?: string } | ToolError> => {
        try {
          const diff = computeDiff(filePath, content);
          const description =
            diff.oldContent === null
              ? `Create new file: ${filePath} (+${diff.added} lines)`
              : `Modify ${filePath}: +${diff.added} / -${diff.removed} lines`;

          const approved = await requestConfirm('write', description, diff.hunk);
          if (!approved) {
            return { error: 'User denied write operation.' };
          }

          writeFile(filePath, content);
          const baseMsg =
            diff.oldContent === null
              ? `Created ${filePath} (${diff.added} lines)`
              : `Updated ${filePath} (+${diff.added} / -${diff.removed})`;
          const diagOutput = formatDiagnostics(runDiagnostics(filePath, cwd));
          return { success: true, message: baseMsg, ...(diagOutput ? { diagnostics: diagOutput } : {}) };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    glob: tool({
      description: 'Match files using a glob pattern. Returns matching file paths and count.',
      inputSchema: z.object({
        pattern: z.string().describe('Glob pattern (e.g. "src/**/*.ts")'),
        cwd: z.string().optional().describe('Directory to search from (default: startup CWD)'),
      }),
      execute: async ({ pattern, cwd: overrideCwd }): Promise<{ files: string[]; count: number } | ToolError> => {
        try {
          return await globFiles(pattern, overrideCwd ?? cwd);
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    grep: tool({
      description:
        'Search file contents with a regex pattern. Returns matching lines with file and line number.',
      inputSchema: z.object({
        pattern: z.string().describe('Regex pattern to search for'),
        fileGlob: z.string().describe('Glob pattern to select which files to search'),
        cwd: z.string().optional().describe('Directory to search from (default: startup CWD)'),
      }),
      execute: async ({ pattern, fileGlob, cwd: overrideCwd }): Promise<{ matches: unknown[]; count: number; totalCount: number; truncated: boolean } | ToolError> => {
        try {
          return await grepFiles(pattern, fileGlob, overrideCwd ?? cwd);
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    bash: tool({
      description:
        'Run a shell command. Sandboxed: cannot escape the startup CWD, dangerous commands are blocked.',
      inputSchema: z.object({
        command: z.string().describe('Shell command to run'),
      }),
      execute: async ({ command }): Promise<{ stdout: string; stderr: string; exitCode: number } | ToolError> => {
        try {
          const approved = await requestConfirm('bash', `Run shell command: ${command}`);
          if (!approved) {
            return { error: 'User denied bash execution.' };
          }
          const result = runBash(command, cwd);
          return {
            ...result,
            stdout: truncateBashOutput(result.stdout),
            stderr: truncateBashOutput(result.stderr),
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    webSearch: tool({
      description:
        'Search the web using DuckDuckGo. Returns results with title, URL, and description. Use this when you need current information or documentation not in your context.',
      inputSchema: z.object({
        query: z.string().describe('Search query'),
        limit: z.number().int().min(1).max(10).optional().default(5).describe('Max results (default: 5)'),
      }),
      execute: async ({ query, limit }): Promise<{ query: string; results: { title: string; url: string; description: string }[] } | ToolError> => {
        try {
          return await webSearch(query, limit);
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    webFetch: tool({
      description:
        'Fetch a URL and extract its main content as Markdown. Use after webSearch to read documentation, blog posts, or any web page.',
      inputSchema: z.object({
        url: z.string().url().describe('URL to fetch'),
      }),
      execute: async ({ url }): Promise<{ url: string; title: string; markdown: string; truncated: boolean } | ToolError> => {
        try {
          return await webFetch(url);
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    screenshot: tool({
      description:
        'Capture a screenshot on macOS. The image is automatically compressed ' +
        '(resized to max 1280px long-edge, converted to JPEG) to minimise token usage. ' +
        'If displayId is omitted: auto-detects displays. Single display → captures directly. ' +
        'Multiple displays → returns the list so you can ask the user which to capture. ' +
        'Only supported on macOS; throws an error on other platforms.',
      inputSchema: z.object({
        displayId: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('1-based display index. Omit to auto-detect.'),
      }),
      execute: async ({ displayId }): Promise<
        | { mediaId: string; mediaType: 'image/jpeg'; byteSize: number; rawByteSize: number; displayId: number }
        | { displays: Array<{ id: number; description: string; isMain: boolean }>; count: number }
        | ToolError
      > => {
        try {
          if (displayId !== undefined) {
            return await captureScreenshot(displayId);
          }
          // Auto-detect: single display → capture, multiple → return list
          const { displays, count } = await getDisplayList();
          if (count === 1) {
            return await captureScreenshot(displays[0].id);
          }
          return { displays, count };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    askQuestion: tool({
      description:
        'Ask the user a clarifying question before proceeding. Use when you are uncertain about ' +
        'requirements, need the user to make a decision, or want to align on approach. ' +
        'You can optionally provide recommended options — the user may pick one or type a custom answer. ' +
        'Do NOT use this for simple yes/no confirmations (those use the built-in confirm flow).',
      inputSchema: z.object({
        question: z.string().describe('The question to ask the user'),
        options: z
          .array(
            z.object({
              label: z.string().describe('Short option label (the answer text)'),
              description: z.string().optional().describe('Optional elaboration shown under the label'),
            })
          )
          .optional()
          .describe('Recommended answer options for the user to choose from (they can still type freely)'),
      }),
      execute: async ({ question, options }): Promise<{ answer: string } | ToolError> => {
        return new Promise<{ answer: string } | ToolError>((resolve) => {
          askQuestion({
            question,
            options,
            resolve: (answer) => resolve({ answer }),
          });
        });
      },
    }),

    loadSkill: tool({
      description:
        'Load the full instructions for a skill by name. Call this when the user invokes a skill (e.g. /color-palette) to read its complete guidance before proceeding.',
      inputSchema: z.object({
        name: z.string().describe('The skill name to load (e.g. "color-palette")'),
      }),
      execute: async ({ name }): Promise<{ body: string; truncated: boolean } | ToolError> => {
        const skill = availableSkills.find((s) => s.name === name);
        if (!skill) {
          return { error: `Skill not found: "${name}". Available skills: ${availableSkills.map((s) => s.name).join(', ') || 'none'}` };
        }
        const result = loadSkillBody(skill);
        if (!result) return { error: `Could not read skill file for: "${name}"` };
        return result;
      },
    }),

    taskCreate: wrapTaskTool(taskStore.taskCreate),
    taskUpdate: wrapTaskTool(taskStore.taskUpdate),
    taskGet: taskStore.taskGet,
    taskList: taskStore.taskList,
    spawnAgent: buildSpawnAgentTool({ model, cwd, taskStore }),
  };
}

export type Tools = ReturnType<typeof buildTools>;
