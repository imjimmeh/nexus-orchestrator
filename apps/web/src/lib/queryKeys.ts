import { DoctorRepairHistoryStatus } from "@/lib/api/doctor.types";
import { ListWorkflowsParams } from "@/lib/api/workflow-launch.types";
import { WorkflowLifecycleResultsQuery } from "@/lib/api/workflow-lifecycle.types";
import { WorkflowRunsQuery } from "@/lib/api/workflows.types";

export const queryKeys = {
  budget: {
    policies: {
      all: (params?: Record<string, unknown>) =>
        ["budget-policies", params ?? {}] as const,
      detail: (id: string) => ["budget-policies", id] as const,
    },
    summary: (params?: Record<string, unknown>) =>
      ["budget-summary", params ?? {}] as const,
    timeline: (params?: Record<string, unknown>) =>
      ["budget-timeline", params ?? {}] as const,
    usageEvents: (params?: Record<string, unknown>) =>
      ["budget-usage-events", params ?? {}] as const,
    workItemCostSummary: (params?: Record<string, unknown>) =>
      ["budget-work-item-cost-summary", params ?? {}] as const,
    workItemCostEstimate: (projectId: string, workItemId: string) =>
      ["work-item-cost-estimate", projectId, workItemId] as const,
  },
  adminResources: {
    providers: {
      all: (params?: Record<string, unknown>) =>
        ["providers", params ?? {}] as const,
      detail: (id: string) => ["providers", id] as const,
      oauthStatus: (id: string) => ["providers", id, "oauth-status"] as const,
    },
    models: {
      all: (params?: Record<string, unknown>) =>
        ["models", params ?? {}] as const,
      detail: (id: string) => ["models", id] as const,
    },
    secrets: {
      all: (params?: Record<string, unknown>) =>
        ["secrets", params ?? {}] as const,
      detail: (id: string) => ["secrets", id] as const,
    },
    agentProfiles: {
      all: (params?: Record<string, unknown>) =>
        ["agentProfiles", params ?? {}] as const,
      detail: (id: string) => ["agentProfiles", id] as const,
    },
    tools: {
      all: (params?: object) => ["tools", params ?? {}] as const,
      detail: (id: string) => ["tools", id] as const,
      paged: (params?: Record<string, unknown>) =>
        ["tools", "paged", params ?? {}] as const,
      candidates: (params?: object) =>
        ["tool-candidates", params ?? {}] as const,
      candidateValidationRuns: (id: string) =>
        ["tool-candidate-validation-runs", id] as const,
    },
  },
  projects: {
    branches: (projectId: string) => ["project-branches", projectId] as const,
    gitActivity: (projectId: string, limit: number) =>
      ["project-git-activity", projectId, limit] as const,
    files: (projectId: string, branch: string) =>
      ["project-files", projectId, branch] as const,
    fileContent: (projectId: string, branch: string, path: string) =>
      ["project-file-content", projectId, branch, path] as const,
    agentsFile: (projectId: string) =>
      ["project-agents-file", projectId] as const,
    repositoryWorkflowSettings: (projectId: string) =>
      ["project-repository-workflow-settings", projectId] as const,
  },
  projectOrchestration: {
    diagnostics: (projectId: string) =>
      ["project-orchestration-diagnostics", projectId] as const,
    capabilities: (projectId: string, workflowRunId: string) =>
      ["project-orchestration-capabilities", projectId, workflowRunId] as const,
    warRoomSessions: (
      projectId: string,
      workflowRunId: string,
      activeOnly: boolean,
    ) =>
      [
        "project-orchestration-war-room-sessions",
        projectId,
        workflowRunId,
        activeOnly,
      ] as const,
    warRoomStatePrefix: (projectId: string, workflowRunId: string) =>
      [
        "project-orchestration-war-room-state",
        projectId,
        workflowRunId,
      ] as const,
    warRoomState: (
      projectId: string,
      workflowRunId: string,
      sessionId: string,
    ) =>
      [
        "project-orchestration-war-room-state",
        projectId,
        workflowRunId,
        sessionId,
      ] as const,
  },
  projectWorkItems: {
    all: (projectId: string) => ["project-work-items", projectId] as const,
    list: (projectId: string, scope?: string) =>
      scope === undefined
        ? (["project-work-items", projectId] as const)
        : (["project-work-items", projectId, scope] as const),
  },
  workflows: {
    all: (params?: ListWorkflowsParams) =>
      params ? (["workflows", params] as const) : (["workflows"] as const),
    detail: (id: string) => ["workflows", id] as const,
    launchOptions: (query: { projectId?: string; workItemId?: string } = {}) =>
      ["workflows", "launch-options", query] as const,
    launchContract: (
      workflowId: string,
      query: { projectId?: string; workItemId?: string } = {},
    ) => ["workflows", workflowId, "launch-contract", query] as const,
  },
  workflowRuns: {
    list: (query: WorkflowRunsQuery = {}) => ["workflow-runs", query] as const,
    detail: (runId: string) => ["workflow-run", runId] as const,
    graph: (runId: string) => ["workflow-run-graph", runId] as const,
    executions: (runId: string) => ["workflow-run-executions", runId] as const,
    events: (runId: string) => ["workflow-run-events", runId] as const,
    autonomyDiagnostics: (runId: string) =>
      ["workflow-run-autonomy-diagnostics", runId] as const,
    retrospectiveTrace: (runId: string) =>
      ["workflow-run-retrospective-trace", runId] as const,
    subagentExecutions: (runId: string) =>
      ["workflow-run-subagent-executions", runId] as const,
    todoList: (runId: string) => ["workflow-run-todo-list", runId] as const,
    lifecycleResults: (query: WorkflowLifecycleResultsQuery) =>
      ["workflow-lifecycle-results", query] as const,
    telemetryAuth: (runId: string) =>
      ["workflow-run-telemetry-auth", runId] as const,
  },
  workflowEvents: {
    list: (query: { projectId?: string; limit: number; offset: number }) =>
      ["workflow-events", query] as const,
  },
  workflowGraphs: {
    workflow: (workflowId: string) => ["workflow-graph", workflowId] as const,
  },
  adHocSessions: {
    list: (params?: { projectId?: string; status?: string }) =>
      ["ad-hoc-sessions", params] as const,
  },
  chatSessions: {
    list: (params?: {
      projectId?: string;
      status?: string;
      search?: string;
      limit?: number;
      offset?: number;
    }) => ["chat-sessions", params] as const,
    detail: (id: string) => ["chat-session", id] as const,
    participants: (id: string) => ["chat-session-participants", id] as const,
    state: (id: string) => ["chat-session-state", id] as const,
    telemetryAuth: (id: string) => ["chat-session-telemetry-auth", id] as const,
    events: (id: string) => ["chat-session-events", id] as const,
    children: (parentId: string) =>
      ["chat-session-children", parentId] as const,
  },
  resolvedConfig: {
    agentProfile: (name: string, scopeNodeId?: string) =>
      ["resolved-config", "agent-profile", name, scopeNodeId] as const,
    workflow: (name: string, scopeNodeId?: string) =>
      ["resolved-config", "workflow", name, scopeNodeId] as const,
  },
  operations: {
    doctorReport: () => ["operations", "doctor-report"] as const,
    lifecycleResumeSummary: () =>
      ["operations", "lifecycle-resume-summary"] as const,
    doctorHistoryPrefix: () => ["operations", "doctor-history"] as const,
    doctorHistory: (query: {
      limit: number;
      offset: number;
      action_id?: string;
      status?: DoctorRepairHistoryStatus;
    }) => ["operations", "doctor-history", query] as const,
  },
  gitops: {
    status: () => ["gitops-status"] as const,
    bindings: (scopeNodeId?: string) =>
      ["gitops-bindings", scopeNodeId ?? "all"] as const,
    bindingsRoot: () => ["gitops-bindings"] as const,
  },
  scope: {
    tree: () => ["scope", "tree"] as const,
    node: (id: string) => ["scope", "node", id] as const,
    members: (scopeNodeId: string) =>
      ["scope", "members", scopeNodeId] as const,
    roles: () => ["scope", "roles"] as const,
    allowedChildTypes: (id: string) =>
      ["scope", "allowed-child-types", id] as const,
  },
  users: {
    search: (query: string) => ["users", "search", query] as const,
  },
  invitations: {
    atNode: (scopeNodeId: string) => ["invitations", scopeNodeId] as const,
  },
  authz: {
    enforcementModes: () => ["authz", "enforcement-modes"] as const,
    myPermissions: (scopeNodeId?: string) =>
      ["authz", "my-permissions", scopeNodeId ?? "global"] as const,
  },
  audit: {
    log: (filters?: Record<string, unknown>) =>
      ["audit", "log", filters ?? {}] as const,
  },
  harnesses: {
    all: () => ["harnesses"] as const,
    detail: (id: string) => ["harnesses", id] as const,
  },
  harnessCredentials: {
    requirements: (harnessId: string, scopeNodeId?: string) =>
      ["harness-credentials", harnessId, scopeNodeId ?? "platform"] as const,
    oauthSession: (harnessId: string, key: string, sessionId: string) =>
      [
        "harness-credentials",
        harnessId,
        key,
        "oauth-session",
        sessionId,
      ] as const,
  },
  scopedAiDefaults: {
    detail: (scopeNodeId?: string) =>
      ["scoped-ai-defaults", scopeNodeId ?? "platform"] as const,
  },
  variables: {
    list: (scopeId: string | null) => ["variables", "list", scopeId] as const,
    effective: (scopeId: string | null) =>
      ["variables", "effective", scopeId] as const,
  },
  orchestrationPolicy: {
    detail: (projectId: string) => ["orchestration-policy", projectId] as const,
  },
  memory: {
    explorerUsers: () => ["memory", "explorer-users"] as const,
    metrics: () => ["memory", "metrics"] as const,
    userMemory: (userId: string, params?: Record<string, unknown>) =>
      ["memory", "user", userId, params ?? {}] as const,
    systemMemory: (params?: Record<string, unknown>) =>
      ["memory", "system", params ?? {}] as const,
    chatMemory: (params?: Record<string, unknown>) =>
      ["memory", "chat", params ?? {}] as const,
    chatMemoryObservability: () => ["memory", "chat-observability"] as const,
    projectMemory: (projectId: string, params?: Record<string, unknown>) =>
      ["memory", "project", projectId, params ?? {}] as const,
  },
  charter: {
    detail: (projectId: string) => ["charter", "detail", projectId] as const,
    memories: (projectId: string) =>
      ["charter", "memories", projectId] as const,
  },
  goals: {
    list: (projectId: string, includeArchived?: boolean) =>
      [
        "goals",
        "list",
        projectId,
        { includeArchived: includeArchived ?? false },
      ] as const,
    worklogs: (projectId: string, goalId: string) =>
      ["goals", "worklogs", projectId, goalId] as const,
  },
  learning: {
    status: () => ["learning", "status"] as const,
    candidates: (params?: Record<string, unknown>) =>
      ["learning", "candidates", params ?? {}] as const,
  },
  settings: {
    system: () => ["system-settings"] as const,
    kanban: () => ["kanban-settings"] as const,
    telegram: () => ["telegram-settings"] as const,
    toolApprovalRules: (
      filters: { scopeFilter?: unknown; effectFilter?: unknown } = {},
    ) => {
      const { scopeFilter, effectFilter } = filters;
      if (scopeFilter === undefined && effectFilter === undefined) {
        return ["tool-approval-rules"] as const;
      }
      if (effectFilter === undefined) {
        return ["tool-approval-rules", scopeFilter] as const;
      }
      if (scopeFilter === undefined) {
        return ["tool-approval-rules", effectFilter] as const;
      }
      return ["tool-approval-rules", scopeFilter, effectFilter] as const;
    },
  },
  automation: {
    hooks: (projectId: string) => ["automation-hooks", projectId] as const,
    heartbeatProfiles: (projectId: string) =>
      ["heartbeat-profiles", projectId] as const,
    heartbeatRuns: (profileId: string, limit: number) =>
      ["heartbeat-runs", profileId, limit] as const,
    heartbeatRunsRoot: (profileId: string) =>
      ["heartbeat-runs", profileId] as const,
    standingOrders: (projectId: string) =>
      ["standing-orders", projectId] as const,
  },
  scheduled: {
    jobs: (params?: {
      projectId?: string;
      scope?: string;
      status?: string;
    }) => {
      if (params === undefined) {
        return ["scheduled-jobs"] as const;
      }
      return [
        "scheduled-jobs",
        ...(params.projectId !== undefined ? [params.projectId] : []),
        ...(params.scope !== undefined ? [params.scope] : []),
        ...(params.status !== undefined ? [params.status] : []),
      ] as const;
    },
    jobRuns: (jobId: string, limit?: number) =>
      limit === undefined
        ? (["scheduled-job-runs", jobId] as const)
        : (["scheduled-job-runs", jobId, limit] as const),
  },
  mcp: {
    servers: () => ["mcp-servers"] as const,
  },
  agentSkills: {
    all: (includeInactive?: boolean) =>
      ["agentSkills", includeInactive ?? false] as const,
    files: (skillId: string) => ["agentSkillFiles", skillId] as const,
    profileSkills: (profileId: string) =>
      ["agentProfileSkills", profileId] as const,
    profileSkillsRoot: () => ["agentProfileSkills"] as const,
  },
  improvementProposals: {
    root: () => ["improvementProposals"] as const,
    all: (params?: object) => ["improvementProposals", params ?? {}] as const,
  },
  selfImprovement: {
    promotedLessons: (params?: object) =>
      ["selfImprovementPromotedLessons", params ?? {}] as const,
  },
  acp: {
    servers: () => ["acp-servers"] as const,
    discoveredAgents: (serverId: string) =>
      ["acp-servers", serverId, "agents"] as const,
  },
  fallbackChains: {
    global: () => ["fallback-chains", "global"] as const,
  },
  providerCooldownStatus: () => ["provider-cooldown-status"] as const,
};
