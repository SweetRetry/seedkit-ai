import React, { useState, useRef } from 'react';
import { useInput } from 'ink';
import { ListPicker, type ListPickerItem } from './ListPicker.js';
import type { McpServerStatus } from '../../mcp/manager.js';

export type McpPickerAction = { type: 'reconnect'; name: string } | null;

interface McpPickerProps {
  servers: McpServerStatus[];
  onAction: (action: McpPickerAction) => void;
}

function statusTag(s: McpServerStatus): { tag: string; color?: string } {
  switch (s.status) {
    case 'connected':
      return { tag: `● connected  ${s.toolCount} tool${s.toolCount === 1 ? '' : 's'}`, color: 'green' };
    case 'connecting':
      return { tag: '⏳ connecting…', color: 'yellow' };
    case 'error':
      return { tag: `✗ error  ${s.error ?? 'unknown'}`, color: 'red' };
    case 'disconnected':
      return { tag: '○ disconnected', color: 'gray' };
  }
}

export function McpPicker({ servers, onAction }: McpPickerProps) {
  const [idx, setIdx] = useState(0);
  const idxRef = useRef(idx);
  idxRef.current = idx;

  useInput((input, key) => {
    if (key.ctrl && input === 'c') { onAction(null); return; }
    const i = idxRef.current;
    if (key.upArrow) {
      const next = i <= 0 ? servers.length - 1 : i - 1;
      setIdx(next); idxRef.current = next; return;
    }
    if (key.downArrow) {
      const next = i >= servers.length - 1 ? 0 : i + 1;
      setIdx(next); idxRef.current = next; return;
    }
    if (key.return && servers.length > 0) {
      onAction({ type: 'reconnect', name: servers[i].name });
      return;
    }
    if (key.escape) { onAction(null); }
  });

  const items: ListPickerItem[] = servers.map((s) => {
    const { tag, color } = statusTag(s);
    return { key: s.name, label: s.name, tag, color };
  });

  return (
    <ListPicker
      items={items}
      selectedIdx={idx}
      header="MCP Servers"
      hint="↑↓ move · Enter reconnect · Esc close"
    />
  );
}
