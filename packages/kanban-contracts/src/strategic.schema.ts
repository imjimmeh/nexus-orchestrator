import { z } from "zod";

export const REDISCOVERY_MERGE_THRESHOLD = 10;
export const IDEATION_STARVATION_THRESHOLD_CYCLES = 2;

export const StrategicStalenessSchema = z
  .object({
    lastDiscoveryAt: z.string().nullable(),
    mergesSinceDiscovery: z.number().int(),
    commitsSinceDiscovery: z.number().int().nullable(),
    lastCharterUpdateAt: z.string().nullable(),
    lastInitiativeReviewAt: z.string().nullable(),
    lastWorkItemCreatedAt: z.string().nullable(),
    backlogDepth: z.number().int(),
    recentBurnRatePerCycle: z.number(),
    starvationForecastCycles: z.number().nullable(),
    activeNowInitiativeCount: z.number().int(),
  })
  .strict();

export const StrategicIntentSchema = z
  .object({
    kind: z.literal("strategic_intent"),
    focus_initiative_id: z.string().nullable(),
    rationale: z.string().min(1),
    planned_next_steps: z.array(z.string()),
    staleness_actions: z.array(z.string()),
    created_at: z.string().min(1),
  })
  .strict();

export const RecordStrategicIntentRequestSchema = z
  .object({
    focus_initiative_id: z.string().nullable(),
    rationale: z.string().min(1),
    planned_next_steps: z.array(z.string()).default([]),
    staleness_actions: z.array(z.string()).default([]),
  })
  .strict();
