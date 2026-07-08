import { z } from "zod";

/**
 * The closed set of `memory_segments.memory_type` enum values recognised
 * by the API and core packages. The `strategic_intent` value was added in
 * EPIC-208 (Milestone 1) to support the CEO long-term planning refresh
 * loop; its structured payload (horizon, priority_themes, focus_areas,
 * constraints, updated_at, updated_by) is validated by
 * `strategicIntentBodySchema` in `workflow-runtime-inputs.schemas.ts`
 * and persisted in `memory_segments.metadata_json` (jsonb).
 */
export const MEMORY_TYPES = [
  "preference",
  "fact",
  "history",
  "strategic_intent",
] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];

export const CHAT_MEMORY_SOURCES = ["session", "profile"] as const;

export type ChatMemorySource = (typeof CHAT_MEMORY_SOURCES)[number];

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1";
  }

  return false;
}

export const listMemorySegmentsSchema = z.object({
  memory_type: z.enum(MEMORY_TYPES).optional(),
  query: z.string().optional(),
  entity_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).optional().default(25),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const listChatMemorySegmentsSchema = z.object({
  source: z.enum(CHAT_MEMORY_SOURCES).optional().default("profile"),
  memory_type: z.enum(MEMORY_TYPES).optional(),
  query: z.string().optional(),
  profile_id: z.string().optional(),
  chat_session_id: z.string().optional(),
  include_archived: z
    .preprocess((value) => toBoolean(value), z.boolean())
    .optional()
    .default(false),
  only_undistilled: z
    .preprocess((value) => toBoolean(value), z.boolean())
    .optional()
    .default(false),
  limit: z.coerce.number().int().min(1).optional().default(25),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

function toOptionalPositiveInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const candidate = Math.trunc(value);
    return candidate > 0 ? candidate : undefined;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  return undefined;
}

export const chatMemoryObservabilityQuerySchema = z.object({
  jobs_limit: z
    .preprocess(
      (value) => toOptionalPositiveInt(value),
      z.number().int().min(1),
    )
    .optional(),
  events_limit: z
    .preprocess(
      (value) => toOptionalPositiveInt(value),
      z.number().int().min(1),
    )
    .optional(),
});

export const chatMemoryLimitQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type ListMemorySegmentsRequest = z.infer<
  typeof listMemorySegmentsSchema
>;

export type ListChatMemorySegmentsRequest = z.infer<
  typeof listChatMemorySegmentsSchema
>;

export type ChatMemoryObservabilityQueryRequest = z.infer<
  typeof chatMemoryObservabilityQuerySchema
>;

export type ChatMemoryLimitQueryRequest = z.infer<
  typeof chatMemoryLimitQuerySchema
>;
