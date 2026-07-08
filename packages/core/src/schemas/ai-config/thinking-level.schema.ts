import { z } from "zod";

/** Canonical ordered thinking levels; index encodes effort magnitude. */
export const RunnerThinkingLevelSchema = z.enum([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

/** Ordered tuple of levels (off..xhigh). Source of truth for ordinal logic. */
export const THINKING_LEVEL_ORDER = RunnerThinkingLevelSchema.options;
