import type { RunnerThinkingLevel } from '@nexus/core';

export type ThinkingLevelResolution =
  | { dropped: boolean }
  | { level: RunnerThinkingLevel; clampedFrom?: RunnerThinkingLevel };
