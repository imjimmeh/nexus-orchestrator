import type {
  FileContent,
  PaginatedWorkItems,
} from "./common.types";
import type {
  KanbanSetting,
  SystemSetting,
  TelegramSettings,
  UpdateTelegramSettingsRequest,
} from "./settings.types";
import type {
  InitializeSetupRequest,
  InitializeSetupResponse,
  SetupStatus,
} from "./setup.types";
import type {
  CreateScheduledJobRequest,
  ScheduledJob,
  ScheduledJobListResponse,
  ScheduledJobRun,
  ScheduledJobRunsListResponse,
  ScheduledJobScope,
  ScheduledJobStatus,
  UpdateScheduledJobRequest,
} from "./scheduled-jobs.types";
import type {
  CreateWorkItemRequest,
  MergeWorkItemRequest,
  MergeWorkItemResponse,
  UpdateWorkItemRequest,
  WorkItem,
  WorkItemCostSummaryItem,
} from "./work-items.types";
import type {
  ArchiveLearningCandidateRequest,
  BulkArchiveLearningCandidatesRequest,
  BulkPromoteLearningCandidatesRequest,
  BulkPromoteLearningCandidatesResult,
  BulkRejectLearningCandidatesRequest,
  CreateProjectRequest,
  LearningCandidate,
  LearningCandidateListResponse,
  LearningSweepRunSummary,
  LearningSweepStatus,
  ListLearningCandidatesRequest,
  Project,
  ProjectAgentsDocument,
  ProjectOrchestration,
  ProjectOrchestrationActionRequest,
  ProjectOrchestrationActionRequestListItem,
  ProjectOrchestrationMode,
  ProjectOrchestrationState,
  PromoteLearningCandidateRequest,
  PromoteLearningCandidateResponse,
  RejectLearningCandidateRequest,
  UpdateProjectAgentsFileRequest,
  UpdateProjectRequest,
} from "./projects.types";
import type {
  CreateProjectGoalRequest,
  CreateProjectGoalWorklogRequest,
  ProjectGoal,
  ProjectGoalWorklog,
  UpdateProjectGoalRequest,
  UpdateProjectGoalStatusRequest,
} from "./goals.types";
import type {
  CloseProjectWarRoomSessionRequest,
  CloseProjectWarRoomSessionResponse,
  InviteProjectWarRoomParticipantRequest,
  InviteProjectWarRoomParticipantResponse,
  ListProjectWarRoomSessionsResponse,
  OpenProjectWarRoomSessionRequest,
  OpenProjectWarRoomSessionResponse,
  PostProjectWarRoomMessageRequest,
  PostProjectWarRoomMessageResponse,
  ProjectOrchestrationDiagnostics,
  ProjectWarRoomStateResponse,
  ReplayProjectRetrospectiveRequest,
  ReplayProjectRetrospectiveResponse,
  RuntimeCapabilitiesSnapshot,
  StartupRoutingHints,
  StartupRoutingReadinessContext,
  StartupRoutingSourceContext,
  SubmitProjectWarRoomSignoffRequest,
  SubmitProjectWarRoomSignoffResponse,
  UpdateProjectWarRoomBlackboardRequest,
  UpdateProjectWarRoomBlackboardResponse,
} from "./orchestration.types";
import type {
  ListProjectMemorySegmentsRequest,
  ProjectMemorySegmentListResponse,
} from "./chat-sessions.types";
import type { WorkflowRun } from "./workflows.types";
import type { ApiClient } from "./client";
import type { ApiClientProjectAutomationMethods } from "./client.projects.automation.types";

export interface WorkItemListQuery {
  search?: string;
  status?: string;
  priority?: string;
  projectId?: string;
  sortBy?: "updated_at" | "created_at" | "title" | "status" | "priority";
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface WorkItemCostEstimateWhatIf {
  modelId: string;
  modelName: string;
  providerName: string | null;
  estimatedCostCents: number;
}

export interface WorkItemCostEstimate {
  available: boolean;
  bucketTier: string | null;
  sampleCount: number;
  estimatedCostCents: number | null;
  lowCostCents: number | null;
  highCostCents: number | null;
  whatIf: WorkItemCostEstimateWhatIf[];
  costCents?: number;
  predictedRemainingCostCents?: number | null;
  projectedTotalCostCents?: number | null;
  lowPredictedRemainingCostCents?: number | null;
  highPredictedRemainingCostCents?: number | null;
  lowProjectedTotalCostCents?: number | null;
  highProjectedTotalCostCents?: number | null;
  currentStage?: WorkItemCostEstimate;
  fullyImplement?: WorkItemCostEstimate;
}

export interface CharterMemoryItem {
  id: string;
  content: string;
  memory_type: string;
  metadata: {
    category: string;
    source: string;
    confidence?: number;
  };
  created_at: string;
  updated_at: string;
}

export type CharterMemoriesByCategory = Partial<
  Record<string, CharterMemoryItem[]>
>;

export interface CharterAggregate {
  vision: CharterMemoryItem | null;
  goals: ProjectGoal[];
  sections: Partial<Record<string, CharterMemoryItem[]>>;
}

interface ApiClientProjectMethods extends ApiClientProjectAutomationMethods {
  getProjects(this: ApiClient): Promise<Project[]>;
  getProject(this: ApiClient, id: string): Promise<Project>;
  getScheduledJobs(
    this: ApiClient,
    params: {
      scopeId?: string;
      scope?: ScheduledJobScope;
      status?: ScheduledJobStatus;
      limit?: number;
      offset?: number;
    },
  ): Promise<ScheduledJobListResponse>;
  getScheduledJob(this: ApiClient, id: string): Promise<ScheduledJob>;
  createScheduledJob(
    this: ApiClient,
    data: CreateScheduledJobRequest,
  ): Promise<ScheduledJob>;
  updateScheduledJob(
    this: ApiClient,
    id: string,
    data: UpdateScheduledJobRequest,
  ): Promise<ScheduledJob>;
  pauseScheduledJob(this: ApiClient, id: string): Promise<ScheduledJob>;
  resumeScheduledJob(this: ApiClient, id: string): Promise<ScheduledJob>;
  runScheduledJobNow(this: ApiClient, id: string): Promise<ScheduledJobRun>;
  deleteScheduledJob(this: ApiClient, id: string): Promise<void>;
  getScheduledJobRuns(
    this: ApiClient,
    id: string,
    params?: {
      limit?: number;
      offset?: number;
    },
  ): Promise<ScheduledJobRunsListResponse>;
  getLearningMemoryStatus(this: ApiClient): Promise<LearningSweepStatus>;
  runLearningMemorySweep(this: ApiClient): Promise<LearningSweepRunSummary>;
  getProjectMemorySegments(
    this: ApiClient,
    projectId: string,
    params?: ListProjectMemorySegmentsRequest,
  ): Promise<ProjectMemorySegmentListResponse>;
  getLearningCandidates(
    this: ApiClient,
    params?: ListLearningCandidatesRequest,
  ): Promise<LearningCandidateListResponse>;
  promoteLearningCandidate(
    this: ApiClient,
    data: PromoteLearningCandidateRequest,
  ): Promise<PromoteLearningCandidateResponse>;
  rejectLearningCandidate(
    this: ApiClient,
    candidateId: string,
    data: RejectLearningCandidateRequest,
  ): Promise<LearningCandidate>;
  archiveLearningCandidate(
    this: ApiClient,
    candidateId: string,
    data: ArchiveLearningCandidateRequest,
  ): Promise<LearningCandidate>;
  bulkRejectLearningCandidates(
    this: ApiClient,
    data: BulkRejectLearningCandidatesRequest,
  ): Promise<LearningCandidate[]>;
  bulkArchiveLearningCandidates(
    this: ApiClient,
    data: BulkArchiveLearningCandidatesRequest,
  ): Promise<LearningCandidate[]>;
  bulkPromoteLearningCandidates(
    this: ApiClient,
    data: BulkPromoteLearningCandidatesRequest,
  ): Promise<BulkPromoteLearningCandidatesResult[]>;
  getProjectOrchestrationState(
    this: ApiClient,
    projectId: string,
  ): Promise<ProjectOrchestrationState>;
  startProjectOrchestration(
    this: ApiClient,
    projectId: string,
    data: {
      goals?: string;
      workflowId?: string;
      orchestrationMode?: ProjectOrchestrationMode;
      sourceContext?: StartupRoutingSourceContext;
      readinessContext?: StartupRoutingReadinessContext;
      startupHints?: StartupRoutingHints;
    },
  ): Promise<ProjectOrchestration>;
  updateProjectOrchestrationMode(
    this: ApiClient,
    projectId: string,
    orchestrationMode: ProjectOrchestrationMode,
  ): Promise<ProjectOrchestration>;
  getPendingProjectOrchestrationActions(
    this: ApiClient,
    projectId: string,
  ): Promise<ProjectOrchestrationActionRequest[]>;
  getOrchestrationActionRequests(
    this: ApiClient,
    params?: {
      status?: "pending" | "fulfilled" | "all";
    },
  ): Promise<ProjectOrchestrationActionRequestListItem[]>;
  approveProjectOrchestrationAction(
    this: ApiClient,
    projectId: string,
    actionRequestId: string,
    approvedBy?: string,
  ): Promise<ProjectOrchestrationActionRequest>;
  rejectProjectOrchestrationAction(
    this: ApiClient,
    projectId: string,
    data: {
      actionRequestId: string;
      reason: string;
      rejectedBy?: string;
    },
  ): Promise<ProjectOrchestrationActionRequest>;
  getProjectOrchestrationDiagnostics(
    this: ApiClient,
    projectId: string,
  ): Promise<ProjectOrchestrationDiagnostics>;
  replayProjectRetrospective(
    this: ApiClient,
    projectId: string,
    data?: ReplayProjectRetrospectiveRequest,
  ): Promise<ReplayProjectRetrospectiveResponse>;
  openProjectWarRoomSession(
    this: ApiClient,
    projectId: string,
    data: OpenProjectWarRoomSessionRequest,
  ): Promise<OpenProjectWarRoomSessionResponse>;
  listProjectWarRoomSessions(
    this: ApiClient,
    projectId: string,
    params: {
      workflow_run_id: string;
      active_only?: boolean;
    },
  ): Promise<ListProjectWarRoomSessionsResponse>;
  getProjectWarRoomSessionState(
    this: ApiClient,
    projectId: string,
    sessionId: string,
    params: {
      workflow_run_id: string;
    },
  ): Promise<ProjectWarRoomStateResponse>;
  inviteProjectWarRoomParticipant(
    this: ApiClient,
    projectId: string,
    sessionId: string,
    data: InviteProjectWarRoomParticipantRequest,
  ): Promise<InviteProjectWarRoomParticipantResponse>;
  postProjectWarRoomMessage(
    this: ApiClient,
    projectId: string,
    sessionId: string,
    data: PostProjectWarRoomMessageRequest,
  ): Promise<PostProjectWarRoomMessageResponse>;
  updateProjectWarRoomBlackboard(
    this: ApiClient,
    projectId: string,
    sessionId: string,
    data: UpdateProjectWarRoomBlackboardRequest,
  ): Promise<UpdateProjectWarRoomBlackboardResponse>;
  submitProjectWarRoomSignoff(
    this: ApiClient,
    projectId: string,
    sessionId: string,
    data: SubmitProjectWarRoomSignoffRequest,
  ): Promise<SubmitProjectWarRoomSignoffResponse>;
  closeProjectWarRoomSession(
    this: ApiClient,
    projectId: string,
    sessionId: string,
    data: CloseProjectWarRoomSessionRequest,
  ): Promise<CloseProjectWarRoomSessionResponse>;
  getRuntimeCapabilities(
    this: ApiClient,
    params: {
      workflow_run_id: string;
      job_id?: string;
    },
  ): Promise<RuntimeCapabilitiesSnapshot>;
  approveProjectOrchestration(
    this: ApiClient,
    projectId: string,
  ): Promise<ProjectOrchestration>;
  rejectProjectOrchestration(
    this: ApiClient,
    projectId: string,
    feedback: string,
  ): Promise<ProjectOrchestration>;
  pauseProjectOrchestration(
    this: ApiClient,
    projectId: string,
  ): Promise<ProjectOrchestration>;
  resumeProjectOrchestration(
    this: ApiClient,
    projectId: string,
  ): Promise<ProjectOrchestration>;
  recoverImportedHydrationProjectOrchestration(
    this: ApiClient,
    projectId: string,
  ): Promise<ProjectOrchestration>;
  completeProjectOrchestration(
    this: ApiClient,
    projectId: string,
  ): Promise<ProjectOrchestration>;
  resetProjectOrchestrationIntents(
    this: ApiClient,
    projectId: string,
  ): Promise<{ success: boolean; data: { count: number } }>;
  getProjectRepositoryBranches(
    this: ApiClient,
    projectId: string,
  ): Promise<string[]>;
  getProjectRepositoryFiles(
    this: ApiClient,
    projectId: string,
  ): Promise<string[]>;
  getProjectRepositoryFileContent(
    this: ApiClient,
    projectId: string,
    branch: string | undefined,
    path: string,
  ): Promise<FileContent>;
  getProjectAgentsFile(
    this: ApiClient,
    projectId: string,
  ): Promise<ProjectAgentsDocument>;
  updateProjectAgentsFile(
    this: ApiClient,
    projectId: string,
    data: UpdateProjectAgentsFileRequest,
  ): Promise<ProjectAgentsDocument>;
  createProject(this: ApiClient, data: CreateProjectRequest): Promise<Project>;
  launchCharterOnboarding(
    this: ApiClient,
    projectId: string,
    mode: string,
  ): Promise<{ onboardingRunId: string }>;
  getCharter(this: ApiClient, projectId: string): Promise<CharterAggregate>;
  getCharterMemories(
    this: ApiClient,
    projectId: string,
  ): Promise<CharterMemoriesByCategory>;
  createCharterMemory(
    this: ApiClient,
    projectId: string,
    data: { category: string; content: string },
  ): Promise<CharterMemoryItem>;
  updateCharterMemory(
    this: ApiClient,
    projectId: string,
    memoryId: string,
    data: { content: string },
  ): Promise<CharterMemoryItem>;
  deleteCharterMemory(
    this: ApiClient,
    projectId: string,
    memoryId: string,
  ): Promise<void>;
  validateLocalPath(
    this: ApiClient,
    data: { path: string; sourceType: string },
  ): Promise<{
    valid: boolean;
    exists: boolean;
    isGitRepo: boolean;
    isEmpty: boolean;
    error?: string;
  }>;
  deleteProject(this: ApiClient, id: string): Promise<void>;
  getProjectGoals(
    this: ApiClient,
    projectId: string,
    options?: {
      includeArchived?: boolean;
    },
  ): Promise<ProjectGoal[]>;
  createProjectGoal(
    this: ApiClient,
    projectId: string,
    data: CreateProjectGoalRequest,
  ): Promise<ProjectGoal>;
  updateProjectGoal(
    this: ApiClient,
    projectId: string,
    goalId: string,
    data: UpdateProjectGoalRequest,
  ): Promise<ProjectGoal>;
  updateProjectGoalStatus(
    this: ApiClient,
    projectId: string,
    goalId: string,
    data: UpdateProjectGoalStatusRequest,
  ): Promise<ProjectGoal>;
  reorderProjectGoals(
    this: ApiClient,
    projectId: string,
    goalIds: string[],
  ): Promise<ProjectGoal[]>;
  archiveProjectGoal(
    this: ApiClient,
    projectId: string,
    goalId: string,
  ): Promise<ProjectGoal>;
  unarchiveProjectGoal(
    this: ApiClient,
    projectId: string,
    goalId: string,
  ): Promise<ProjectGoal>;
  getProjectGoalWorklogs(
    this: ApiClient,
    projectId: string,
    goalId: string,
  ): Promise<ProjectGoalWorklog[]>;
  createProjectGoalWorklog(
    this: ApiClient,
    projectId: string,
    goalId: string,
    data: CreateProjectGoalWorklogRequest,
  ): Promise<ProjectGoalWorklog>;
  linkProjectGoalWorkItem(
    this: ApiClient,
    projectId: string,
    goalId: string,
    data: {
      work_item_id: string;
      note?: string;
      author_id?: string;
      author_name?: string;
    },
  ): Promise<ProjectGoalWorklog>;
  updateProject(
    this: ApiClient,
    id: string,
    data: UpdateProjectRequest,
  ): Promise<Project>;
  getProjectWorkItems(
    this: ApiClient,
    projectId: string,
    query?: WorkItemListQuery,
  ): Promise<PaginatedWorkItems>;
  createWorkItem(
    this: ApiClient,
    projectId: string,
    data: CreateWorkItemRequest,
  ): Promise<WorkItem>;
  getAllWorkItems(
    this: ApiClient,
    query?: WorkItemListQuery,
  ): Promise<PaginatedWorkItems>;
  getWorkItemCostSummary(
    this: ApiClient,
    params?: { limit?: number; projectId?: string },
  ): Promise<WorkItemCostSummaryItem[]>;
  getWorkItemCostEstimate(
    this: ApiClient,
    projectId: string,
    workItemId: string,
  ): Promise<WorkItemCostEstimate>;
  deleteWorkItem(
    this: ApiClient,
    projectId: string,
    workItemId: string,
  ): Promise<void>;
  updateWorkItem(
    this: ApiClient,
    projectId: string,
    workItemId: string,
    data: UpdateWorkItemRequest,
  ): Promise<WorkItem>;
  submitWorkItemFeedbackResolution(
    this: ApiClient,
    projectId: string,
    workItemId: string,
    data: {
      response: string;
      resolvedBy?: string;
    },
  ): Promise<WorkItem>;
  updateProjectWorkItemStatus(
    this: ApiClient,
    projectId: string,
    workItemId: string,
    data: {
      status: WorkItem["status"];
      assignedAgentId?: string;
      currentExecutionId?: string;
      tokenSpend?: number;
      bypassReadinessGates?: boolean;
    },
  ): Promise<{ workItem: WorkItem; triggeredRunIds: string[] }>;
  restartWorkItemExecution(
    this: ApiClient,
    projectId: string,
    workItemId: string,
  ): Promise<{ workItem: WorkItem; triggeredRunIds: string[] }>;
  getWorkItemAutomationTriggers(
    this: ApiClient,
    projectId: string,
  ): Promise<WorkItem["status"][]>;
  getWorkItemRealtimeConfig(
    this: ApiClient,
    projectId: string,
  ): Promise<{ wsUrl: string; namespace: string }>;
  getWorkItemExecutionConfig(
    this: ApiClient,
    projectId: string,
    workItemId: string,
  ): Promise<WorkItem["executionConfig"]>;
  getWorkItemExecutions(
    this: ApiClient,
    projectId: string,
    workItemId: string,
  ): Promise<WorkflowRun[]>;
  mergeWorkItem(
    this: ApiClient,
    projectId: string,
    workItemId: string,
    data: MergeWorkItemRequest,
  ): Promise<MergeWorkItemResponse>;
  upsertWorkItemExecutionConfig(
    this: ApiClient,
    projectId: string,
    workItemId: string,
    data: {
      agentProfileId?: string;
      baseBranch: string;
      targetBranch: string;
      contextFiles: string[];
      documentationUrls?: string[];
      maxTokens?: number;
      maxLoops?: number;
    },
  ): Promise<WorkItem>;
  getSetupStatus(this: ApiClient): Promise<SetupStatus>;
  initializeSetup(
    this: ApiClient,
    data: InitializeSetupRequest,
  ): Promise<InitializeSetupResponse>;
  getKanbanSettings(this: ApiClient): Promise<KanbanSetting[]>;
  updateKanbanSetting(
    this: ApiClient,
    key: string,
    value: unknown,
    description?: string,
  ): Promise<KanbanSetting>;
  getSystemSettings(this: ApiClient): Promise<SystemSetting[]>;
  getTelegramSettings(this: ApiClient): Promise<TelegramSettings>;
  updateTelegramSettings(
    this: ApiClient,
    data: UpdateTelegramSettingsRequest,
  ): Promise<TelegramSettings>;
  updateSystemSetting(
    this: ApiClient,
    key: string,
    value: unknown,
    description?: string,
  ): Promise<SystemSetting>;
  getProjectRepositoryWorkflowSettings(
    this: ApiClient,
    projectId: string,
  ): Promise<{
    enabled: boolean;
    overrides: Record<string, { enabled: boolean }>;
  }>;
  updateProjectRepositoryWorkflowSettings(
    this: ApiClient,
    projectId: string,
    data: {
      enabled?: boolean;
      overrides?: Record<string, { enabled: boolean }>;
    },
  ): Promise<{
    enabled: boolean;
    overrides: Record<string, { enabled: boolean }>;
  }>;
}

export type { ApiClientProjectMethods };
