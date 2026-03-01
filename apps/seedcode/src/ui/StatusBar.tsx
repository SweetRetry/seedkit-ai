import React, { memo } from 'react';
import { Box, Text } from 'ink';
import type { Plan } from '../config/schema.js';

// ── One-time banner (shown once via staticTurns) ──────────────────────────

export interface BannerInfo {
  version: string;
  model: string;
  maskedKey: string;
  plan?: Plan;
}

/** Build a plain-text banner string for the initial staticTurn. */
export function buildBannerText({ version, model, maskedKey, plan }: BannerInfo): string {
  const parts = [`seedcode v${version}`, `model ${model}`];
  if (plan) parts.push(`[${plan}]`);
  parts.push(maskedKey);
  return parts.join('  ');
}

// ── Live streaming indicator (step counter + context warnings) ────────────

interface StreamingIndicatorProps {
  /** 0–1 fraction of the 256k context window currently used */
  contextPct?: number;
  /** Current tool step number (1-based), null when idle */
  currentStep?: number | null;
  maxSteps?: number;
}

export const StreamingIndicator = memo(function StreamingIndicator({
  contextPct,
  currentStep,
  maxSteps = 50,
}: StreamingIndicatorProps) {
  const showWarn = contextPct !== undefined && contextPct >= 0.75;
  const isCritical = contextPct !== undefined && contextPct >= 0.85;
  const showStep = currentStep != null;

  if (!showStep && !showWarn) return null;

  return (
    <Box paddingX={1} gap={2}>
      {showStep && (
        <Text color={currentStep! >= maxSteps - 5 ? 'yellow' : 'dimColor'}>
          step {currentStep}/{maxSteps}
        </Text>
      )}
      {showWarn && (
        <Text color={isCritical ? 'red' : 'yellow'}>
          {isCritical ? '⚠ context critical' : '⚠ context high'}{' '}
          {Math.round(contextPct! * 100)}%
        </Text>
      )}
    </Box>
  );
});
