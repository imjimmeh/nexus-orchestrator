import { z } from "zod";
import {
  SourceServiceV1Schema,
  CoreWorkflowEventTypeV1Schema,
  ChatMessageEventTypeV1Schema,
  ChatSessionEventTypeV1Schema,
  ChatMemoryEventTypeV1Schema,
  ChatEventTypeV1Schema,
  InterServiceEventTypeV1Schema,
  CoreWorkflowRunUsageV1Schema,
  CoreWorkflowRunEventPayloadV1Schema,
  CoreWorkflowStepEventPayloadV1Schema,
  ChatMessageEventPayloadV1Schema,
  ChatSessionEventPayloadV1Schema,
  ChatMemoryEventPayloadV1Schema,
  EventEnvelopeV1Schema,
  CoreWorkflowEventEnvelopeV1Schema,
  CoreWorkflowRunEventEnvelopeV1Schema,
  CoreWorkflowStepEventEnvelopeV1Schema,
  CoreIntegrationPrMergedPayloadV1Schema,
  CoreIntegrationPrMergedEventEnvelopeV1Schema,
  CoreIntegrationPrStatusPayloadV1Schema,
  CoreIntegrationPrStatusEventEnvelopeV1Schema,
  ImprovementTaskRequestedPayloadV1Schema,
  ImprovementTaskRequestedEventEnvelopeV1Schema,
  ChatEventEnvelopeV1Schema,
  ChatMemoryEventEnvelopeV1Schema,
  InterServiceEventEnvelopeV1Schema,
} from "./event-envelope.schema";

export type EventEnvelopeV1Shape = z.infer<typeof EventEnvelopeV1Schema>;
export type CoreWorkflowRunEventEnvelopeV1Shape = z.infer<
  typeof CoreWorkflowRunEventEnvelopeV1Schema
>;
export type CoreWorkflowStepEventEnvelopeV1Shape = z.infer<
  typeof CoreWorkflowStepEventEnvelopeV1Schema
>;
export type CoreWorkflowEventEnvelopeV1Shape = z.infer<
  typeof CoreWorkflowEventEnvelopeV1Schema
>;
export type CoreIntegrationPrMergedV1 = z.infer<
  typeof CoreIntegrationPrMergedPayloadV1Schema
>;
export type CoreIntegrationPrMergedEventEnvelopeV1Shape = z.infer<
  typeof CoreIntegrationPrMergedEventEnvelopeV1Schema
>;
export type CoreIntegrationPrStatusV1 = z.infer<
  typeof CoreIntegrationPrStatusPayloadV1Schema
>;
export type CoreIntegrationPrStatusEventEnvelopeV1Shape = z.infer<
  typeof CoreIntegrationPrStatusEventEnvelopeV1Schema
>;
export type ImprovementTaskRequestedV1 = z.infer<
  typeof ImprovementTaskRequestedPayloadV1Schema
>;
export type ImprovementTaskRequestedEventEnvelopeV1Shape = z.infer<
  typeof ImprovementTaskRequestedEventEnvelopeV1Schema
>;
export type ChatEventEnvelopeV1Shape = z.infer<
  typeof ChatEventEnvelopeV1Schema
>;
export type ChatMemoryEventEnvelopeV1Shape = z.infer<
  typeof ChatMemoryEventEnvelopeV1Schema
>;
export type InterServiceEventEnvelopeV1Shape = z.infer<
  typeof InterServiceEventEnvelopeV1Schema
>;

// ── Backward-compatible type aliases (without Shape suffix) ─────────────────
// These are derived from Zod schemas and are the single source of truth.

export type SourceServiceV1 = z.infer<typeof SourceServiceV1Schema>;
export type CoreWorkflowEventTypeV1 = z.infer<
  typeof CoreWorkflowEventTypeV1Schema
>;
export type ChatMessageEventTypeV1 = z.infer<
  typeof ChatMessageEventTypeV1Schema
>;
export type ChatSessionEventTypeV1 = z.infer<
  typeof ChatSessionEventTypeV1Schema
>;
export type ChatMemoryEventTypeV1 = z.infer<typeof ChatMemoryEventTypeV1Schema>;
export type ChatEventTypeV1 = z.infer<typeof ChatEventTypeV1Schema>;
export type InterServiceEventTypeV1 = z.infer<
  typeof InterServiceEventTypeV1Schema
>;
export type CoreWorkflowRunUsageV1Shape = z.infer<
  typeof CoreWorkflowRunUsageV1Schema
>;
export type CoreWorkflowRunEventPayloadV1 = z.infer<
  typeof CoreWorkflowRunEventPayloadV1Schema
>;
export type CoreWorkflowStepEventPayloadV1 = z.infer<
  typeof CoreWorkflowStepEventPayloadV1Schema
>;
export type ChatMessageEventPayloadV1 = z.infer<
  typeof ChatMessageEventPayloadV1Schema
>;
export type ChatSessionEventPayloadV1 = z.infer<
  typeof ChatSessionEventPayloadV1Schema
>;
export type ChatMemoryEventPayloadV1 = z.infer<
  typeof ChatMemoryEventPayloadV1Schema
>;
export type ChatEventPayloadV1 =
  | ChatMessageEventPayloadV1
  | ChatSessionEventPayloadV1
  | ChatMemoryEventPayloadV1;

/**
 * Generic event envelope — TEventType and TPayload can be narrowed by callers.
 * The base fields are derived from EventEnvelopeV1Schema so they remain
 * structurally compatible with the Zod-validated shape.
 */
export type EventEnvelopeV1<
  TEventType = InterServiceEventTypeV1,
  TPayload = Record<string, unknown>,
> = Omit<EventEnvelopeV1Shape, "eventType" | "payload"> & {
  eventType: TEventType;
  payload: TPayload;
};
