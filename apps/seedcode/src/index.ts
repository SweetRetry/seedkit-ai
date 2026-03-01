#!/usr/bin/env node
import { Command } from 'commander';
import { loadConfig } from './config/index.js';
import { PLANS, type Plan } from './config/schema.js';
import { startRepl } from './repl.js';

const VERSION = '0.0.1';

const program = new Command()
  .name('seedcode')
  .description('AI coding assistant powered by ByteDance Seed 2.0')
  .version(VERSION, '-v, --version')
  .option('-m, --model <id>', 'Model to use', 'doubao-seed-1-8-251228')
  .option('-k, --api-key <key>', 'API key (overrides ARK_API_KEY env var)')
  .option('--thinking', 'Enable extended thinking mode')
  .option('--plan <plan>', 'API plan: api (default) or coding', 'api')
  .option(
    '--dangerously-skip-permissions',
    'Skip all tool confirmation prompts (CI use only, blocked when stdin is TTY)'
  )
  .addHelpText(
    'after',
    `
Slash commands (in session):
  /help                 List available commands
  /status               Show current session status
  /clear                Clear conversation history
  /model <id>           Switch model mid-session
  /plan <api|coding>    Switch API plan mid-session
  /thinking             Toggle thinking mode on/off
  /exit, /quit          End the session
  `
  );

async function main(): Promise<void> {
  program.parse();
  const opts = program.opts<{
    model: string;
    apiKey?: string;
    thinking?: boolean;
    plan?: string;
    dangerouslySkipPermissions?: boolean;
  }>();

  // Safety check: --dangerously-skip-permissions is blocked when stdin is a real TTY
  if (opts.dangerouslySkipPermissions && process.stdin.isTTY) {
    process.stderr.write(
      'Error: --dangerously-skip-permissions is blocked when stdin is a real TTY.\n' +
        'This flag is intended for CI/non-interactive environments only.\n'
    );
    process.exit(1);
  }

  const plan = opts.plan as Plan | undefined;
  if (plan && !PLANS.includes(plan)) {
    process.stderr.write(`Error: invalid plan "${plan}". Must be one of: ${PLANS.join(', ')}\n`);
    process.exit(1);
  }

  const config = loadConfig({
    model: opts.model,
    apiKey: opts.apiKey,
    thinking: opts.thinking,
    plan,
  });

  await startRepl(config, VERSION, {
    skipConfirm: opts.dangerouslySkipPermissions ?? false,
  });
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
