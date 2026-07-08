import type { RunningWorkflowSummary } from '@nexus/core';

export interface ListRunningWorkflowsParams {
  scope_id?: string;
  workflow_run_id?: string;
  limit?: number;
}

export interface ListRunningWorkflowsResult {
  scope_id: string | null;
  count: number;
  running_workflows: RunningWorkflowSummary[];
  summary: string;
}
