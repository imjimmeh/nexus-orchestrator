import type { WorkflowRunExecutionStatusV1 } from '@nexus/core';

export const TERMINAL_RUN_STATUSES = new Set<WorkflowRunExecutionStatusV1>([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

export const DEFAULT_RELAY_BATCH_SIZE = 20;
export const TELEGRAM_OUTBOUND_RELAY_SOURCE = 'telegram_outbound_relay';

export interface RelayCandidateMessage {
  id: string;
  chat_session_id: string;
  run_id?: string | null;
  run_status?: string | null;
  correlation_id?: string | null;
  metadata?: Record<string, unknown> | null;
}
