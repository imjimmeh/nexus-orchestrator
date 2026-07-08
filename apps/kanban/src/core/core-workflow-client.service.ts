import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  type ServiceClientHttpOptions,
  type WorkflowLifecycleExecutionRequest,
  type WorkflowLifecycleExecutionResult,
  type WorkflowRunAcceptedV1,
  type WorkflowRunControlRequestV1,
  type WorkflowRunControlResultV1,
  type WorkflowRunScopeCancelRequestV1,
  type WorkflowRunScopeCancelResultV1,
  type WorkflowRunRequestV1,
  type WorkflowRunStatusV1,
} from "@nexus/core";
import { CoreEventLedgerClientService } from "./core-event-ledger-client.service";
import { CoreSecretClientService } from "./core-secret-client.service";
import { CoreWorkflowRunClientService } from "./core-workflow-run-client.service";
import { KanbanDomainEventPublisherService } from "./kanban-domain-event-publisher.service";
import type { CommitPathsResult } from "@nexus/core";
import { KanbanCoreAuthTokenProvider } from "./kanban-core-auth-token.provider";
import { KanbanCoreHttpClient } from "./kanban-core-http-client";
import type { RepositoryFileContent } from "@nexus/core";
import type {
  CoreEventLedgerClient,
  CoreSecretClient,
  EventLedgerPayload,
  KanbanDomainEventPublisher,
  WorkflowJobOutputClient,
  WorkflowRunClient,
  WorkflowRunControlClient,
  WorkflowStepControlClient,
} from "./core-client.types";

const DEFAULT_CORE_BASE_URL = "http://localhost:3010/api";

@Injectable()
export class CoreWorkflowClientService
  implements
    WorkflowRunClient,
    WorkflowRunControlClient,
    CoreSecretClient,
    CoreEventLedgerClient,
    KanbanDomainEventPublisher,
    WorkflowJobOutputClient,
    WorkflowStepControlClient
{
  private readonly logger = new Logger(CoreWorkflowClientService.name);
  private readonly workflowRunClient: CoreWorkflowRunClientService;
  private readonly secretClient: CoreSecretClientService;
  private readonly eventLedgerClient: CoreEventLedgerClientService;
  private readonly domainEventPublisher: KanbanDomainEventPublisherService;
  private readonly httpClient: KanbanCoreHttpClient;

  constructor(
    @Inject(KanbanCoreAuthTokenProvider)
    private readonly authTokenProvider = new KanbanCoreAuthTokenProvider(),
  ) {
    const coreBaseUrl =
      this.readOptionalEnv("KANBAN_CORE_BASE_URL") ?? DEFAULT_CORE_BASE_URL;
    const httpOptions = this.resolveHttpOptions(coreBaseUrl);
    this.httpClient = new KanbanCoreHttpClient(coreBaseUrl, httpOptions);

    this.workflowRunClient = new CoreWorkflowRunClientService(httpOptions);
    this.secretClient = new CoreSecretClientService(this.httpClient);
    this.eventLedgerClient = new CoreEventLedgerClientService(this.httpClient);
    this.domainEventPublisher = new KanbanDomainEventPublisherService(
      this.httpClient,
    );
  }

  async requestWorkflowRun(
    request: WorkflowRunRequestV1,
  ): Promise<WorkflowRunAcceptedV1> {
    return this.workflowRunClient.requestWorkflowRun(request);
  }

  async getWorkflowRunStatus(
    runId: string,
    correlationId: string,
  ): Promise<WorkflowRunStatusV1> {
    return this.workflowRunClient.getWorkflowRunStatus(runId, correlationId);
  }

  async controlWorkflowRun(
    request: WorkflowRunControlRequestV1,
  ): Promise<WorkflowRunControlResultV1> {
    return this.workflowRunClient.controlWorkflowRun(request);
  }

  async cancelWorkflowRunsByScope(
    scopeId: string,
    request: WorkflowRunScopeCancelRequestV1,
  ): Promise<WorkflowRunScopeCancelResultV1> {
    return this.workflowRunClient.cancelWorkflowRunsByScope(scopeId, request);
  }

  async executeLifecycleWorkflows(
    request: WorkflowLifecycleExecutionRequest,
  ): Promise<WorkflowLifecycleExecutionResult> {
    return this.httpClient.postJson<WorkflowLifecycleExecutionResult>(
      "/workflows/lifecycle/execute",
      request,
      "lifecycle execution",
    );
  }

  async retrieveSecret(secretId: string): Promise<string> {
    return this.secretClient.retrieveSecret(secretId);
  }

  async emitEventLedger(payload: EventLedgerPayload): Promise<void> {
    try {
      await this.eventLedgerClient.emitEventLedger(payload);
    } catch (error) {
      this.logger.warn(
        `Failed to emit Core event ledger entry: ${this.formatErrorMessage(error)}`,
      );
    }
  }

  async setWorkflowJobOutput(request: {
    workflowRunId: string;
    jobId: string;
    data: Record<string, unknown>;
  }): Promise<{ ok: boolean }> {
    return this.httpClient.postJson<{ ok: boolean }>(
      "/workflow-runtime/jobs/set-output",
      {
        workflow_run_id: request.workflowRunId,
        job_id: request.jobId,
        data: request.data,
      },
      "workflow job output",
    );
  }

  async emitDomainEvent(params: {
    eventName: string;
    eventId?: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.domainEventPublisher.emitDomainEvent(params);
    } catch (error) {
      this.logger.warn(
        `Failed to emit domain event: ${this.formatErrorMessage(error)}`,
      );
    }
  }

  async emitDomainEventOrThrow(params: {
    eventName: string;
    eventId?: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await this.domainEventPublisher.emitDomainEvent(params);
  }

  async refreshRepositoryWorkflows(request: {
    scopeId: string;
    rootPath: string;
    sourceRef?: string;
  }): Promise<{ discovered: number; upserted: number; disabled: number }> {
    return this.httpClient.postJson(
      "/workflows/repository/refresh",
      request,
      "repository workflow refresh",
    );
  }

  async stepComplete(request: {
    workflowRunId: string;
    jobId: string;
  }): Promise<{ ok: boolean }> {
    return this.httpClient.postJson<{ ok: boolean }>(
      "/workflow-runtime/step-complete",
      {
        workflow_run_id: request.workflowRunId,
        job_id: request.jobId,
      },
      "step complete",
    );
  }

  async commitPaths(params: {
    repoPath: string;
    paths: string[];
    message: string;
    push?: boolean;
  }): Promise<CommitPathsResult> {
    return this.httpClient.commitPaths(params);
  }

  async listWorkflowRuns(params: {
    scopeId: string;
    contextId: string;
    limit: number;
  }): Promise<
    Array<{
      id: string;
      workflow_id: string;
      status: string;
      current_step_id?: string | null;
      state_variables: Record<string, unknown>;
      created_at: string;
      updated_at: string;
    }>
  > {
    const query = new URLSearchParams();
    query.set("scopeId", params.scopeId);
    query.set("contextId", params.contextId);
    query.set("limit", String(params.limit));

    const response = await this.httpClient.getJson<{
      success: boolean;
      data: Array<{
        id: string;
        workflow_id: string;
        status: string;
        current_step_id?: string | null;
        state_variables: Record<string, unknown>;
        created_at: string;
        updated_at: string;
      }>;
    }>(`/workflows/runs?${query.toString()}`, "list workflow runs");

    return response.data;
  }

  private resolveHttpOptions(baseUrl: string): ServiceClientHttpOptions {
    return {
      baseUrl,
      authorizationHeaderResolver: () =>
        this.authTokenProvider.resolveAuthorizationHeader(),
    };
  }

  private readOptionalEnv(key: string): string | null {
    const value = process.env[key];
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  async listRepoFiles(params: {
    repoPath: string;
    directory: string;
    pattern?: string;
  }) {
    return this.httpClient.listRepoFiles(params);
  }

  async readRepoFile(params: { repoPath: string; filePath: string }) {
    return this.httpClient.readRepoFile(params);
  }

  async writeRepoFile(params: {
    repoPath: string;
    filePath: string;
    content: string;
    message: string;
    push?: boolean;
  }) {
    return this.httpClient.writeRepoFile(params);
  }

  async deleteRepoFile(params: {
    repoPath: string;
    filePath: string;
    message: string;
    push?: boolean;
  }) {
    return this.httpClient.deleteRepoFile(params);
  }

  async listRepositoryBranches(params: {
    repoPath: string;
  }): Promise<{ branches: string[] }> {
    return this.httpClient.listRepositoryBranches(params);
  }

  async listRepositoryTrackedFiles(params: {
    repoPath: string;
  }): Promise<{ files: string[] }> {
    return this.httpClient.listRepositoryTrackedFiles(params);
  }

  async showRepositoryFile(params: {
    repoPath: string;
    filePath: string;
    ref?: string;
  }): Promise<RepositoryFileContent> {
    return this.httpClient.showRepositoryFile(params);
  }

  private formatErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
