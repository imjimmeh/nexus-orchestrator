import { z } from "zod";

export const StartupRoutingSourceContextSchema = z.object({
  sourceType: z.string(),
  sourceId: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const StartupRoutingReadinessContextSchema = z.object({
  isReady: z.boolean(),
  readinessReason: z.string().optional(),
  lastCheckedAt: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const StartupRoutingHintsSchema = z.object({
  preferredWorkflowId: z.string().optional(),
  preferredRouteId: z.string().optional(),
  skipRouteArbitration: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const StartupRoutingContextSchema = z.object({
  scopeId: z.string(),
  goals: z.string(),
  sourceContext: StartupRoutingSourceContextSchema.optional(),
  readinessContext: StartupRoutingReadinessContextSchema.optional(),
  startupHints: StartupRoutingHintsSchema.optional(),
});

export const StartupRoutingDecisionSchema = z.object({
  routeId: z.string(),
  ruleId: z.string(),
  workflowId: z.string(),
  reasoning: z.string().optional(),
  inputs: z.record(z.string(), z.unknown()).optional(),
});
