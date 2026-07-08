export type CoreWorkflowRunLifecycleEventType =
  | "core.workflow.run.requested.v1"
  | "core.workflow.run.accepted.v1"
  | "core.workflow.run.status_changed.v1"
  | "core.workflow.run.completed.v1";

export interface CoreRunProjection {
  runId: string;
  workflowId: string;
  status: string;
  project_id: string | null;
  workItemId: string | null;
  occurredAt: string;
  lastEventId: string;
  lastEventType: CoreWorkflowRunLifecycleEventType;
}
