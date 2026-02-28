import React, { memo } from 'react';
import { Box, Text } from 'ink';

interface StatusBarProps {
  version: string;
  model: string;
  maskedKey: string;
  /** 0–1 fraction of the 256k context window currently used (system + history) */
  contextPct?: number;
}

export const StatusBar = memo(function StatusBar({ version, model, maskedKey, contextPct }: StatusBarProps) {
  const showWarn = contextPct !== undefined && contextPct >= 0.75;
  const isCritical = contextPct !== undefined && contextPct >= 0.85;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box gap={2} paddingX={1}>
        <Text bold color="cyan">seedcode</Text>
        <Text dimColor>v{version}</Text>
        <Box>
          <Text dimColor> model </Text>
          <Text color="cyan">{model}</Text>
        </Box>
        <Text dimColor>{maskedKey}</Text>
        {showWarn && (
          <Text color={isCritical ? 'red' : 'yellow'}>
            {isCritical ? '⚠ context critical' : '⚠ context high'}{' '}
            {Math.round(contextPct * 100)}%
          </Text>
        )}
      </Box>
      <Box>
        <Text dimColor>{'─'.repeat(60)}</Text>
      </Box>
    </Box>
  );
});
