export type KanbanEventDeliveryStatus =
  | "pending"
  | "accepted"
  | "failed"
  | "replayed"
  | "dead_lettered";

export interface UpsertKanbanEventDeliveryProjectionInput {
  readonly eventId: string;
  readonly eventName: string;
  readonly projectId?: string | null;
  readonly workItemId?: string | null;
  readonly workflowRunId?: string | null;
  readonly dedupeKey?: string | null;
  readonly payloadSnapshot: Record<string, unknown>;
  readonly metadata?: Record<string, unknown> | null;
}
