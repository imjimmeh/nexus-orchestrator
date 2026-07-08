import type { ApiResponse, PaginatedResponse } from "./common.types";
import type {
  ExecutionSummary,
  Workflow,
  WorkflowEventRecord,
  WorkflowEventsPage,
  WorkflowEventsQuery,
  WorkflowRun,
  WorkflowRunGraph,
  WorkflowTelemetryAuth,
  WorkflowTelemetryEvent,
  WorkflowWorkspaceTreeNode,
} from "./workflows.types";
import type {
  ListWorkflowsParams,
  WorkflowLaunchContextQuery,
  WorkflowLaunchContractResponse,
  WorkflowLaunchDescriptor,
  WorkflowLaunchPreset,
} from "./workflow-launch.types";
import type {
  RefreshRepositoryWorkflowsRequest,
  RefreshRepositoryWorkflowsResult,
  WorkflowLifecycleResult,
  WorkflowLifecycleResultsQuery,
  WorkflowRunAutonomyDiagnostics,
  WorkflowRunRetrospectiveTrace,
} from "./workflow-lifecycle.types";
import type { WorkflowRunTodoList } from "./workflow-todos.types";
import type {
  AcpDiscoveredAgent,
  AcpReloadServerResult,
  AcpServer,
  AcpServerTestResult,
} from "./acp.types";
import type {
  McpReloadResult,
  McpReloadServerResult,
  McpServer,
  McpServerRegistryTool,
  McpServerTestResult,
} from "./mcp.types";
import type { Tool, ToolCandidate, ToolValidationRun } from "./tools.types";
import type { ApiClient } from "./client";
import type { ApiClientWorkflowMethods } from "./client.workflow.types";
import { workflowSessionApiMethods } from "./client.workflow.sessions";

const WORKFLOW_CATALOG_PAGE_SIZE = 100;

function toWorkflowQueryParams(
  params: ListWorkflowsParams = {},
): Record<string, string> {
  const query: Record<string, string> = {};
  if (params.limit !== undefined) query.limit = String(params.limit);
  if (params.offset !== undefined) query.offset = String(params.offset);
  if (params.search) query.search = params.search;
  if (params.sortBy) query.sortBy = params.sortBy;
  if (params.sortDir) query.sortDir = params.sortDir;
  if (params.includeInactive !== undefined) {
    query.includeInactive = String(params.includeInactive);
  }
  if (params.isActive !== undefined) query.isActive = String(params.isActive);
  if (params.scopeNodeId !== undefined) query.scopeNodeId = params.scopeNodeId;
  return query;
}

async function fetchWorkflowPage(
  client: Pick<ApiClient, "client">,
  params: ListWorkflowsParams = {},
): Promise<PaginatedResponse<Workflow>> {
  const query = toWorkflowQueryParams(params);
  const response = await client.client.get<PaginatedResponse<Workflow>>(
    "/workflows",
    { params: Object.keys(query).length > 0 ? query : undefined },
  );
  return response.data;
}

function toLaunchQueryParams(
  query: WorkflowLaunchContextQuery,
): Record<string, string> | undefined {
  const params: Record<string, string> = {};

  if (query.projectId) {
    params.projectId = query.projectId;
  }

  if (query.workItemId) {
    params.workItemId = query.workItemId;
  }

  return Object.keys(params).length > 0 ? params : undefined;
}

function toWorkflowEventsPage(
  response: PaginatedResponse<WorkflowEventRecord>,
  query: WorkflowEventsQuery,
): WorkflowEventsPage {
  const pagination = response.meta?.pagination;

  return {
    data: response.data,
    total: pagination?.total ?? response.data.length,
    limit: pagination?.limit ?? query.limit ?? response.data.length,
    offset: pagination?.offset ?? query.offset ?? 0,
  };
}

const workflowApiMethods: ApiClientWorkflowMethods = {
  async getWorkflows(params: ListWorkflowsParams = {}) {
    const limit = params.limit ?? WORKFLOW_CATALOG_PAGE_SIZE;
    let offset = params.offset ?? 0;
    const workflows: Workflow[] = [];

    while (true) {
      const response = await fetchWorkflowPage(this, {
        ...params,
        limit,
        offset,
      });
      workflows.push(...response.data);
      const total = response.meta?.pagination?.total ?? workflows.length;

      if (workflows.length >= total) {
        break;
      }

      offset += limit;
    }

    return workflows;
  },

  async getWorkflowsPage(params: ListWorkflowsParams = {}) {
    return fetchWorkflowPage(this, params);
  },

  async getWorkflow(id) {
    return this.get<Workflow>(`/workflows/${id}`);
  },

  async createWorkflow(data) {
    return this.post<Workflow>("/workflows", data);
  },

  async updateWorkflow(id, data) {
    return this.patch<Workflow>(`/workflows/${id}`, data);
  },

  async deleteWorkflow(id) {
    return this.delete(`/workflows/${id}`);
  },

  async executeWorkflow(id, request) {
    const triggerData = request?.trigger_data ?? request?.input ?? {};

    return this.post<{ runId: string }>(`/workflows/${id}/execute`, {
      trigger_data: triggerData,
      project_id: request?.project_id,
      work_item_id: request?.work_item_id,
      preset_id: request?.preset_id,
      launch_source: request?.launch_source,
      dry_run: request?.dry_run,
    });
  },

  async executeProjectScopedWorkflow(projectId, workflowId, request) {
    const triggerData = request?.trigger_data ?? request?.input ?? {};

    return this.post<{ runId: string }>(`/workflows/${workflowId}/execute`, {
      trigger_data: triggerData,
      project_id: projectId ?? request?.project_id,
      work_item_id: request?.work_item_id,
      preset_id: request?.preset_id,
      launch_source: request?.launch_source,
      dry_run: request?.dry_run,
    });
  },

  async getWorkflowLaunchOptions(query = {}) {
    const response = await this.client.get<
      ApiResponse<WorkflowLaunchDescriptor[]>
    >("/workflows/launch-options", {
      params: toLaunchQueryParams(query),
    });

    return response.data.data;
  },

  async getWorkflowLaunchContract(workflowId, query = {}) {
    const response = await this.client.get<
      ApiResponse<WorkflowLaunchContractResponse>
    >(`/workflows/${workflowId}/launch-contract`, {
      params: toLaunchQueryParams(query),
    });

    return response.data.data;
  },

  async listWorkflowLaunchPresets(workflowId, query = {}) {
    const response = await this.client.get<ApiResponse<WorkflowLaunchPreset[]>>(
      `/workflows/${workflowId}/launch-presets`,
      {
        params: toLaunchQueryParams(query),
      },
    );

    return response.data.data;
  },

  async createWorkflowLaunchPreset(workflowId, request) {
    return this.post<WorkflowLaunchPreset>(
      `/workflows/${workflowId}/launch-presets`,
      request,
    );
  },

  async updateWorkflowLaunchPreset(workflowId, presetId, request) {
    return this.patch<WorkflowLaunchPreset>(
      `/workflows/${workflowId}/launch-presets/${presetId}`,
      request,
    );
  },

  async deleteWorkflowLaunchPreset(workflowId, presetId) {
    return this.delete<{ id: string }>(
      `/workflows/${workflowId}/launch-presets/${presetId}`,
    );
  },

  async getWorkflowRuns(query = {}) {
    const params: Record<string, string> = {};

    if (query.workflowId) {
      params.workflowId = query.workflowId;
    }

    const scopeId = query.scopeId ?? query.projectId;
    if (scopeId) {
      params.scopeId = scopeId;
    }

    if (query.sourceType) {
      params.sourceType = query.sourceType;
    }

    if (query.status) {
      params.status = query.status;
    }

    if (query.search) {
      params.search = query.search;
    }

    if (query.sortBy) {
      params.sortBy = query.sortBy;
    }

    if (query.sortDir) {
      params.sortDir = query.sortDir;
    }

    if (query.limit !== undefined) {
      params.limit = String(query.limit);
    }

    if (query.offset !== undefined) {
      params.offset = String(query.offset);
    }

    const response = await this.client.get<PaginatedResponse<WorkflowRun>>(
      "/workflows/runs",
      {
        params: Object.keys(params).length > 0 ? params : undefined,
      },
    );
    return response.data;
  },

  async getWorkflowRun(runId) {
    return this.get<WorkflowRun>(`/workflows/runs/${runId}`);
  },

  async getWorkflowLifecycleResults(query: WorkflowLifecycleResultsQuery) {
    const params: Record<string, string> = {
      scopeId: query.scopeId,
    };

    if (query.contextId) {
      params.contextId = query.contextId;
    }

    if (query.phase) {
      params.phase = query.phase;
    }

    if (query.hook) {
      params.hook = query.hook;
    }

    const response = await this.client.get<
      ApiResponse<WorkflowLifecycleResult[]>
    >("/workflows/lifecycle/results", { params });

    return response.data.data;
  },

  async refreshRepositoryWorkflows(request: RefreshRepositoryWorkflowsRequest) {
    return this.post<RefreshRepositoryWorkflowsResult>(
      "/workflows/repository/refresh",
      request,
    );
  },

  async getWorkflowRunGraph(runId) {
    return this.get<WorkflowRunGraph>(`/workflows/runs/${runId}/graph`);
  },

  async listRunExecutions(runId) {
    return this.get<ExecutionSummary[]>(`/workflows/runs/${runId}/executions`);
  },

  async getWorkflowGraph(workflowId) {
    return this.get<WorkflowRunGraph>(`/workflows/${workflowId}/graph`);
  },

  async getWorkflowRunEvents(runId) {
    const response = await this.client.get<
      ApiResponse<WorkflowTelemetryEvent[]>
    >(`/workflows/runs/${runId}/events`);
    return response.data.data;
  },

  async getWorkflowRunAutonomyDiagnostics(runId) {
    return this.get<WorkflowRunAutonomyDiagnostics>(
      `/workflows/runs/${runId}/autonomy/diagnostics`,
    );
  },

  async getWorkflowRunRetrospectiveTrace(runId) {
    return this.get<WorkflowRunRetrospectiveTrace>(
      `/workflows/runs/${runId}/retrospective-trace`,
    );
  },

  async getWorkflowEvents(query = {}) {
    const params: Record<string, string> = {};

    const scopeId = query.scopeId ?? query.projectId;
    if (scopeId) {
      params.scopeId = scopeId;
    }

    if (query.search) {
      params.search = query.search;
    }

    if (query.sortBy) {
      params.sortBy = query.sortBy;
    }

    if (query.sortDir) {
      params.sortDir = query.sortDir;
    }

    if (query.limit !== undefined) {
      params.limit = String(query.limit);
    }

    if (query.offset !== undefined) {
      params.offset = String(query.offset);
    }

    const response = await this.client.get<
      PaginatedResponse<WorkflowEventRecord>
    >("/workflows/events", {
      params: Object.keys(params).length > 0 ? params : undefined,
    });

    return toWorkflowEventsPage(response.data, query);
  },

  async getWorkflowRunTelemetryAuth(runId) {
    return this.get<WorkflowTelemetryAuth>(
      `/workflows/runs/${runId}/telemetry-auth`,
    );
  },

  async pauseWorkflowRun(runId) {
    return this.post<{ containerId: string }>(
      `/workflows/runs/${runId}/control/pause`,
      {},
    );
  },

  async resumeWorkflowRun(runId) {
    return this.post<{ containerId: string }>(
      `/workflows/runs/${runId}/control/resume`,
      {},
    );
  },

  async abortWorkflowRun(runId) {
    return this.post<{ containerId: string | null }>(
      `/workflows/runs/${runId}/control/abort`,
      {},
    );
  },

  async injectWorkflowRunMessage(runId, message) {
    return this.post<{ acknowledged: true }>(
      `/workflows/runs/${runId}/inject`,
      {
        message,
      },
    );
  },

  async submitQuestionAnswers(runId, answers) {
    return this.post<{ acknowledged: true }>(
      `/workflows/runs/${runId}/question-answers`,
      { answers },
    );
  },

  async getWorkflowRunWorkspaceTree(runId) {
    return this.get<WorkflowWorkspaceTreeNode[]>(
      `/workflows/runs/${runId}/workspace/tree`,
    );
  },

  async getWorkflowRunWorkspaceDiff(runId) {
    return this.get<{ diff: string }>(
      `/workflows/runs/${runId}/workspace/diff`,
    );
  },

  async getWorkflowRunWorkspaceFileContent(runId, filePath) {
    return this.get<{ content: string }>(
      `/workflows/runs/${runId}/workspace/file?path=${encodeURIComponent(filePath)}`,
    );
  },

  async getWorkflowRunTodoList(runId) {
    return this.get<WorkflowRunTodoList>(`/workflows/runs/${runId}/todo-list`);
  },

  async updateWorkflowRunTodoList(runId, request) {
    return this.post<WorkflowRunTodoList>(
      `/workflows/runs/${runId}/todo-list`,
      request,
    );
  },

  async getTools(params) {
    const response = await this.client.get<PaginatedResponse<Tool>>("/tools", {
      params: params ?? {},
    });
    return response.data;
  },

  async getTool(id) {
    return this.get<Tool>(`/tools/${id}`);
  },

  async createTool(data) {
    return this.post<Tool>("/tools", data);
  },

  async updateTool(id, data) {
    return this.patch<Tool>(`/tools/${id}`, data);
  },

  async deleteTool(id) {
    return this.delete(`/tools/${id}`);
  },

  async createToolCandidate(data) {
    return this.post<ToolCandidate>("/tools/candidates", data);
  },

  async getToolCandidates(params) {
    const response = await this.client.get<PaginatedResponse<ToolCandidate>>(
      "/tools/candidates",
      { params },
    );
    return response.data.data;
  },

  async getToolCandidate(id) {
    return this.get<ToolCandidate>(`/tools/candidates/${id}`);
  },

  async getToolCandidateValidationRuns(id, params) {
    const response = await this.client.get<
      PaginatedResponse<ToolValidationRun>
    >(`/tools/candidates/${id}/validation-runs`, { params });
    return response.data.data;
  },

  async validateToolCandidate(id) {
    return this.post<{
      artifact: ToolCandidate;
      validation_run: ToolValidationRun;
    }>(`/tools/candidates/${id}/validate`, {});
  },

  async publishToolCandidate(id) {
    return this.post<{ artifact: ToolCandidate; registry: Tool }>(
      `/tools/candidates/${id}/publish`,
      {},
    );
  },

  async getMcpServers() {
    return this.get<McpServer[]>("/mcp/servers");
  },

  async createMcpServer(data) {
    return this.post<McpServer>("/mcp/servers", data);
  },

  async updateMcpServer(id, data) {
    return this.patch<McpServer>(`/mcp/servers/${id}`, data);
  },

  async deleteMcpServer(id) {
    return this.delete<{ id: string }>(`/mcp/servers/${id}`);
  },

  async testMcpServer(id) {
    return this.post<McpServerTestResult>(`/mcp/servers/${id}/test`, {});
  },

  async reloadMcpServer(id) {
    return this.post<McpReloadServerResult>(`/mcp/servers/${id}/reload`, {});
  },

  async reloadMcpServers() {
    return this.post<McpReloadResult>("/mcp/reload", {});
  },

  async getMcpServerTools(id) {
    return this.get<McpServerRegistryTool[]>(`/mcp/servers/${id}/tools`);
  },

  async getAcpServers() {
    return this.get<AcpServer[]>("/acp/servers");
  },

  async createAcpServer(data) {
    return this.post<AcpServer>("/acp/servers", data);
  },

  async updateAcpServer(id, data) {
    return this.patch<AcpServer>(`/acp/servers/${id}`, data);
  },

  async deleteAcpServer(id) {
    return this.delete<{ id: string }>(`/acp/servers/${id}`);
  },

  async testAcpServer(id) {
    return this.post<AcpServerTestResult>(`/acp/servers/${id}/test`, {});
  },

  async reloadAcpServer(id) {
    return this.post<AcpReloadServerResult>(`/acp/servers/${id}/reload`, {});
  },

  async reloadAcpServers() {
    return this.post<{ results: AcpReloadServerResult[] }>("/acp/reload", {});
  },

  async listAcpDiscoveredAgents(serverId) {
    return this.get<AcpDiscoveredAgent[]>(`/acp/servers/${serverId}/agents`);
  },

  ...workflowSessionApiMethods,
};

export { workflowApiMethods };
export type { ApiClientWorkflowMethods } from "./client.workflow.types";
