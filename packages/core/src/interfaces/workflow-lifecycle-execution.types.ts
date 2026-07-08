export type WorkflowLifecycleResultStatus =
  | "passed"
  | "failed"
  | "skipped"
  | "timed_out"
  | "unavailable";

export interface WorkflowLifecycleExecutionRequest {
  scopeId: string;
  contextId?: string;
  phase: string;
  hook: string;
  blockingOnly?: boolean;
  timeoutMs?: number;
  pollIntervalMs?: number;
  payload?: Record<string, unknown>;
  repositoryRef?: string;
}

export interface WorkflowLifecycleWorkflowResult {
  workflowId: string;
  workflowDefinitionId: string;
  workflowName: string;
  phase: string;
  hook: string;
  blocking: boolean;
  status: WorkflowLifecycleResultStatus;
  runId?: string;
  error?: string;
}

export interface WorkflowLifecycleExecutionResult {
  id?: string;
  scopeId: string;
  contextId?: string;
  phase: string;
  hook: string;
  blockingOnly: boolean;
  status: WorkflowLifecycleResultStatus;
  results: WorkflowLifecycleWorkflowResult[];
}
