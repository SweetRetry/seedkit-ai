import React, { memo } from 'react';
import { Box, Text } from 'ink';

interface StatusBarProps {
  version: string;
  model: string;
  maskedKey: string;
}

export const StatusBar = memo(function StatusBar({ version, model, maskedKey }: StatusBarProps) {
  return (
    <Box borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
      <Text bold color="cyan">seedcode </Text>
      <Text dimColor>v{version}  model:{model}  key:{maskedKey}</Text>
    </Box>
  );
});
