import type { PaginatedResponse } from "./common.types";
import type {
  AdHocSessionListItem,
  CreateAdHocSessionRequest,
  CreateAdHocSessionResponse,
} from "./ad-hoc-sessions.types";
import type {
  ChatSessionDetail,
  ChatSessionListItem,
  ChatSessionParticipant,
  ChatSessionState,
  ChatTelemetryAuth,
  CreateChatSessionRequest,
  CreateChatSessionResponse,
  InviteChatSessionParticipantRequest,
  InviteChatSessionParticipantResponse,
} from "./chat-sessions.types";
import type {
  CreateToolCandidateRequest,
  CreateToolRequest,
  Tool,
  ToolCandidate,
  ToolValidationRun,
  UpdateToolRequest,
} from "./tools.types";
import type {
  CreateMcpServerRequest,
  McpReloadResult,
  McpReloadServerResult,
  McpServer,
  McpServerRegistryTool,
  McpServerTestResult,
  UpdateMcpServerRequest,
} from "./mcp.types";
import type {
  AcpDiscoveredAgent,
  AcpReloadServerResult,
  AcpServer,
  AcpServerTestResult,
  CreateAcpServerRequest,
  UpdateAcpServerRequest,
} from "./acp.types";
import type {
  CreateWorkflowLaunchPresetRequest,
  CreateWorkflowRequest,
  ExecuteWorkflowRequest,
  ListWorkflowsParams,
  UpdateWorkflowLaunchPresetRequest,
  UpdateWorkflowRequest,
  WorkflowLaunchContextQuery,
  WorkflowLaunchContractResponse,
  WorkflowLaunchDescriptor,
  WorkflowLaunchPreset,
} from "./workflow-launch.types";
import type {
  ExecutionSummary,
  Workflow,
  WorkflowEventsPage,
  WorkflowEventsQuery,
  WorkflowRun,
  WorkflowRunGraph,
  WorkflowRunsQuery,
  WorkflowTelemetryAuth,
  WorkflowTelemetryEvent,
  WorkflowWorkspaceTreeNode,
} from "./workflows.types";
import type {
  RefreshRepositoryWorkflowsRequest,
  RefreshRepositoryWorkflowsResult,
  WorkflowLifecycleResult,
  WorkflowLifecycleResultsQuery,
  WorkflowRunAutonomyDiagnostics,
  WorkflowRunRetrospectiveTrace,
} from "./workflow-lifecycle.types";
import type {
  UpdateWorkflowRunTodoListRequest,
  WorkflowRunTodoList,
} from "./workflow-todos.types";
import type { ToolsQueryParams } from "@nexus/core";
import type { ApiClient } from "./client";

interface ApiClientWorkflowMethods {
  getWorkflows(
    this: ApiClient,
    params?: ListWorkflowsParams,
  ): Promise<Workflow[]>;
  getWorkflowsPage(
    this: ApiClient,
    params?: ListWorkflowsParams,
  ): Promise<PaginatedResponse<Workflow>>;
  getWorkflow(this: ApiClient, id: string): Promise<Workflow>;
  createWorkflow(
    this: ApiClient,
    data: CreateWorkflowRequest,
  ): Promise<Workflow>;
  updateWorkflow(
    this: ApiClient,
    id: string,
    data: UpdateWorkflowRequest,
  ): Promise<Workflow>;
  deleteWorkflow(this: ApiClient, id: string): Promise<void>;
  executeWorkflow(
    this: ApiClient,
    id: string,
    request?: ExecuteWorkflowRequest,
  ): Promise<{ runId: string }>;
  executeProjectScopedWorkflow(
    this: ApiClient,
    projectId: string,
    workflowId: string,
    request?: ExecuteWorkflowRequest,
  ): Promise<{ runId: string }>;
  getWorkflowLaunchOptions(
    this: ApiClient,
    query?: WorkflowLaunchContextQuery,
  ): Promise<WorkflowLaunchDescriptor[]>;
  getWorkflowLaunchContract(
    this: ApiClient,
    workflowId: string,
    query?: WorkflowLaunchContextQuery,
  ): Promise<WorkflowLaunchContractResponse>;
  listWorkflowLaunchPresets(
    this: ApiClient,
    workflowId: string,
    query?: WorkflowLaunchContextQuery,
  ): Promise<WorkflowLaunchPreset[]>;
  createWorkflowLaunchPreset(
    this: ApiClient,
    workflowId: string,
    request: CreateWorkflowLaunchPresetRequest,
  ): Promise<WorkflowLaunchPreset>;
  updateWorkflowLaunchPreset(
    this: ApiClient,
    workflowId: string,
    presetId: string,
    request: UpdateWorkflowLaunchPresetRequest,
  ): Promise<WorkflowLaunchPreset>;
  deleteWorkflowLaunchPreset(
    this: ApiClient,
    workflowId: string,
    presetId: string,
  ): Promise<{ id: string }>;
  getWorkflowRuns(
    this: ApiClient,
    query?: WorkflowRunsQuery,
  ): Promise<PaginatedResponse<WorkflowRun>>;
  getWorkflowRun(this: ApiClient, runId: string): Promise<WorkflowRun>;
  getWorkflowLifecycleResults(
    this: ApiClient,
    query: WorkflowLifecycleResultsQuery,
  ): Promise<WorkflowLifecycleResult[]>;
  refreshRepositoryWorkflows(
    this: ApiClient,
    request: RefreshRepositoryWorkflowsRequest,
  ): Promise<RefreshRepositoryWorkflowsResult>;
  getWorkflowRunGraph(
    this: ApiClient,
    runId: string,
  ): Promise<WorkflowRunGraph>;
  listRunExecutions(
    this: ApiClient,
    runId: string,
  ): Promise<ExecutionSummary[]>;
  getWorkflowGraph(
    this: ApiClient,
    workflowId: string,
  ): Promise<WorkflowRunGraph>;
  getWorkflowRunEvents(
    this: ApiClient,
    runId: string,
  ): Promise<WorkflowTelemetryEvent[]>;
  getWorkflowRunAutonomyDiagnostics(
    this: ApiClient,
    runId: string,
  ): Promise<WorkflowRunAutonomyDiagnostics>;
  getWorkflowRunRetrospectiveTrace(
    this: ApiClient,
    runId: string,
  ): Promise<WorkflowRunRetrospectiveTrace>;
  getWorkflowEvents(
    this: ApiClient,
    query?: WorkflowEventsQuery,
  ): Promise<WorkflowEventsPage>;
  getWorkflowRunTelemetryAuth(
    this: ApiClient,
    runId: string,
  ): Promise<WorkflowTelemetryAuth>;
  pauseWorkflowRun(
    this: ApiClient,
    runId: string,
  ): Promise<{ containerId: string }>;
  resumeWorkflowRun(
    this: ApiClient,
    runId: string,
  ): Promise<{ containerId: string }>;
  abortWorkflowRun(
    this: ApiClient,
    runId: string,
  ): Promise<{ containerId: string | null }>;
  injectWorkflowRunMessage(
    this: ApiClient,
    runId: string,
    message: string,
  ): Promise<{ acknowledged: true }>;
  submitQuestionAnswers(
    this: ApiClient,
    runId: string,
    answers: Array<{
      questionIndex: number;
      selectedOption: string | null;
      freeTextAnswer: string | null;
    }>,
  ): Promise<{ acknowledged: true }>;
  getWorkflowRunWorkspaceTree(
    this: ApiClient,
    runId: string,
  ): Promise<WorkflowWorkspaceTreeNode[]>;
  getWorkflowRunWorkspaceDiff(
    this: ApiClient,
    runId: string,
  ): Promise<{ diff: string }>;
  getWorkflowRunWorkspaceFileContent(
    this: ApiClient,
    runId: string,
    filePath: string,
  ): Promise<{ content: string }>;
  getWorkflowRunTodoList(
    this: ApiClient,
    runId: string,
  ): Promise<WorkflowRunTodoList>;
  updateWorkflowRunTodoList(
    this: ApiClient,
    runId: string,
    request: UpdateWorkflowRunTodoListRequest,
  ): Promise<WorkflowRunTodoList>;
  getTools(
    this: ApiClient,
    params?: ToolsQueryParams,
  ): Promise<PaginatedResponse<Tool>>;
  getTool(this: ApiClient, id: string): Promise<Tool>;
  createTool(this: ApiClient, data: CreateToolRequest): Promise<Tool>;
  updateTool(
    this: ApiClient,
    id: string,
    data: UpdateToolRequest,
  ): Promise<Tool>;
  deleteTool(this: ApiClient, id: string): Promise<void>;
  createToolCandidate(
    this: ApiClient,
    data: CreateToolCandidateRequest,
  ): Promise<ToolCandidate>;
  getToolCandidates(
    this: ApiClient,
    params?: {
      limit?: number;
      offset?: number;
      status?: "draft" | "validated" | "published" | "failed";
      tool_name?: string;
    },
  ): Promise<ToolCandidate[]>;
  getToolCandidate(this: ApiClient, id: string): Promise<ToolCandidate>;
  getToolCandidateValidationRuns(
    this: ApiClient,
    id: string,
    params?: { limit?: number; offset?: number },
  ): Promise<ToolValidationRun[]>;
  validateToolCandidate(
    this: ApiClient,
    id: string,
  ): Promise<{ artifact: ToolCandidate; validation_run: ToolValidationRun }>;
  publishToolCandidate(
    this: ApiClient,
    id: string,
  ): Promise<{ artifact: ToolCandidate; registry: Tool }>;
  getMcpServers(this: ApiClient): Promise<McpServer[]>;
  createMcpServer(
    this: ApiClient,
    data: CreateMcpServerRequest,
  ): Promise<McpServer>;
  updateMcpServer(
    this: ApiClient,
    id: string,
    data: UpdateMcpServerRequest,
  ): Promise<McpServer>;
  deleteMcpServer(this: ApiClient, id: string): Promise<{ id: string }>;
  testMcpServer(this: ApiClient, id: string): Promise<McpServerTestResult>;
  reloadMcpServer(this: ApiClient, id: string): Promise<McpReloadServerResult>;
  reloadMcpServers(this: ApiClient): Promise<McpReloadResult>;
  getMcpServerTools(
    this: ApiClient,
    id: string,
  ): Promise<McpServerRegistryTool[]>;
  getAcpServers(this: ApiClient): Promise<AcpServer[]>;
  createAcpServer(
    this: ApiClient,
    data: CreateAcpServerRequest,
  ): Promise<AcpServer>;
  updateAcpServer(
    this: ApiClient,
    id: string,
    data: UpdateAcpServerRequest,
  ): Promise<AcpServer>;
  deleteAcpServer(this: ApiClient, id: string): Promise<{ id: string }>;
  testAcpServer(this: ApiClient, id: string): Promise<AcpServerTestResult>;
  reloadAcpServer(this: ApiClient, id: string): Promise<AcpReloadServerResult>;
  reloadAcpServers(
    this: ApiClient,
  ): Promise<{ results: AcpReloadServerResult[] }>;
  listAcpDiscoveredAgents(
    this: ApiClient,
    serverId: string,
  ): Promise<AcpDiscoveredAgent[]>;
  createAdHocSession(
    this: ApiClient,
    request: CreateAdHocSessionRequest,
  ): Promise<CreateAdHocSessionResponse>;
  getAdHocSessions(
    this: ApiClient,
    params?: {
      projectId?: string;
      status?: string;
    },
  ): Promise<AdHocSessionListItem[]>;
  createChatSession(
    this: ApiClient,
    request: CreateChatSessionRequest,
  ): Promise<CreateChatSessionResponse>;
  getChatSessions(
    this: ApiClient,
    params?: {
      projectId?: string;
      status?: string;
      search?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<PaginatedResponse<ChatSessionListItem>>;
  getChatSession(this: ApiClient, id: string): Promise<ChatSessionDetail>;
  getChatSessionParticipants(
    this: ApiClient,
    id: string,
  ): Promise<ChatSessionParticipant[]>;
  getChatSessionState(this: ApiClient, id: string): Promise<ChatSessionState>;
  inviteChatSessionParticipant(
    this: ApiClient,
    id: string,
    request: InviteChatSessionParticipantRequest,
  ): Promise<InviteChatSessionParticipantResponse>;
  cancelChatSession(this: ApiClient, id: string): Promise<void>;
  getChatSessionChildren(
    this: ApiClient,
    id: string,
  ): Promise<ChatSessionListItem[]>;
  retryChatSessionNow(
    this: ApiClient,
    id: string,
  ): Promise<ChatSessionListItem>;
  getChatSessionTelemetryAuth(
    this: ApiClient,
    id: string,
  ): Promise<ChatTelemetryAuth>;
  getChatSessionEvents(
    this: ApiClient,
    id: string,
  ): Promise<Record<string, unknown>[]>;
  sendChatSessionMessage(
    this: ApiClient,
    id: string,
    message: string,
    attachmentIds?: string[],
  ): Promise<{ acknowledged: true }>;
  submitChatSessionQuestionAnswers(
    this: ApiClient,
    id: string,
    answers: Array<{
      questionIndex: number;
      selectedOption: string | null;
      freeTextAnswer: string | null;
    }>,
  ): Promise<{ acknowledged: true }>;
}

export type { ApiClientWorkflowMethods };
