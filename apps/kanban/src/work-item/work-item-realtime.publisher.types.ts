// apps/kanban/src/work-item/work-item-realtime.publisher.types.ts

export interface WorkItemRealtimePayload {
  projectId: string;
  workItem: Record<string, unknown>;
}
