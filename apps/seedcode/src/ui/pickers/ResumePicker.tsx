import React, { useState, useRef } from 'react';
import { useInput } from 'ink';
import type { SessionEntry } from '../../sessions/index.js';
import { ListPicker, type ListPickerItem } from './ListPicker.js';

interface ResumePickerProps {
  sessions: SessionEntry[];
  onSelect: (sessionId: string | null) => void;
}

export function ResumePicker({ sessions, onSelect }: ResumePickerProps) {
  const [idx, setIdx] = useState(0);
  const idxRef = useRef(idx);
  idxRef.current = idx;

  useInput((input, key) => {
    if (key.ctrl && input === 'c') { onSelect(null); return; }
    const i = idxRef.current;
    if (key.upArrow) {
      const next = i <= 0 ? sessions.length - 1 : i - 1;
      setIdx(next); idxRef.current = next; return;
    }
    if (key.downArrow) {
      const next = i >= sessions.length - 1 ? 0 : i + 1;
      setIdx(next); idxRef.current = next; return;
    }
    if (key.return) { onSelect(sessions[i].sessionId); return; }
    if (key.escape) { onSelect(null); }
  });

  const items: ListPickerItem[] = sessions.map((s) => {
    const date = new Date(s.modified).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    const preview = s.firstPrompt.length > 50
      ? s.firstPrompt.slice(0, 50) + '\u2026'
      : s.firstPrompt;
    return {
      key: s.sessionId,
      label: `${s.sessionId.slice(0, 8)}  ${date}  (${s.messageCount} msgs)${s.gitBranch ? `  [${s.gitBranch}]` : ''}`,
      detail: preview || undefined,
    };
  });

  return (
    <ListPicker
      items={items}
      selectedIdx={idx}
      header="Resume session"
      hint="↑↓ move · Enter confirm · Esc cancel"
    />
  );
}
