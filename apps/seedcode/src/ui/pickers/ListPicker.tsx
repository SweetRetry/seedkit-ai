import React from 'react';
import { Box, Text } from 'ink';

export interface ListPickerItem {
  key: string;
  label: string;
  /** Secondary description shown below the label */
  detail?: string;
  /** Dim tag shown to the right (e.g. "current") */
  tag?: string;
  /** Highlight color when not selected (default: undefined = normal text) */
  color?: string;
}

interface ListPickerProps {
  items: ListPickerItem[];
  selectedIdx: number;
  header: string;
  hint?: string;
}

export function ListPicker({ items, selectedIdx, header, hint }: ListPickerProps) {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text dimColor>  {header}  </Text>
        {hint && <Text dimColor>{hint}</Text>}
      </Box>
      {items.map((item, i) => {
        const selected = i === selectedIdx;
        return (
          <Box key={item.key} flexDirection="column" marginLeft={2}>
            <Box>
              {selected
                ? <Text bold color="cyan" inverse>{` ${item.label} `}</Text>
                : <Text color={item.color}>{item.label}</Text>
              }
              {item.tag && !selected && <Text dimColor>  {item.tag}</Text>}
            </Box>
            {item.detail && (
              <Box marginLeft={selected ? 1 : 0}>
                <Text dimColor>{`  ${item.detail}`}</Text>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
