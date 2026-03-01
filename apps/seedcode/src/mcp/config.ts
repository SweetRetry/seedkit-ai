import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface McpServerConfig {
  name: string;
  type: 'stdio' | 'http';
  // stdio
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  // http
  url?: string;
  headers?: Record<string, string>;
}

export interface McpConfig {
  servers: McpServerConfig[];
}

/**
 * Expand `${VAR}` and `${VAR:-default}` in a string using process.env.
 * Does NOT invoke a shell — pure string replacement.
 */
export function expandEnvVars(str: string): string {
  return str.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
    const sepIdx = expr.indexOf(':-');
    if (sepIdx !== -1) {
      const varName = expr.slice(0, sepIdx);
      const fallback = expr.slice(sepIdx + 2);
      return process.env[varName] ?? fallback;
    }
    return process.env[expr] ?? '';
  });
}

function expandEnvInRecord(rec: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) {
    out[k] = expandEnvVars(v);
  }
  return out;
}

function parseConfigFile(filePath: string): McpServerConfig[] {
  if (!existsSync(filePath)) return [];

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return [];
  }

  if (!raw || typeof raw !== 'object') return [];

  // Support two shapes:
  //   { "mcpServers": { "name": { ... } } }  (Claude Code / VS Code style)
  //   { "servers": { "name": { ... } } }
  const obj = raw as Record<string, unknown>;
  const serversObj =
    (obj.mcpServers as Record<string, unknown> | undefined) ??
    (obj.servers as Record<string, unknown> | undefined);

  if (!serversObj || typeof serversObj !== 'object') return [];

  const results: McpServerConfig[] = [];
  for (const [name, cfg] of Object.entries(serversObj)) {
    if (!cfg || typeof cfg !== 'object') continue;
    const c = cfg as Record<string, unknown>;

    const type =
      c.type === 'http' || c.type === 'sse'
        ? 'http'
        : c.url && !c.command
          ? 'http'
          : 'stdio';

    const server: McpServerConfig = { name, type };

    if (type === 'stdio') {
      if (typeof c.command === 'string') server.command = expandEnvVars(c.command);
      if (Array.isArray(c.args))
        server.args = c.args.filter((a): a is string => typeof a === 'string').map(expandEnvVars);
      if (c.env && typeof c.env === 'object')
        server.env = expandEnvInRecord(c.env as Record<string, string>);
      if (typeof c.cwd === 'string') server.cwd = expandEnvVars(c.cwd);
    } else {
      if (typeof c.url === 'string') server.url = expandEnvVars(c.url);
      if (c.headers && typeof c.headers === 'object')
        server.headers = expandEnvInRecord(c.headers as Record<string, string>);
    }

    results.push(server);
  }
  return results;
}

/**
 * Load MCP config from project-level `{cwd}/.seedcode/mcp.json` and user-level `~/.seedcode/mcp.json`.
 * Project config takes precedence (overrides user config by server name).
 */
export function loadMcpConfig(cwd: string): McpConfig {
  const projectPath = join(resolve(cwd), '.seedcode', 'mcp.json');
  const userPath = join(homedir(), '.seedcode', 'mcp.json');

  const userServers = parseConfigFile(userPath);
  const projectServers = parseConfigFile(projectPath);

  // Merge: project overrides user by name
  const byName = new Map<string, McpServerConfig>();
  for (const s of userServers) byName.set(s.name, s);
  for (const s of projectServers) byName.set(s.name, s);

  return { servers: [...byName.values()] };
}
