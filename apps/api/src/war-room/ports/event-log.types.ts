export interface WarRoomAppendEventParams {
  workflowRunId: string;
  eventType: string;
  stepId?: string;
  jobId?: string;
  actorId?: string;
  payload?: Record<string, unknown>;
}

export interface WarRoomEventLogPort {
  appendBestEffort(params: WarRoomAppendEventParams): Promise<void>;
}
