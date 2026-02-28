import React from 'react';
import { Box, Text, Static } from 'ink';
import type { TurnEntry } from './ReplApp.js';
import { ToolCallLine } from './ToolCallView.js';
import { renderMarkdown } from './renderMarkdown.js';

// How many lines of reasoning to show in the live streaming view
const MAX_LIVE_REASONING_LINES = 6;
// How many chars of reasoning to show in collapsed summary
const REASONING_SUMMARY_CHARS = 80;

interface MessageListProps {
  staticTurns: TurnEntry[];
  activeTurn: (TurnEntry & { type: 'assistant' }) | null;
  /** Live reasoning text being streamed, before the assistant text arrives */
  activeReasoning: string | null;
  /** True while the model is in pure thinking mode (no text output yet) */
  isThinking: boolean;
}

export function MessageList({ staticTurns, activeTurn, activeReasoning, isThinking }: MessageListProps) {
  return (
    <>
      {staticTurns.length === 0 && !activeTurn && !isThinking && (
        <Box marginBottom={1} paddingX={1}>
          <Text dimColor>Type /help for available commands.</Text>
        </Box>
      )}

      <Static items={staticTurns}>
        {(turn, i) => <TurnView key={i} turn={turn} />}
      </Static>

      {/* Live reasoning block — shown while model is thinking before text */}
      {isThinking && (
        <ThinkingBlockLive text={activeReasoning ?? ''} />
      )}

      {activeTurn && (
        <Box marginTop={1} flexDirection="column" paddingX={1}>
          <Box gap={1}>
            <Text color="green" bold>●</Text>
            <Text color="green" bold>seed</Text>
          </Box>
          {/* Don't render markdown while streaming — content is incomplete */}
          <Box marginLeft={3}>
            <Text>{activeTurn.content}</Text>
            <Text color="green">▌</Text>
          </Box>
        </Box>
      )}
    </>
  );
}

/** Spinner-style live thinking block shown while reasoning is streaming */
function ThinkingBlockLive({ text }: { text: string }) {
  const lines = text.split('\n');
  // Show last N lines so it scrolls naturally
  const visibleLines = lines.slice(-MAX_LIVE_REASONING_LINES);

  return (
    <Box marginTop={1} flexDirection="column" paddingX={1}>
      <Box gap={1}>
        <Text color="magenta">◈</Text>
        <Text color="magenta" dimColor>thinking…</Text>
      </Box>
      <Box flexDirection="column" marginLeft={3} borderStyle="single" borderColor="magenta" borderLeft borderRight={false} borderTop={false} borderBottom={false}>
        <Box paddingLeft={1} flexDirection="column">
          {visibleLines.map((line, i) => (
            <Text key={i} dimColor>
              {line}
            </Text>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

/** Collapsed reasoning summary shown in completed turns */
function ThinkingBlockSummary({ text }: { text: string }) {
  const firstLine = text.split('\n').find((l) => l.trim()) ?? '';
  const summary =
    firstLine.length > REASONING_SUMMARY_CHARS
      ? firstLine.slice(0, REASONING_SUMMARY_CHARS) + '…'
      : firstLine;

  return (
    <Box marginLeft={3} marginBottom={0} gap={1}>
      <Text color="magenta" dimColor>◈</Text>
      <Text dimColor>{summary}</Text>
    </Box>
  );
}

function TurnView({ turn }: { turn: TurnEntry }) {
  switch (turn.type) {
    case 'user':
      return (
        <Box marginTop={1} paddingX={1} gap={1}>
          <Text color="cyan" bold>▸</Text>
          <Text color="cyan" bold>you</Text>
          <Text>{turn.content}</Text>
        </Box>
      );

    case 'assistant':
      return (
        <Box marginTop={1} paddingX={1} flexDirection="column">
          <Box gap={1}>
            <Text color="green" bold>●</Text>
            <Text color="green" bold>seed</Text>
          </Box>
          {turn.reasoning && <ThinkingBlockSummary text={turn.reasoning} />}
          <Box marginLeft={3}>
            <Text>{turn.done ? renderMarkdown(turn.content) : turn.content}</Text>
          </Box>
        </Box>
      );

    case 'error':
      return (
        <Box marginTop={1} paddingX={1} gap={1}>
          <Text color="red">✕</Text>
          <Text color="red">{turn.content}</Text>
        </Box>
      );

    case 'info':
      return (
        <Box marginTop={1} paddingX={1}>
          <Text dimColor>{turn.content}</Text>
        </Box>
      );

    case 'toolcall':
      return <ToolCallLine entry={turn.entry} />;
  }
}
