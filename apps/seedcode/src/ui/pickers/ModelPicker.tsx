import React, { useState, useRef } from 'react';
import { useInput } from 'ink';
import { AVAILABLE_MODELS } from '../../commands/slash.js';
import { ListPicker, type ListPickerItem } from './ListPicker.js';

interface ModelPickerProps {
  currentModel?: string;
  onSelect: (model: string | null) => void;
}

export function ModelPicker({ currentModel, onSelect }: ModelPickerProps) {
  const [idx, setIdx] = useState(() => {
    const found = AVAILABLE_MODELS.indexOf(currentModel as typeof AVAILABLE_MODELS[number]);
    return found >= 0 ? found : 0;
  });
  const idxRef = useRef(idx);
  idxRef.current = idx;

  useInput((input, key) => {
    if (key.ctrl && input === 'c') { onSelect(null); return; }
    const i = idxRef.current;
    if (key.upArrow) {
      const next = i <= 0 ? AVAILABLE_MODELS.length - 1 : i - 1;
      setIdx(next); idxRef.current = next; return;
    }
    if (key.downArrow) {
      const next = i >= AVAILABLE_MODELS.length - 1 ? 0 : i + 1;
      setIdx(next); idxRef.current = next; return;
    }
    if (key.return) { onSelect(AVAILABLE_MODELS[i]); return; }
    if (key.escape) { onSelect(null); }
  });

  const items: ListPickerItem[] = AVAILABLE_MODELS.map((m) => ({
    key: m,
    label: m,
    color: m === currentModel ? 'cyan' : undefined,
    tag: m === currentModel ? 'current' : undefined,
  }));

  return (
    <ListPicker
      items={items}
      selectedIdx={idx}
      header="Select model"
      hint="↑↓ move · Enter confirm · Esc cancel"
    />
  );
}
