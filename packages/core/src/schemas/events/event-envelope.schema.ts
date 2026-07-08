import { z } from "zod";
import { ExecutionContextSchema } from "../execution-context.schema";
import {
  CodeChangeEvidenceSchema,
  CodeChangeSeveritySchema,
} from "../../improvement/code-change.schema";

export const SourceServiceV1Schema = z
  .string()
  .min(1)
  .regex(/^[a-z][a-z0-9_-]*$/u);

export const CoreWorkflowEventTypeV1Schema = z.enum([
  "core.workflow.run.requested.v1",
  "core.workflow.run.accepted.v1",
  "core.workflow.run.status_changed.v1",
  "core.workflow.run.completed.v1",
  "core.workflow.step.queued.v1",
  "core.workflow.step.started.v1",
  "core.workflow.step.completed.v1",
  "core.workflow.step.failed.v1",
  "core.workflow.step.retry_scheduled.v1",
]);

export const ChatMessageEventTypeV1Schema = z.enum([
  "chat.message.received.v1",
  "chat.message.sent.v1",
]);

export const ChatSessionEventTypeV1Schema = z.enum([
  "chat.session.created.v1",
  "chat.session.status_changed.v1",
]);

export const ChatMemoryEventTypeV1Schema = z.enum([
  "chat.memory.promoted.v1",
  "chat.memory.updated.v1",
]);

export const CoreIntegrationEventTypeV1Schema = z.enum([
  "core.integration.pr_merged.v1",
  "core.integration.pr_status.v1",
]);

export const ImprovementEventTypeV1Schema = z.enum([
  "improvement.task.requested.v1",
]);

export const CoreIntegrationPrChecksV1Schema = z.enum([
  "pending",
  "passing",
  "failing",
  "unknown",
]);

export const CoreIntegrationPrReviewDecisionV1Schema = z.enum([
  "approved",
  "changes_requested",
  "review_required",
  "none",
]);

export const ChatEventTypeV1Schema = z.union([
  ChatMessageEventTypeV1Schema,
  ChatSessionEventTypeV1Schema,
  ChatMemoryEventTypeV1Schema,
]);

export const InterServiceEventTypeV1Schema = z.union([
  CoreWorkflowEventTypeV1Schema,
  CoreIntegrationEventTypeV1Schema,
  ImprovementEventTypeV1Schema,
  ChatEventTypeV1Schema,
]);

export const CoreWorkflowRunModelUsageBreakdownV1Schema = z
  .object({
    model_id: z.string().min(1),
    provider_name: z.string().min(1),
    model_name: z.string().min(1),
    input_tokens: z.number().int().nonnegative().nullable().optional(),
    output_tokens: z.number().int().nonnegative().nullable().optional(),
    cost_cents: z.number().int().nonnegative().nullable().optional(),
  })
  .strict();

export const CoreWorkflowRunUsageV1Schema = z
  .object({
    total_tokens: z.number().int().nonnegative().nullable().optional(),
    input_tokens: z.number().int().nonnegative().nullable().optional(),
    output_tokens: z.number().int().nonnegative().nullable().optional(),
    estimated_cost_cents: z.number().int().nonnegative().nullable().optional(),
    priced_turn_count: z.number().int().nonnegative().nullable().optional(),
    model_breakdown: z
      .array(CoreWorkflowRunModelUsageBreakdownV1Schema)
      .nullable()
      .optional(),
  })
  .strict();

export const CoreWorkflowRunEventPayloadV1Schema = z
  .object({
    run_id: z.string().min(1),
    workflow_id: z.string().min(1),
    status: z.string().min(1),
    context: ExecutionContextSchema.nullable().optional(),
    // Cumulative token usage for the run, attached on terminal events so
    // downstream consumers can project per-context spend. Neutral/additive.
    usage: CoreWorkflowRunUsageV1Schema.nullable().optional(),
  })
  .strict();

export const CoreWorkflowStepEventPayloadV1Schema = z
  .object({
    run_id: z.string().min(1),
    workflow_id: z.string().min(1),
    job_id: z.string().min(1),
    step_id: z.string().min(1).optional(),
    status: z.string().min(1),
    started_at: z.iso.datetime().nullable().optional(),
    completed_at: z.iso.datetime().nullable().optional(),
    failed_at: z.iso.datetime().nullable().optional(),
    retry_at: z.iso.datetime().nullable().optional(),
    context: ExecutionContextSchema.nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict();

export const ChatMessageEventPayloadV1Schema = z
  .object({
    chat_session_id: z.string().min(1),
    message_id: z.string().min(1),
    direction: z.enum(["inbound", "outbound"]),
    channel: z.string().min(1),
    text: z.string().min(1),
  })
  .strict();

export const ChatSessionEventPayloadV1Schema = z
  .object({
    chat_session_id: z.string().min(1),
    status: z.enum(["starting", "running", "completed", "failed", "cancelled"]),
    context: ExecutionContextSchema.nullable().optional(),
  })
  .strict();

export const ChatMemoryEventPayloadV1Schema = z
  .object({
    chat_session_id: z.string().min(1),
    memory_id: z.string().min(1),
    action: z.enum(["promoted", "updated", "archived"]),
    profile_id: z.string().min(1).nullable().optional(),
  })
  .strict();

export const EventEnvelopeV1Schema = z
  .object({
    event_id: z.string().min(1),
    event_type: InterServiceEventTypeV1Schema,
    event_version: z.literal("v1"),
    occurred_at: z.iso.datetime(),
    correlation_id: z.string().min(1),
    causation_id: z.string().min(1).nullable().optional(),
    source_service: SourceServiceV1Schema,
    payload: z.record(z.string(), z.unknown()),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict();

export const CoreWorkflowRunEventEnvelopeV1Schema =
  EventEnvelopeV1Schema.extend({
    event_type: z.enum([
      "core.workflow.run.requested.v1",
      "core.workflow.run.accepted.v1",
      "core.workflow.run.status_changed.v1",
      "core.workflow.run.completed.v1",
    ]),
    source_service: z.literal("core"),
    payload: CoreWorkflowRunEventPayloadV1Schema,
  });

export const CoreWorkflowStepEventEnvelopeV1Schema =
  EventEnvelopeV1Schema.extend({
    event_type: z.enum([
      "core.workflow.step.queued.v1",
      "core.workflow.step.started.v1",
      "core.workflow.step.completed.v1",
      "core.workflow.step.failed.v1",
      "core.workflow.step.retry_scheduled.v1",
    ]),
    source_service: z.literal("core"),
    payload: CoreWorkflowStepEventPayloadV1Schema,
  });

export const CoreWorkflowEventEnvelopeV1Schema = z.union([
  CoreWorkflowRunEventEnvelopeV1Schema,
  CoreWorkflowStepEventEnvelopeV1Schema,
]);

export const CoreIntegrationPrMergedPayloadV1Schema = z
  .object({
    scopeId: z.string().min(1),
    contextId: z.string().min(1),
    prUrl: z.string().min(1),
    mergeCommitSha: z.string().min(1),
  })
  .strict();

export const CoreIntegrationPrMergedEventEnvelopeV1Schema =
  EventEnvelopeV1Schema.extend({
    event_type: z.literal("core.integration.pr_merged.v1"),
    source_service: z.literal("core"),
    payload: CoreIntegrationPrMergedPayloadV1Schema,
  });

export const CoreIntegrationPrStatusPayloadV1Schema = z
  .object({
    scopeId: z.string().min(1),
    contextId: z.string().min(1),
    prUrl: z.string().min(1),
    checks: CoreIntegrationPrChecksV1Schema,
    reviewDecision: CoreIntegrationPrReviewDecisionV1Schema,
  })
  .strict();

export const CoreIntegrationPrStatusEventEnvelopeV1Schema =
  EventEnvelopeV1Schema.extend({
    event_type: z.literal("core.integration.pr_status.v1"),
    source_service: z.literal("core"),
    payload: CoreIntegrationPrStatusPayloadV1Schema,
  });

/**
 * Neutral request to turn a self-improvement proposal into an actionable
 * task. Published by core onto the lifecycle stream; carries only what a
 * downstream domain needs to create its own tracked representation — core
 * has no knowledge of what that downstream representation looks like.
 */
export const ImprovementTaskRequestedPayloadV1Schema = z
  .object({
    proposalId: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    suspectedArea: z.array(z.string().min(1)).optional(),
    evidence: CodeChangeEvidenceSchema,
    severity: CodeChangeSeveritySchema,
    occurrenceCount: z.number().int().positive(),
  })
  .strict();

export const ImprovementTaskRequestedEventEnvelopeV1Schema =
  EventEnvelopeV1Schema.extend({
    event_type: z.literal("improvement.task.requested.v1"),
    source_service: z.literal("core"),
    payload: ImprovementTaskRequestedPayloadV1Schema,
  });

export const ChatMessageEventEnvelopeV1Schema = EventEnvelopeV1Schema.extend({
  event_type: ChatMessageEventTypeV1Schema,
  source_service: z.literal("chat"),
  payload: ChatMessageEventPayloadV1Schema,
});

export const ChatSessionEventEnvelopeV1Schema = EventEnvelopeV1Schema.extend({
  event_type: ChatSessionEventTypeV1Schema,
  source_service: z.literal("chat"),
  payload: ChatSessionEventPayloadV1Schema,
});

export const ChatMemoryEventEnvelopeV1Schema = EventEnvelopeV1Schema.extend({
  event_type: ChatMemoryEventTypeV1Schema,
  source_service: z.literal("chat"),
  payload: ChatMemoryEventPayloadV1Schema,
});

export const ChatEventEnvelopeV1Schema = z.union([
  ChatMessageEventEnvelopeV1Schema,
  ChatSessionEventEnvelopeV1Schema,
  ChatMemoryEventEnvelopeV1Schema,
]);

export const InterServiceEventEnvelopeV1Schema = z.union([
  CoreWorkflowEventEnvelopeV1Schema,
  CoreIntegrationPrMergedEventEnvelopeV1Schema,
  CoreIntegrationPrStatusEventEnvelopeV1Schema,
  ImprovementTaskRequestedEventEnvelopeV1Schema,
  ChatEventEnvelopeV1Schema,
]);

export * from "./event-envelope.types";
