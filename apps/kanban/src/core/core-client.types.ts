import type {
  WorkflowRunAcceptedV1,
  WorkflowRunControlRequestV1,
  WorkflowRunControlResultV1,
  WorkflowRunRequestV1,
  WorkflowRunScopeCancelRequestV1,
  WorkflowRunScopeCancelResultV1,
  WorkflowRunStatusV1,
} from "@nexus/core";

export type EventLedgerPayload = {
  domain: string;
  eventName: string;
  outcome: "success" | "failure" | "denied" | "in_progress";
  severity?: "info" | "warn" | "error" | "critical";
  source?: string;
  actorType?: "user" | "agent" | "system";
  actorId?: string;
  project_id?: string;
  workItemId?: string;
  workflowId?: string;
  workflowRunId?: string;
  jobId?: string;
  stepId?: string;
  toolId?: string;
  toolName?: string;
  subagentExecutionId?: string;
  sessionTreeId?: string;
  requestId?: string;
  correlationId?: string;
  parentEventId?: string;
  payload?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
};

export interface WorkflowRunClient {
  requestWorkflowRun(
    request: WorkflowRunRequestV1,
  ): Promise<WorkflowRunAcceptedV1>;
  getWorkflowRunStatus(
    runId: string,
    correlationId: string,
  ): Promise<WorkflowRunStatusV1>;
}

export interface WorkflowRunControlClient {
  controlWorkflowRun(
    request: WorkflowRunControlRequestV1,
  ): Promise<WorkflowRunControlResultV1>;
  cancelWorkflowRunsByScope(
    scopeId: string,
    request: WorkflowRunScopeCancelRequestV1,
  ): Promise<WorkflowRunScopeCancelResultV1>;
}

export interface WorkflowJobOutputClient {
  setWorkflowJobOutput(request: {
    workflowRunId: string;
    jobId: string;
    data: Record<string, unknown>;
  }): Promise<{ ok: boolean }>;
}

export interface CoreSecretClient {
  retrieveSecret(secretId: string): Promise<string>;
}

export interface CoreEventLedgerClient {
  emitEventLedger(payload: EventLedgerPayload): Promise<void>;
}

export interface KanbanDomainEventPublisher {
  emitDomainEvent(params: {
    eventName: string;
    eventId?: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
}

export interface WorkflowStepControlClient {
  stepComplete(request: {
    workflowRunId: string;
    jobId: string;
  }): Promise<{ ok: boolean }>;
}

export interface InternalServiceAuthTokenProvider {
  resolveAuthorizationHeader(): string;
}

export interface EnsureProjectNodeInput {
  id: string;
  parentId: string | null;
  type: "project";
  name: string;
  slug: string;
}

export interface ScopeNodeRecord {
  id: string;
  parentId: string | null;
  type: string;
  name: string;
  slug: string;
}

export interface CoreScopeClient {
  ensureProjectNode(input: EnsureProjectNodeInput): Promise<ScopeNodeRecord>;
}
