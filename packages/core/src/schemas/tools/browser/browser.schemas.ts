import { z } from "zod";

const WAIT_STATE_ENUM = [
  "load",
  "domcontentloaded",
  "networkidle",
  "attached",
  "detached",
  "visible",
  "hidden",
] as const;

export const BrowserPolicySchema = z.object({
  timeout_ms: z.number().int().optional(),
  retry_budget: z.number().int().optional(),
  backoff_initial_ms: z.number().int().optional(),
  backoff_factor: z.number().optional(),
  backoff_max_ms: z.number().int().optional(),
  pacing_ms: z.number().int().optional(),
});

export const BrowserActionBaseSchema = z.object({
  workflow_run_id: z.string().optional(),
  job_id: z.string().optional(),
  session_id: z.string().optional(),
  policy: BrowserPolicySchema.optional(),
  // Top-level flattened policy fields for ergonomics
  timeout_ms: z.number().int().optional(),
  retry_budget: z.number().int().optional(),
  backoff_initial_ms: z.number().int().optional(),
  backoff_factor: z.number().optional(),
  backoff_max_ms: z.number().int().optional(),
  pacing_ms: z.number().int().optional(),
});

export const BrowserOpenPageSchema = BrowserActionBaseSchema.extend({
  url: z.string().optional(),
});

export const BrowserNavigateSchema = BrowserActionBaseSchema.extend({
  url: z.string(),
});

export const BrowserClickSchema = BrowserActionBaseSchema.extend({
  selector: z.string().optional(),
  selector_alias: z.string().optional(),
  selector_aliases: z
    .record(z.string(), z.union([z.string(), z.array(z.string())]))
    .optional(),
  role: z.string().optional(),
  name: z.string().optional(),
  target_text: z.string().optional(),
  placeholder: z.string().optional(),
  test_id: z.string().optional(),
});

export const BrowserFillSchema = BrowserClickSchema.extend({
  text: z.string(),
});

export const BrowserWaitSchema = BrowserActionBaseSchema.extend({
  selector: z.string().optional(),
  wait_for: z.enum(WAIT_STATE_ENUM).optional(),
  wait_state: z.enum(WAIT_STATE_ENUM).optional(),
  duration_ms: z.number().int().optional(),
});

export const BrowserScreenshotSchema = BrowserActionBaseSchema.extend({
  full_page: z.boolean().optional(),
});

// Generic union-like schema for backward compatibility where needed
export const browserActionSchema = BrowserActionBaseSchema.extend({
  url: z.string().optional(),
  text: z.string().optional(),
  selector: z.string().optional(),
  selector_alias: z.string().optional(),
  selector_aliases: z
    .record(z.string(), z.union([z.string(), z.array(z.string())]))
    .optional(),
  role: z.string().optional(),
  name: z.string().optional(),
  target_text: z.string().optional(),
  placeholder: z.string().optional(),
  test_id: z.string().optional(),
  wait_for: z.enum(WAIT_STATE_ENUM).optional(),
  wait_state: z.enum(WAIT_STATE_ENUM).optional(),
  duration_ms: z.number().int().optional(),
  full_page: z.boolean().optional(),
});

export const BrowserCloseSchema = z.object({
  workflow_run_id: z.string().optional(),
  job_id: z.string().optional(),
  session_id: z.string().optional(),
});

export const BrowserArtifactsListSchema = z.object({
  workflow_run_id: z.string().optional(),
  job_id: z.string().optional(),
  limit: z.number().int().nonnegative().optional(),
  offset: z.number().int().nonnegative().optional(),
});

export const BrowserArtifactsGetSchema = z.object({
  workflow_run_id: z.string().optional(),
  job_id: z.string().optional(),
  artifact_id: z.string(),
});

export * from "./browser.types";
