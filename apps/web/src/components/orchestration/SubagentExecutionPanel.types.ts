export interface SubagentExecutionRecord {
  executionId: string;
  status: string;
  assignedFiles: string[];
  startedAt?: string;
  completedAt?: string;
  overlapError?: string;
  waitSummary?: string;
}

export interface SubagentExecutionRow {
  executionId: string;
  status: string;
  assignedFiles: readonly string[];
  startedAt?: string;
  completedAt?: string;
  overlapError?: string;
  waitSummary?: string;
}