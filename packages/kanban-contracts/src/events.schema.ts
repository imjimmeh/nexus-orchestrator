import { z } from "zod";
import { WorkItemRecordSchema, WorkItemStatusSchema } from "./work-item.schema";

export const KanbanWorkItemEventTypeV1Schema = z.enum([
  "kanban.work_item.created.v1",
  "kanban.work_item.status_changed.v1",
  "kanban.work_item.assigned.v1",
]);

export const KanbanWorkItemStatusChangedEventPayloadV1Schema = z
  .object({
    event: z.literal("kanban.work_item.status_changed.v1"),
    scopeId: z.string().min(1),
    contextId: z.string().min(1),
    workItemId: z.string().min(1),
    status: WorkItemStatusSchema,
    previousStatus: WorkItemStatusSchema.nullable(),
    actor: z.string().min(1),
    resource: WorkItemRecordSchema,
  })
  .strict();

export const KanbanWorkItemEventPayloadV1Schema = z
  .object({
    scopeId: z.string().min(1),
    contextId: z.string().min(1),
    status: z.string().min(1),
    previousStatus: z.string().min(1).nullable().optional(),
    assignedAgentId: z.string().min(1).nullable().optional(),
  })
  .strict();

const KanbanWorkItemEventEnvelopeBaseV1Schema = z.object({
  eventId: z.string().min(1),
  eventVersion: z.literal("v1"),
  occurredAt: z.string().min(1),
  correlationId: z.string().min(1),
  causationId: z.string().min(1).nullable().optional(),
  sourceService: z.literal("kanban"),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const KanbanWorkItemEventEnvelopeV1Schema = z.discriminatedUnion(
  "eventType",
  [
    KanbanWorkItemEventEnvelopeBaseV1Schema.extend({
      eventType: z.literal("kanban.work_item.status_changed.v1"),
      payload: KanbanWorkItemStatusChangedEventPayloadV1Schema,
    }).strict(),
    KanbanWorkItemEventEnvelopeBaseV1Schema.extend({
      eventType: z.enum([
        "kanban.work_item.created.v1",
        "kanban.work_item.assigned.v1",
      ]),
      payload: KanbanWorkItemEventPayloadV1Schema,
    }).strict(),
  ],
);
