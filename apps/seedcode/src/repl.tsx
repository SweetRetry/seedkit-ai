import React, { useState } from 'react';
import { render } from 'ink';
import { createSeed } from '@seedkit-ai/ai-sdk-provider';
import type { Config } from './config/schema.js';
import { buildContext, type SkillEntry } from './context/index.js';
import { ReplApp } from './ui/ReplApp.js';
import { SetupWizard } from './ui/SetupWizard.js';

interface ReplOptions {
  skipConfirm?: boolean;
}

function App({
  config,
  version,
  skipConfirm,
  initialSkills,
  onExit,
}: {
  config: Config;
  version: string;
  skipConfirm: boolean;
  initialSkills: SkillEntry[];
  onExit: () => void;
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
  const seed = createSeed({ apiKey });

  return (
    <ReplApp
      config={resolvedConfig}
      version={version}
      seed={seed}
      onExit={onExit}
      skipConfirm={skipConfirm}
      initialSkills={initialSkills}
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

  await new Promise<void>((resolve) => {
    const { unmount } = render(
      <App
        config={config}
        version={version}
        skipConfirm={opts.skipConfirm ?? false}
        initialSkills={initialSkills}
        onExit={() => {
          unmount();
          resolve();
        }}
      />,
      { exitOnCtrlC: false }
    );
  });
}
