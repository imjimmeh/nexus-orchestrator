import { z } from "zod";
import { learningScopeSchema } from "./learning-contracts.schema";

export const runtimeFeedbackSignalTypeSchema = z.enum([
  "tool_contract_repair",
  "failure_classification",
  "repair_outcome",
  "workflow_anomaly",
  "review_qa_finding",
  "memory_miss",
]);

export const runtimeFeedbackSeveritySchema = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);

export const runtimeFeedbackEvidenceSchema = z
  .object({
    kind: z.string().trim().min(1).max(80),
    id: z.string().trim().min(1).max(160).optional(),
    summary: z.string().trim().min(1).max(500),
  })
  .strict();

export const runtimeFeedbackExampleSchema = z
  .object({
    summary: z.string().trim().min(1).max(500),
    redacted: z.literal(true),
  })
  .strict();

export const runtimeFeedbackSignalSchema = z
  .object({
    signal_type: runtimeFeedbackSignalTypeSchema,
    source_module: z.string().trim().min(1).max(120),
    scope: learningScopeSchema,
    actor: z
      .object({
        agent_profile: z.string().trim().min(1).max(160).optional(),
        user_id: z.string().trim().min(1).max(160).optional(),
      })
      .strict()
      .optional(),
    affected: z
      .object({
        tool_name: z.string().trim().min(1).max(160).optional(),
        workflow_id: z.string().trim().min(1).max(160).optional(),
        workflow_run_id: z.string().trim().min(1).max(160).optional(),
        job_id: z.string().trim().min(1).max(160).optional(),
        schema_path: z.string().trim().min(1).max(240).optional(),
        failure_class: z.string().trim().min(1).max(120).optional(),
        repair_action_id: z.string().trim().min(1).max(160).optional(),
      })
      .strict()
      .optional(),
    evidence: z.array(runtimeFeedbackEvidenceSchema).min(1).max(20),
    examples: z.array(runtimeFeedbackExampleSchema).max(10).default([]),
    confidence: z.number().min(0).max(1),
    severity: runtimeFeedbackSeveritySchema,
    dedupe_fingerprint: z.string().trim().min(8).max(512),
    occurred_at: z.iso.datetime().optional(),
  })
  .strict();

export type RuntimeFeedbackSignal = z.infer<typeof runtimeFeedbackSignalSchema>;
export type RuntimeFeedbackSignalType = z.infer<
  typeof runtimeFeedbackSignalTypeSchema
>;
export type RuntimeFeedbackSeverity = z.infer<
  typeof runtimeFeedbackSeveritySchema
>;
