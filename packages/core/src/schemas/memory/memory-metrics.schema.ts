/**
 * Zod schema contracts for the per-backend memory observability snapshot
 * exposed by the milestone 2 REST endpoint.
 *
 * Mirrors `MemoryMetricsSnapshot` in
 * `apps/api/src/memory/memory-metrics.types.ts`. The server-owned
 * TypeScript interface remains the source of truth for in-process typing;
 * this schema is the public contract used by web clients and any
 * out-of-process consumer that needs to validate the payload.
 */
import { z } from "zod";

export const MEMORY_BACKEND_LABELS = ["postgres", "honcho"] as const;

export type MemoryBackendLabel = (typeof MEMORY_BACKEND_LABELS)[number];

export const MEMORY_WRITE_OUTCOMES = ["success", "failure"] as const;

export type MemoryWriteOutcomeSchema = (typeof MEMORY_WRITE_OUTCOMES)[number];

export const DISTILLATION_OUTCOMES = ["success", "failure"] as const;

export type DistillationOutcomeSchema = (typeof DISTILLATION_OUTCOMES)[number];

const backendLabelSchema = z.enum(MEMORY_BACKEND_LABELS);
const memoryWriteOutcomeSchema = z.enum(MEMORY_WRITE_OUTCOMES);
const distillationOutcomeSchema = z.enum(DISTILLATION_OUTCOMES);

const backendLatencySummarySchema = z
  .object({
    count: z.number().int().nonnegative(),
    sum: z.number().nonnegative(),
    p50: z.number().nonnegative().optional(),
    p95: z.number().nonnegative().optional(),
    p99: z.number().nonnegative().optional(),
  })
  .readonly();

const backendReadMetricsSchema = z
  .object({
    total: z.record(backendLabelSchema, z.number().int().nonnegative()),
    latency_ms: z.record(backendLabelSchema, backendLatencySummarySchema),
  })
  .readonly();

const backendWriteMetricsSchema = z
  .object({
    total: z.record(
      backendLabelSchema,
      z.record(memoryWriteOutcomeSchema, z.number().int().nonnegative()),
    ),
  })
  .readonly();

const backendActiveSegmentsMetricsSchema = z
  .object({
    total: z.record(
      backendLabelSchema,
      z.record(z.string(), z.number().int().nonnegative()),
    ),
  })
  .readonly();

const backendMetricsSchema = z
  .object({
    read: backendReadMetricsSchema,
    write: backendWriteMetricsSchema,
    active_segments: backendActiveSegmentsMetricsSchema,
    fallback: z.record(z.string(), z.number().int().nonnegative()),
  })
  .readonly();

const distillationLastRunSchema = z
  .object({
    input_segment_count: z.number().int().nonnegative(),
    output_segment_count: z.number().int().nonnegative(),
    compression_ratio: z.number().nonnegative(),
    tokens_before: z.number().int().nonnegative(),
    tokens_after: z.number().int().nonnegative(),
    model: z.string(),
    duration_ms: z.number().int().nonnegative(),
    completed_at: z.iso.datetime(),
  })
  .readonly();

const distillationMetricsSchema = z
  .object({
    completed_total: z.record(
      distillationOutcomeSchema,
      z.number().int().nonnegative(),
    ),
    last: distillationLastRunSchema.nullable(),
  })
  .readonly();

const learningLastPromotedSchema = z
  .object({
    candidate_id: z.string(),
    confidence: z.number().min(0).max(1),
    scope: z.string(),
    source_decision_id: z.string(),
    promoted_at: z.iso.datetime(),
  })
  .readonly();

const learningMetricsSchema = z
  .object({
    promoted_total: z.number().int().nonnegative(),
    last_promoted: learningLastPromotedSchema.nullable(),
  })
  .readonly();

export const memoryMetricsSnapshotSchema = z
  .object({
    backend: backendMetricsSchema,
    distillation: distillationMetricsSchema,
    learning: learningMetricsSchema,
    generated_at: z.iso.datetime(),
  })
  .readonly();

export type MemoryMetricsSnapshotSchema = z.infer<
  typeof memoryMetricsSnapshotSchema
>;
