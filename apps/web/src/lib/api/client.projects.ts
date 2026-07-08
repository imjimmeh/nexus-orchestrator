import type {
  FileContent,
  PaginatedWorkItems,
} from "./common.types";
import type {
  Project,
  ProjectAgentsDocument,
  ProjectOrchestration,
  ProjectOrchestrationActionRequest,
  ProjectOrchestrationActionRequestListItem,
  ProjectOrchestrationState,
} from "./projects.types";
import type {
  ProjectGoal,
  ProjectGoalWorklog,
} from "./goals.types";
import type {
  ProjectOrchestrationDiagnostics,
  ReplayProjectRetrospectiveRequest,
  ReplayProjectRetrospectiveResponse,
  RuntimeCapabilitiesSnapshot,
} from "./orchestration.types";
import type {
  MergeWorkItemResponse,
  WorkItem,
  WorkItemCostSummaryItem,
} from "./work-items.types";
import type { WorkflowRun } from "./workflows.types";
import type {
  ApiClientProjectMethods,
  CharterAggregate,
  CharterMemoryItem,
  CharterMemoriesByCategory,
  WorkItemCostEstimate,
  WorkItemListQuery,
} from "./client.projects.types";
import { projectScheduledApiMethods } from "./client.projects.schedules";
import { projectAutomationApiMethods } from "./client.projects.automation";
import { projectLearningApiMethods } from "./client.projects.learning";
import { projectMemoryApiMethods } from "./client.projects.memory";
import { projectSettingsApiMethods } from "./client.projects.settings";
import { projectWarRoomApiMethods } from "./client.projects.war-room";
export type { ApiClientProjectMethods } from "./client.projects.types";
export type {
  CharterAggregate,
  CharterMemoryItem,
  CharterMemoriesByCategory,
} from "./client.projects.types";

type ProjectWithOptionalCamelTimestamps = Project & {
  createdAt?: string | Date;
  updatedAt?: string | Date;
};

function buildWorkItemQuery(query?: WorkItemListQuery): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === "" || value === null) continue;
    params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function toTimestampString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return "";
}

function normalizeProjectTimestamps(
  project: ProjectWithOptionalCamelTimestamps,
): Project {
  const createdAt =
    project.created_at ?? toTimestampString(project.createdAt) ?? "";
  const updatedAt =
    project.updated_at ?? toTimestampString(project.updatedAt) ?? "";

  return {
    ...project,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

export const projectApiMethods: ApiClientProjectMethods = {
  async getProjects() {
    const projects =
      await this.get<ProjectWithOptionalCamelTimestamps[]>("/projects");
    return projects.map((project) => normalizeProjectTimestamps(project));
  },

  async getProject(id) {
    const project = await this.get<ProjectWithOptionalCamelTimestamps>(
      `/projects/${id}`,
    );
    return normalizeProjectTimestamps(project);
  },

  ...projectScheduledApiMethods,
  ...projectAutomationApiMethods,
  ...projectLearningApiMethods,
  ...projectMemoryApiMethods,
  ...projectSettingsApiMethods,
  ...projectWarRoomApiMethods,

  async getProjectOrchestrationState(projectId) {
    return this.get<ProjectOrchestrationState>(
      `/projects/${projectId}/orchestration`,
    );
  },

  async startProjectOrchestration(projectId, data) {
    const payload: Record<string, unknown> = {};

    if (data.workflowId !== undefined) {
      payload.workflow_id = data.workflowId;
    }

    if (data.goals !== undefined) {
      payload.goals = data.goals;
    }

    if (data.orchestrationMode !== undefined) {
      payload.orchestration_mode = data.orchestrationMode;
    }

    if (data.sourceContext !== undefined) {
      payload.source_context = data.sourceContext;
    }

    if (data.readinessContext !== undefined) {
      payload.readiness_context = data.readinessContext;
    }

    if (data.startupHints !== undefined) {
      payload.startup_hints = data.startupHints;
    }

    return this.post<ProjectOrchestration>(
      `/projects/${projectId}/orchestration/start`,
      payload,
    );
  },

  async updateProjectOrchestrationMode(projectId, orchestrationMode) {
    return this.patch<ProjectOrchestration>(
      `/projects/${projectId}/orchestration`,
      { orchestration_mode: orchestrationMode },
    );
  },

  async getPendingProjectOrchestrationActions(projectId) {
    return this.get<ProjectOrchestrationActionRequest[]>(
      `/projects/${projectId}/orchestration/pending-actions`,
    );
  },

  async getOrchestrationActionRequests(params) {
    const query = params?.status ? `?status=${params.status}` : "";
    return this.get<ProjectOrchestrationActionRequestListItem[]>(
      `/orchestration/action-requests${query}`,
    );
  },

  async approveProjectOrchestrationAction(
    projectId,
    actionRequestId,
    approvedBy,
  ) {
    return this.post<ProjectOrchestrationActionRequest>(
      `/projects/${projectId}/orchestration/action-requests/${actionRequestId}/approve`,
      { approved_by: approvedBy },
    );
  },

  async rejectProjectOrchestrationAction(projectId, data) {
    return this.post<ProjectOrchestrationActionRequest>(
      `/projects/${projectId}/orchestration/action-requests/${data.actionRequestId}/reject`,
      {
        reason: data.reason,
        rejected_by: data.rejectedBy,
      },
    );
  },

  async getProjectOrchestrationDiagnostics(projectId) {
    return this.get<ProjectOrchestrationDiagnostics>(
      `/projects/${projectId}/orchestration/diagnostics`,
    );
  },

  async replayProjectRetrospective(
    projectId,
    data?: ReplayProjectRetrospectiveRequest,
  ) {
    return this.post<ReplayProjectRetrospectiveResponse>(
      `/projects/${projectId}/orchestration/retrospective/replay`,
      data ?? {},
    );
  },

  async getRuntimeCapabilities(params) {
    return this.post<RuntimeCapabilitiesSnapshot>(
      "/workflow-runtime/get-capabilities",
      {
        workflow_run_id: params.workflow_run_id,
        job_id: params.job_id,
      },
    );
  },

  async approveProjectOrchestration(projectId) {
    return this.post<ProjectOrchestration>(
      `/projects/${projectId}/orchestration/approve`,
      {},
    );
  },

  async rejectProjectOrchestration(projectId, feedback) {
    return this.post<ProjectOrchestration>(
      `/projects/${projectId}/orchestration/reject`,
      { feedback },
    );
  },

  async pauseProjectOrchestration(projectId) {
    return this.post<ProjectOrchestration>(
      `/projects/${projectId}/orchestration/pause`,
      {},
    );
  },

  async resumeProjectOrchestration(projectId) {
    return this.post<ProjectOrchestration>(
      `/projects/${projectId}/orchestration/resume`,
      {},
    );
  },

  async recoverImportedHydrationProjectOrchestration(projectId) {
    return this.post<ProjectOrchestration>(
      `/projects/${projectId}/orchestration/recovery/imported-hydration`,
      {},
    );
  },

  async completeProjectOrchestration(projectId) {
    return this.post<ProjectOrchestration>(
      `/projects/${projectId}/orchestration/complete`,
      {},
    );
  },

  async resetProjectOrchestrationIntents(projectId) {
    return this.post<{ success: boolean; data: { count: number } }>(
      `/projects/${projectId}/orchestration/reset-intents`,
      {},
    );
  },

  async getProjectRepositoryBranches(projectId) {
    return this.get<string[]>(`/projects/${projectId}/repository/branches`);
  },

  async getProjectRepositoryFiles(projectId) {
    return this.get<string[]>(`/projects/${projectId}/repository/files`);
  },

  async getProjectRepositoryFileContent(projectId, branch, path) {
    const params = new URLSearchParams();
    params.append("path", path);
    if (branch) {
      params.append("branch", branch);
    }
    return this.get<FileContent>(
      `/projects/${projectId}/repository/files/content?${params.toString()}`,
    );
  },

  async getProjectAgentsFile(projectId) {
    return this.get<ProjectAgentsDocument>(
      `/projects/${projectId}/repository/agents-file`,
    );
  },

  async updateProjectAgentsFile(projectId, data) {
    return this.put<ProjectAgentsDocument>(
      `/projects/${projectId}/repository/agents-file`,
      {
        content: data.content,
        expected_etag: data.expectedEtag,
      },
    );
  },

  async createProject(data) {
    const project = await this.post<ProjectWithOptionalCamelTimestamps>(
      "/projects",
      data,
    );
    return normalizeProjectTimestamps(project);
  },

  async launchCharterOnboarding(projectId, mode) {
    return this.post<{ onboardingRunId: string }>(
      `/projects/${projectId}/charter/launch`,
      { mode },
    );
  },

  async getCharter(projectId: string): Promise<CharterAggregate> {
    const res = await this.get<{ success: boolean; data: CharterAggregate }>(
      `/projects/${projectId}/charter`,
    );
    return res.data;
  },

  async getCharterMemories(
    projectId: string,
  ): Promise<CharterMemoriesByCategory> {
    return this.get<CharterMemoriesByCategory>(
      `/projects/${projectId}/charter-memories`,
    );
  },

  async createCharterMemory(
    projectId: string,
    data: { category: string; content: string },
  ): Promise<CharterMemoryItem> {
    return this.post<CharterMemoryItem>(
      `/projects/${projectId}/charter-memories`,
      data,
    );
  },

  async updateCharterMemory(
    projectId: string,
    memoryId: string,
    data: { content: string },
  ): Promise<CharterMemoryItem> {
    return this.patch<CharterMemoryItem>(
      `/projects/${projectId}/charter-memories/${memoryId}`,
      data,
    );
  },

  async deleteCharterMemory(
    projectId: string,
    memoryId: string,
  ): Promise<void> {
    return this.delete(`/projects/${projectId}/charter-memories/${memoryId}`);
  },

  async validateLocalPath(data: { path: string; sourceType: string }) {
    return this.post<{
      valid: boolean;
      exists: boolean;
      isGitRepo: boolean;
      isEmpty: boolean;
      error?: string;
    }>("/projects/validate-local-path", data);
  },

  async deleteProject(id) {
    return this.delete(`/projects/${id}`);
  },

  async getProjectGoals(projectId, options) {
    const includeArchived = options?.includeArchived;
    let query = "";
    if (includeArchived !== undefined) {
      query = includeArchived
        ? "?include_archived=true"
        : "?include_archived=false";
    }

    return this.get<ProjectGoal[]>(`/projects/${projectId}/goals${query}`);
  },

  async createProjectGoal(projectId, data) {
    return this.post<ProjectGoal>(`/projects/${projectId}/goals`, data);
  },

  async updateProjectGoal(projectId, goalId, data) {
    return this.patch<ProjectGoal>(
      `/projects/${projectId}/goals/${goalId}`,
      data,
    );
  },

  async updateProjectGoalStatus(projectId, goalId, data) {
    return this.patch<ProjectGoal>(
      `/projects/${projectId}/goals/${goalId}/status`,
      data,
    );
  },

  async reorderProjectGoals(projectId, goalIds) {
    return this.patch<ProjectGoal[]>(`/projects/${projectId}/goals/reorder`, {
      goal_ids: goalIds,
    });
  },

  async archiveProjectGoal(projectId, goalId) {
    return this.post<ProjectGoal>(
      `/projects/${projectId}/goals/${goalId}/archive`,
    );
  },

  async unarchiveProjectGoal(projectId, goalId) {
    return this.post<ProjectGoal>(
      `/projects/${projectId}/goals/${goalId}/unarchive`,
    );
  },

  async getProjectGoalWorklogs(projectId, goalId) {
    return this.get<ProjectGoalWorklog[]>(
      `/projects/${projectId}/goals/${goalId}/worklogs`,
    );
  },

  async createProjectGoalWorklog(projectId, goalId, data) {
    return this.post<ProjectGoalWorklog>(
      `/projects/${projectId}/goals/${goalId}/worklogs`,
      data,
    );
  },

  async linkProjectGoalWorkItem(projectId, goalId, data) {
    return this.post<ProjectGoalWorklog>(
      `/projects/${projectId}/goals/${goalId}/worklogs/link-work-item`,
      data,
    );
  },

  async updateProject(id, data) {
    const project = await this.patch<ProjectWithOptionalCamelTimestamps>(
      `/projects/${id}`,
      data,
    );
    return normalizeProjectTimestamps(project);
  },

  async getProjectWorkItems(projectId, query) {
    return this.get<PaginatedWorkItems>(
      `/projects/${projectId}/work-items${buildWorkItemQuery(query)}`,
    );
  },

  async createWorkItem(projectId, data) {
    return this.post<WorkItem>(`/projects/${projectId}/work-items`, data);
  },

  async getAllWorkItems(query) {
    return this.get<PaginatedWorkItems>(
      `/work-items${buildWorkItemQuery(query)}`,
    );
  },

  async getWorkItemCostSummary(params) {
    const qs = new URLSearchParams();
    if (params?.limit !== null && params?.limit !== undefined)
      qs.set("limit", String(params.limit));
    if (params?.projectId) qs.set("projectId", params.projectId);
    const query = qs.toString();
    return this.get<WorkItemCostSummaryItem[]>(
      `/work-items/cost-summary${query ? `?${query}` : ""}`,
    );
  },

  async getWorkItemCostEstimate(projectId, workItemId) {
    return this.get<WorkItemCostEstimate>(
      `/work-items/${projectId}/${workItemId}/cost-estimate`,
    );
  },

  async deleteWorkItem(projectId, workItemId) {
    return this.delete(`/projects/${projectId}/work-items/${workItemId}`);
  },

  async updateWorkItem(projectId, workItemId, data) {
    return this.patch<WorkItem>(
      `/projects/${projectId}/work-items/${workItemId}`,
      data,
    );
  },

  async submitWorkItemFeedbackResolution(projectId, workItemId, data) {
    return this.post<WorkItem>(
      `/projects/${projectId}/work-items/${workItemId}/feedback-resolution`,
      {
        response: data.response,
        resolved_by: data.resolvedBy,
      },
    );
  },

  async updateProjectWorkItemStatus(projectId, workItemId, data) {
    return this.patch<{ workItem: WorkItem; triggeredRunIds: string[] }>(
      `/projects/${projectId}/work-items/${workItemId}/status`,
      data,
    );
  },

  async restartWorkItemExecution(projectId, workItemId) {
    return this.post<{ workItem: WorkItem; triggeredRunIds: string[] }>(
      `/projects/${projectId}/work-items/${workItemId}/restart`,
      {},
    );
  },

  async getWorkItemAutomationTriggers(projectId) {
    return this.get<WorkItem["status"][]>(
      `/projects/${projectId}/work-items/automation-triggers`,
    );
  },

  async getWorkItemRealtimeConfig(projectId) {
    return this.get<{ wsUrl: string; namespace: string }>(
      `/projects/${projectId}/work-items/realtime-config`,
    );
  },

  async getWorkItemExecutionConfig(projectId, workItemId) {
    return this.get<WorkItem["executionConfig"]>(
      `/projects/${projectId}/work-items/${workItemId}/execution-config`,
    );
  },

  async getWorkItemExecutions(projectId, workItemId) {
    return this.get<WorkflowRun[]>(
      `/projects/${projectId}/work-items/${workItemId}/executions`,
    );
  },

  async mergeWorkItem(projectId, workItemId, data) {
    return this.post<MergeWorkItemResponse>(
      `/projects/${projectId}/work-items/${workItemId}/merge`,
      data,
    );
  },

  async upsertWorkItemExecutionConfig(projectId, workItemId, data) {
    return this.patch<WorkItem>(
      `/projects/${projectId}/work-items/${workItemId}/execution-config`,
      data,
    );
  },
};
