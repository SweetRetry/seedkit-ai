import { createMCPClient, type MCPClient } from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio';
import type { ToolSet } from 'ai';
import type { McpServerConfig } from './config.js';

export interface McpServerStatus {
  name: string;
  status: 'connecting' | 'connected' | 'error' | 'disconnected';
  toolCount: number;
  error?: string;
}

interface ServerEntry {
  config: McpServerConfig;
  client: MCPClient | null;
  status: McpServerStatus;
}

const CONNECT_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: timeout after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export class McpManager {
  private entries = new Map<string, ServerEntry>();

  /** Connect to all configured servers in parallel. Individual failures are captured, not thrown. */
  async connectAll(servers: McpServerConfig[]): Promise<void> {
    const results = await Promise.allSettled(
      servers.map((cfg) => this.connectOne(cfg)),
    );

    for (let i = 0; i < servers.length; i++) {
      const r = results[i];
      if (r.status === 'rejected') {
        const name = servers[i].name;
        const entry = this.entries.get(name);
        if (entry) {
          entry.status.status = 'error';
          entry.status.error = String(r.reason instanceof Error ? r.reason.message : r.reason);
        }
      }
    }
  }

  private async connectOne(cfg: McpServerConfig): Promise<void> {
    const entry: ServerEntry = {
      config: cfg,
      client: null,
      status: { name: cfg.name, status: 'connecting', toolCount: 0 },
    };
    this.entries.set(cfg.name, entry);

    const transport = cfg.type === 'stdio'
      ? new Experimental_StdioMCPTransport({
          command: cfg.command!,
          args: cfg.args,
          env: cfg.env ? { ...process.env as Record<string, string>, ...cfg.env } : undefined,
          cwd: cfg.cwd,
          stderr: 'ignore',
        })
      : { type: 'sse' as const, url: cfg.url!, headers: cfg.headers };

    const client = await withTimeout(
      createMCPClient({ transport }),
      CONNECT_TIMEOUT_MS,
      cfg.name,
    );

    entry.client = client;

    // Probe tool count
    const tools = await client.tools();
    entry.status.toolCount = Object.keys(tools).length;
    entry.status.status = 'connected';
  }

  /** Aggregate all tools from connected servers with namespace prefixes. */
  async allTools(): Promise<Record<string, ToolSet[string]>> {
    const merged: Record<string, ToolSet[string]> = {};

    for (const entry of this.entries.values()) {
      if (entry.status.status !== 'connected' || !entry.client) continue;
      try {
        const tools = await entry.client.tools();
        for (const [toolName, tool] of Object.entries(tools)) {
          merged[`mcp__${entry.config.name}__${toolName}`] = tool as ToolSet[string];
        }
      } catch {
        // Server may have disconnected — mark as error, skip its tools
        entry.status.status = 'error';
        entry.status.error = 'Failed to list tools';
      }
    }

    return merged;
  }

  /** Get status snapshot for all servers. */
  getStatus(): McpServerStatus[] {
    return [...this.entries.values()].map((e) => ({ ...e.status }));
  }

  /** Reconnect a single server by name. */
  async reconnect(serverName: string): Promise<void> {
    const entry = this.entries.get(serverName);
    if (!entry) return;

    // Close existing connection
    if (entry.client) {
      try { await entry.client.close(); } catch { /* ignore */ }
      entry.client = null;
    }

    entry.status = { name: serverName, status: 'connecting', toolCount: 0 };

    try {
      await this.connectOne(entry.config);
    } catch (err) {
      entry.status.status = 'error';
      entry.status.error = String(err instanceof Error ? err.message : err);
    }
  }

  /** Close all connections and kill child processes. */
  async closeAll(): Promise<void> {
    const closes = [...this.entries.values()].map(async (entry) => {
      if (entry.client) {
        try { await entry.client.close(); } catch { /* ignore */ }
        entry.client = null;
      }
      entry.status.status = 'disconnected';
    });
    await Promise.allSettled(closes);
    this.entries.clear();
  }
}
