export interface WorkflowRuntimeTerminalRunActionContext {
  readonly action: string;
  readonly jobId?: string;
  readonly stepId?: string;
}
