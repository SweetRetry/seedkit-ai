import React, { useState } from 'react';
import { render } from 'ink';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './config/schema.js';
import { buildContext, type SkillEntry } from './context/index.js';
import { loadSession } from './sessions/index.js';
import { loadMcpConfig } from './mcp/config.js';
import { McpManager } from './mcp/manager.js';
import { ReplApp, type SavedReplState } from './ui/ReplApp.js';
import { SetupWizard } from './ui/SetupWizard.js';

interface ReplOptions {
  skipConfirm?: boolean;
  resumeSessionId?: string;
}

function App({
  config,
  version,
  skipConfirm,
  initialSkills,
  savedState,
  mcpManager,
  onExit,
  onOpenEditor,
}: {
  config: Config;
  version: string;
  skipConfirm: boolean;
  initialSkills: SkillEntry[];
  savedState?: SavedReplState;
  mcpManager?: McpManager;
  onExit: () => void;
  onOpenEditor: (filePath: string, saved: SavedReplState) => void;
}) {
  const [apiKey, setApiKey] = useState(config.apiKey ?? '');

  if (!apiKey) {
    return (
      <SetupWizard
        onDone={(key) => setApiKey(key)}
        onCancel={onExit}
      />
    );
  }

  const resolvedConfig: Config = { ...config, apiKey };

  return (
    <ReplApp
      config={resolvedConfig}
      version={version}
      apiKey={apiKey}
      onExit={onExit}
      onOpenEditor={onOpenEditor}
      skipConfirm={skipConfirm}
      initialSkills={initialSkills}
      savedState={savedState}
      mcpManager={mcpManager}
    />
  );
}

export async function startRepl(
  config: Config,
  version: string,
  opts: ReplOptions = {}
): Promise<void> {
  const cwd = process.cwd();
  const { skills: initialSkills } = buildContext(cwd);

  // Initialize MCP connections (parallel, failures are silent)
  const mcpConfig = loadMcpConfig(cwd);
  let mcpManager: McpManager | undefined;
  if (mcpConfig.servers.length > 0) {
    mcpManager = new McpManager();
    await mcpManager.connectAll(mcpConfig.servers);
  }

  // Build initial savedState from --resume if provided
  let initialSavedState: SavedReplState | undefined;
  if (opts.resumeSessionId) {
    const msgs = loadSession(cwd, opts.resumeSessionId);
    if (msgs.length > 0) {
      initialSavedState = {
        messages: msgs,
        sessionId: opts.resumeSessionId,
        turnCount: msgs.filter((m) => m.role === 'user').length,
        staticTurns: [],  // ReplApp.handleResumeSelect will rebuild these
        totalTokens: 0,
      };
    }
  }

  type PendingEditor = { filePath: string; saved: SavedReplState } | null;
  let pendingEditor: PendingEditor = null;

  const mount = (savedState?: SavedReplState): Promise<void> =>
    new Promise<void>((resolve) => {
      const { unmount } = render(
        <App
          config={config}
          version={version}
          skipConfirm={opts.skipConfirm ?? false}
          initialSkills={initialSkills}
          savedState={savedState}
          mcpManager={mcpManager}
          onExit={() => {
            unmount();
            resolve();
          }}
          onOpenEditor={(filePath, saved) => {
            pendingEditor = { filePath, saved };
            unmount();
            resolve();
          }}
        />,
        { exitOnCtrlC: false }
      );
    });

  // Loop: re-mount after returning from editor
  let restoreState: SavedReplState | undefined = initialSavedState;
  try {
    while (true) {
      await mount(restoreState);

      if (pendingEditor) {
        const { filePath, saved } = pendingEditor;
        pendingEditor = null;
        restoreState = saved;
        // Ensure memory file's parent dir exists before opening editor
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const editor = process.env.EDITOR || process.env.VISUAL || 'vi';
        spawnSync(editor, [filePath], { stdio: 'inherit' });
        // Loop continues — re-mount the REPL with restored state
      } else {
        // Normal exit
        break;
      }
    }
  } finally {
    await mcpManager?.closeAll();
  }
}
