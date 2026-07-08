import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { ReplayProjectRetrospectiveRequest } from "@/lib/api/orchestration.types";
import { ProjectOrchestration, ProjectOrchestrationMode } from "@/lib/api/projects.types";
import { QuestionAnswer } from "@/lib/api/settings.types";
import { WorkItem } from "@/lib/api/work-items.types";
import { WorkflowRun, WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import { queryKeys } from "@/lib/queryKeys";
import {
  useApproveProjectOrchestrationAction,
  useApproveProjectOrchestration,
  useCompleteProjectOrchestration,
  usePauseProjectOrchestration,
  useProjectOrchestrationState,
  useRecoverImportedHydrationProjectOrchestration,
  useRejectProjectOrchestrationAction,
  useRejectProjectOrchestration,
  useResetProjectOrchestrationIntents,
  useResumeProjectOrchestration,
  useStartProjectOrchestration,
  useUpdateProjectOrchestrationMode,
} from "@/hooks/useProjectOrchestration";
import { useProjectGoals } from "@/hooks/useProjectGoals";
import { useProjectWorkItems } from "@/hooks/useProjectWorkItems";
import { getPendingQuestions } from "@/pages/active-session/active-session.utils";
import { resolveFallbackRun } from "./OrchestrationTab.helpers";
import type {
  FallbackRunResolution,
  NoticeState,
} from "./OrchestrationTab.types";
import { buildOrchestrationNotifications } from "./OrchestrationTab.notifications";

function resolveActiveSessionHref(params: {
  projectId: string;
  runId: string | null;
  workItemId: string | null;
}): string | null {
  const { projectId, runId, workItemId } = params;

  if (workItemId) {
    return `/projects/${projectId}/work-items/${workItemId}/active-session`;
  }

  if (!runId) {
    return null;
  }

  return `/projects/${projectId}/runs/${runId}/active-session`;
}

function createSubmitAnswersMutation(params: {
  currentRunId: string | null;
  setNotice: (notice: NoticeState | null) => void;
  invalidateRunEvents: (runId: string) => Promise<unknown>;
}) {
  const { currentRunId, setNotice, invalidateRunEvents } = params;

  return {
    mutationFn: (answers: QuestionAnswer[]) => {
      if (!currentRunId) {
        throw new Error("workflow run id is required");
      }

      return api.submitQuestionAnswers(currentRunId, answers);
    },
    onSuccess: async () => {
      setNotice({
        type: "info",
        title: "Answers Submitted",
        message: "Your answers were submitted to the active orchestration run.",
      });

      if (!currentRunId) {
        return;
      }

      await invalidateRunEvents(currentRunId);
    },
    onError: (error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Unexpected error";
      setNotice({
        type: "error",
        title: "Submit Failed",
        message,
      });
    },
  };
}

function resolveNotifications(params: {
  orchestration: ProjectOrchestration | null;
  workItems: WorkItem[];
  workflowRun: WorkflowRun | null | undefined;
  workflowRunEvents: WorkflowTelemetryEvent[];
}) {
  const { orchestration, workItems, workflowRun, workflowRunEvents } = params;
  if (!orchestration) {
    return [];
  }

  return buildOrchestrationNotifications({
    status: orchestration.status,
    revisionFeedback: orchestration.revisionFeedback,
    decisionLog: orchestration.decisionLog ?? [],
    workItems,
    workflowRun,
    workflowEvents: workflowRunEvents,
  });
}

function resolveOrchestrationData(
  data: ReturnType<typeof useProjectOrchestrationState>["data"],
) {
  return {
    orchestration: data?.orchestration ?? null,
    projectState: data?.projectState,
    pendingActionRequests: data?.pendingActionRequests ?? [],
  };
}

function buildGoalsSummary(
  goals: Array<{ title: string; status: string }>,
): string {
  if (goals.length === 0) {
    return "";
  }

  return goals
    .map((goal, index) => `${index + 1}. [${goal.status}] ${goal.title}`)
    .join("\n");
}

function resolveRunIds(params: {
  orchestrationRunId: string | null;
  fallbackRunId: string | undefined;
}) {
  const { orchestrationRunId, fallbackRunId } = params;
  const currentRunId = orchestrationRunId ?? fallbackRunId ?? null;
  return {
    currentRunId,
    runQueryId: currentRunId ?? "",
  };
}

function resolveRunInferenceFlag(params: {
  orchestrationRunId: string | null;
  matchType: FallbackRunResolution["matchType"];
}): boolean {
  return (
    params.orchestrationRunId === null && params.matchType === "project-only"
  );
}

function resolveFallbackRunPolling(params: {
  hasOrchestration: boolean;
  hasOrchestrationRunId: boolean;
}): false | number {
  if (!params.hasOrchestration || params.hasOrchestrationRunId) {
    return false;
  }

  return 10_000;
}

function resolveRunPollingInterval(runId: string | null): false | number {
  return runId ? 5_000 : false;
}

function requireRunId(runId: string | null): string {
  if (!runId) {
    throw new Error("workflow run id is required");
  }

  return runId;
}

function resolveCapabilitiesPollingInterval(
  runId: string | null,
): false | number {
  return runId ? 10_000 : false;
}

function findActiveSessionWorkItem(params: {
  currentRunId: string | null;
  workItems: WorkItem[];
}) {
  const { currentRunId, workItems } = params;
  if (!currentRunId) {
    return null;
  }

  return (
    workItems.find((item) => item.currentExecutionId === currentRunId) ?? null
  );
}

function useOrchestrationRunContext(params: {
  projectId: string;
  orchestration: ProjectOrchestration | null;
  orchestrationRunId: string | null;
  workItems: WorkItem[];
}) {
  const { data: candidateRunsResponse } = useQuery({
    queryKey: queryKeys.workflowRuns.list({ projectId: params.projectId }),
    queryFn: () => api.getWorkflowRuns({ projectId: params.projectId }),
    enabled: Boolean(params.orchestration) && !params.orchestrationRunId,
    refetchInterval: resolveFallbackRunPolling({
      hasOrchestration: Boolean(params.orchestration),
      hasOrchestrationRunId: Boolean(params.orchestrationRunId),
    }),
  });
  const candidateRuns = candidateRunsResponse?.data ?? [];

  const fallbackRunResolution = useMemo<FallbackRunResolution>(
    () =>
      resolveFallbackRun({
        candidateRuns,
        projectId: params.projectId,
        orchestrationId: params.orchestration?.id,
      }),
    [candidateRuns, params.orchestration?.id, params.projectId],
  );

  const { currentRunId, runQueryId } = resolveRunIds({
    orchestrationRunId: params.orchestrationRunId,
    fallbackRunId: fallbackRunResolution.run?.id,
  });
  const isRunInferredByProjectOnly = resolveRunInferenceFlag({
    orchestrationRunId: params.orchestrationRunId,
    matchType: fallbackRunResolution.matchType,
  });

  const { data: workflowRun } = useQuery({
    queryKey: queryKeys.workflowRuns.detail(runQueryId),
    queryFn: () => api.getWorkflowRun(runQueryId),
    enabled: Boolean(currentRunId),
    refetchInterval: resolveRunPollingInterval(currentRunId),
    initialData: fallbackRunResolution.run ?? undefined,
  });

  const {
    data: runtimeCapabilities,
    isLoading: isCapabilitiesLoading,
    error: capabilitiesError,
  } = useQuery({
    queryKey: queryKeys.projectOrchestration.capabilities(
      params.projectId,
      currentRunId ?? "none",
    ),
    queryFn: () =>
      api.getRuntimeCapabilities({
        workflow_run_id: runQueryId,
      }),
    enabled: Boolean(currentRunId),
    refetchInterval: resolveCapabilitiesPollingInterval(currentRunId),
  });

  const { data: workflowRunEvents = [] } = useQuery({
    queryKey: queryKeys.workflowRuns.events(runQueryId),
    queryFn: () => api.getWorkflowRunEvents(runQueryId),
    enabled: Boolean(currentRunId),
    refetchInterval: resolveRunPollingInterval(currentRunId),
  });

  const pendingQuestions = useMemo(
    () => getPendingQuestions(workflowRunEvents),
    [workflowRunEvents],
  );

  const activeSessionWorkItem = useMemo(
    () =>
      findActiveSessionWorkItem({ currentRunId, workItems: params.workItems }),
    [currentRunId, params.workItems],
  );

  const activeSessionHref = resolveActiveSessionHref({
    projectId: params.projectId,
    runId: currentRunId,
    workItemId: activeSessionWorkItem?.id ?? null,
  });

  return {
    currentRunId,
    workflowRun,
    workflowRunEvents,
    runtimeCapabilities,
    isCapabilitiesLoading,
    capabilitiesError,
    pendingQuestions,
    activeSessionHref,
    isRunInferredByProjectOnly,
  };
}

export function useOrchestrationTabState(projectId: string) {
  const queryClient = useQueryClient();
  const [startDialogOpen, setStartDialogOpen] = useState(false);
  const [mode, setMode] = useState<ProjectOrchestrationMode>("supervised");
  const [rejectFeedback, setRejectFeedback] = useState("");
  const [notice, setNotice] = useState<NoticeState | null>(null);

  const { data, isLoading } = useProjectOrchestrationState(projectId);
  const { data: workItems = [] } = useProjectWorkItems(projectId);

  const { data: projectGoals = [] } = useProjectGoals(projectId, false);

  const startMutation = useStartProjectOrchestration(projectId);
  const updateModeMutation = useUpdateProjectOrchestrationMode(projectId);
  const approveMutation = useApproveProjectOrchestration(projectId);
  const rejectMutation = useRejectProjectOrchestration(projectId);
  const pauseMutation = usePauseProjectOrchestration(projectId);
  const resumeMutation = useResumeProjectOrchestration(projectId);
  const recoverImportedHydrationMutation =
    useRecoverImportedHydrationProjectOrchestration(projectId);
  const completeMutation = useCompleteProjectOrchestration(projectId);
  const approveActionMutation = useApproveProjectOrchestrationAction(projectId);
  const rejectActionMutation = useRejectProjectOrchestrationAction(projectId);
  const resetIntentsMutation = useResetProjectOrchestrationIntents(projectId);

  const { orchestration, projectState, pendingActionRequests } =
    resolveOrchestrationData(data);
  const orchestrationRunId = orchestration?.currentWorkflowRunId ?? null;

  const {
    data: orchestrationDiagnostics,
    isLoading: isDiagnosticsLoading,
    error: diagnosticsError,
    refetch: refetchDiagnostics,
  } = useQuery({
    queryKey: queryKeys.projectOrchestration.diagnostics(projectId),
    queryFn: () => api.getProjectOrchestrationDiagnostics(projectId),
    enabled: !!orchestration,
    refetchInterval: 10_000,
  });

  const replayRetrospectiveMutation = useMutation({
    mutationFn: (payload?: ReplayProjectRetrospectiveRequest) =>
      api.replayProjectRetrospective(projectId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projectOrchestration.diagnostics(projectId),
      });
    },
  });

  useEffect(() => {
    if (!startDialogOpen) {
      return;
    }

    setMode(orchestration?.orchestrationMode ?? "supervised");
  }, [orchestration?.orchestrationMode, startDialogOpen]);

  const goalsSummary = useMemo(
    () =>
      buildGoalsSummary(
        projectGoals.map((goal) => ({
          title: goal.title,
          status: goal.status,
        })),
      ),
    [projectGoals],
  );

  const {
    currentRunId,
    workflowRun,
    workflowRunEvents,
    runtimeCapabilities,
    isCapabilitiesLoading,
    capabilitiesError,
    pendingQuestions,
    activeSessionHref,
    isRunInferredByProjectOnly,
  } = useOrchestrationRunContext({
    projectId,
    orchestration,
    orchestrationRunId,
    workItems,
  });

  const submitAnswersMutation = useMutation(
    createSubmitAnswersMutation({
      currentRunId,
      setNotice,
      invalidateRunEvents: (runId: string) =>
        queryClient.invalidateQueries({
          queryKey: queryKeys.workflowRuns.events(runId),
        }),
    }),
  );

  const abortRunMutation = useMutation({
    mutationFn: () => api.abortWorkflowRun(requireRunId(currentRunId)),
    onSuccess: async () => {
      if (!currentRunId) {
        return;
      }

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.workflowRuns.detail(currentRunId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.workflowRuns.events(currentRunId),
        }),
      ]);
    },
  });

  const notifications = useMemo(
    () =>
      resolveNotifications({
        orchestration,
        workItems,
        workflowRun,
        workflowRunEvents,
      }),
    [orchestration, workItems, workflowRun, workflowRunEvents],
  );

  const canRecoverImportedHydration = Boolean(
    orchestration &&
    orchestrationDiagnostics?.reasons.some(
      (reason) => reason.code === "import_hydration_blocked",
    ),
  );

  return {
    isLoading,
    startDialogOpen,
    setStartDialogOpen,
    goalsSummary,
    mode,
    setMode,
    rejectFeedback,
    setRejectFeedback,
    notice,
    setNotice,
    orchestration,
    projectState,
    pendingActionRequests,
    currentRunId,
    isRunInferredByProjectOnly,
    workflowRun,
    workflowRunEvents,
    orchestrationDiagnostics,
    refetchDiagnostics,
    isDiagnosticsLoading,
    diagnosticsError,
    replayRetrospectiveMutation,
    runtimeCapabilities,
    isCapabilitiesLoading,
    capabilitiesError,
    pendingQuestions,
    activeSessionHref,
    startMutation,
    updateModeMutation,
    approveMutation,
    rejectMutation,
    pauseMutation,
    resumeMutation,
    recoverImportedHydrationMutation,
    abortRunMutation,
    completeMutation,
    approveActionMutation,
    rejectActionMutation,
    resetIntentsMutation,
    submitAnswersMutation,
    notifications,
    canRecoverImportedHydration,
    refreshRunLink: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.projectOrchestration.diagnostics(projectId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.workflowRuns.list({ projectId }),
        }),
      ]);
    },
  };
}
