import type { AuthenticatedSocket } from './types';

export async function recordWarRoomCommandToolCall(_params: {
  workflowRunId: string;
  client: AuthenticatedSocket;
  action: string;
}): Promise<void> {
  // Tool call tracking removed: required-tool satisfaction now relies on
  // synchronous api_callback state writes.
}

export async function recordWarRoomLifecycleToolCalls(_params: {
  workflowRunId: string;
  client: AuthenticatedSocket;
  resultPayload: Record<string, unknown>;
}): Promise<void> {
  // Tool call tracking removed: required-tool satisfaction now relies on
  // synchronous api_callback state writes.
}
