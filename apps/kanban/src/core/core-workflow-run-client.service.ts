import {
  CoreHttpClient,
  WorkflowRunRequestV1Schema,
  type ServiceClientHttpOptions,
  type WorkflowRunAcceptedV1,
  type WorkflowRunControlRequestV1,
  type WorkflowRunControlResultV1,
  type WorkflowRunRequestV1,
  type WorkflowRunScopeCancelRequestV1,
  type WorkflowRunScopeCancelResultV1,
  type WorkflowRunStatusV1,
} from "@nexus/core";
import type {
  WorkflowRunClient,
  WorkflowRunControlClient,
} from "./core-client.types";

export class CoreWorkflowRunClientService
  implements WorkflowRunClient, WorkflowRunControlClient
{
  private readonly client: CoreHttpClient;

  constructor(httpOptions: ServiceClientHttpOptions) {
    this.client = new CoreHttpClient(httpOptions);
  }

  async requestWorkflowRun(
    request: WorkflowRunRequestV1,
  ): Promise<WorkflowRunAcceptedV1> {
    const parsed = WorkflowRunRequestV1Schema.parse(request);
    return this.client.requestWorkflowRun(parsed);
  }

  async getWorkflowRunStatus(
    runId: string,
    correlationId: string,
  ): Promise<WorkflowRunStatusV1> {
    return this.client.getWorkflowRunStatus(runId, correlationId);
  }

  async controlWorkflowRun(
    request: WorkflowRunControlRequestV1,
  ): Promise<WorkflowRunControlResultV1> {
    return this.client.controlWorkflowRun(request);
  }

  async cancelWorkflowRunsByScope(
    scopeId: string,
    request: WorkflowRunScopeCancelRequestV1,
  ): Promise<WorkflowRunScopeCancelResultV1> {
    return this.client.cancelWorkflowRunsByScope(scopeId, request);
  }
}
