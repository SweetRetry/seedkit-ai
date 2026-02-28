import React, { useState, useRef } from 'react';
import { useInput } from 'ink';
import os from 'node:os';
import path from 'node:path';
import { ListPicker, type ListPickerItem } from './ListPicker.js';

const GLOBAL_AGENTS_MD = path.join(os.homedir(), '.seedcode', 'AGENTS.md');

interface MemoryPickerProps {
  memoryFilePath?: string;
  onSelect: (filePath: string | null) => void;
}

export function MemoryPicker({ memoryFilePath, onSelect }: MemoryPickerProps) {
  const [idx, setIdx] = useState(0);
  const idxRef = useRef(idx);
  idxRef.current = idx;

  const projectPath = memoryFilePath ?? path.join(os.homedir(), '.seedcode', 'projects', '...', 'memory', 'MEMORY.md');
  const options = [
    { label: 'Project memory', path: projectPath },
    { label: 'Global memory', path: GLOBAL_AGENTS_MD },
  ];

  useInput((input, key) => {
    if (key.ctrl && input === 'c') { onSelect(null); return; }
    const i = idxRef.current;
    if (key.upArrow) {
      const next = i <= 0 ? options.length - 1 : i - 1;
      setIdx(next); idxRef.current = next; return;
    }
    if (key.downArrow) {
      const next = i >= options.length - 1 ? 0 : i + 1;
      setIdx(next); idxRef.current = next; return;
    }
    if (key.return) { onSelect(options[i].path); return; }
    if (key.escape) { onSelect(null); }
  });

  const items: ListPickerItem[] = options.map((opt) => ({
    key: opt.path,
    label: opt.label,
    detail: opt.path,
  }));

  return (
    <ListPicker
      items={items}
      selectedIdx={idx}
      header="Memory"
      hint="↑↓ move · Enter open in $EDITOR · Esc cancel"
    />
  );
}
