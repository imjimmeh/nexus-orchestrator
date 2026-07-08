import type { WorkflowStatus } from '@nexus/core';

/** Minimal structural view of a workflow run needed to summarise it. */
export interface RunningWorkflowRunRecord {
  id: string;
  workflow_id: string;
  status: WorkflowStatus;
  wait_reason?: string | null;
  state_variables: Record<string, unknown>;
  created_at: Date;
}

export interface MapRunningWorkflowSummariesOptions {
  /** Run id to omit (typically the calling run, so it never sees itself). */
  excludeRunId?: string;
  /** Maximum number of summaries to return after exclusion. */
  limit?: number;
}
