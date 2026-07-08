export interface IdleCallbacks {
  onStop: (workflowRunId: string, containerId: string) => Promise<void>;
  onRemove: (workflowRunId: string, containerId: string) => Promise<void>;
}
