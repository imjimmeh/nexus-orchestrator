export interface WorkflowEventPayload extends Record<string, unknown> {
  event_type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}
