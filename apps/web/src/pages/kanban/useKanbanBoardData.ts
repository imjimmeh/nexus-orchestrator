import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { useProjectWorkItems } from "@/hooks/useProjectWorkItems";
import { useWorkItemRealtimeSubscription } from "@/hooks/useWorkItemRealtimeSubscription";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { CreateWorkItemRequest, WorkItem, WorkItemExecutionConfig, WorkItemStatus } from "@/lib/api/work-items.types";
import { WORK_ITEM_QUERY_KEY } from "./kanban.board-helpers";
import {KanbanStatusNotice} from "./types";

interface StatusUpdateResultPayload {
  workItem: WorkItem;
  triggeredRunIds: string[];
}

interface StatusUpdateMutationVariables {
  workItemId: string;
  status: WorkItemStatus;
  bypassReadinessGates?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isWorkItem(value: unknown): value is WorkItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.status === "string"
  );
}

export function parseStatusUpdateResult(
  data: unknown,
): StatusUpdateResultPayload | null {
  if (!isRecord(data)) {
    return null;
  }

  const workItemCandidate = data.workItem;
  if (isWorkItem(workItemCandidate)) {
    const runIds = Array.isArray(data.triggeredRunIds)
      ? data.triggeredRunIds.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    return {
      workItem: workItemCandidate,
      triggeredRunIds: runIds,
    };
  }

  const nestedData = data.data;
  if (isRecord(nestedData) && isWorkItem(nestedData.workItem)) {
    const runIds = Array.isArray(nestedData.triggeredRunIds)
      ? nestedData.triggeredRunIds.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    return {
      workItem: nestedData.workItem,
      triggeredRunIds: runIds,
    };
  }

  if (isWorkItem(data)) {
    return {
      workItem: data,
      triggeredRunIds: [],
    };
  }

  return null;
}

export function buildStatusUpdateSuccessNotice(params: {
  result: StatusUpdateResultPayload;
  variables: StatusUpdateMutationVariables;
}): KanbanStatusNotice | null {
  if (
    params.variables.bypassReadinessGates === true &&
    params.variables.status === "in-progress" &&
    params.result.workItem.status === "in-progress"
  ) {
    return {
      kind: "info",
      message:
        "Moved to in-progress manually. Direct board moves bypass readiness rerouting; automation for the target status still runs normally.",
    };
  }

  if (params.result.triggeredRunIds.length === 0) {
    return {
      kind: "info",
      message: `Status changed to ${params.result.workItem.status}, but no workflow automation was triggered for this status.`,
    };
  }

  return null;
}

function isLifecycleGateBlockedError(error: unknown): error is {
  response: { status: number; data: { code: string; message: string } };
} {
  if (!isRecord(error)) return false;
  const response = error.response;
  if (!isRecord(response)) return false;
  if (response.status !== 409) return false;
  const data = response.data;
  if (!isRecord(data)) return false;
  return (
    data.code === "LIFECYCLE_GATE_BLOCKED" && typeof data.message === "string"
  );
}

export function buildStatusUpdateErrorNotice(
  error: unknown,
): KanbanStatusNotice & { refetch: boolean } {
  if (isLifecycleGateBlockedError(error)) {
    return {
      kind: "error",
      message: `Move blocked by checks: ${error.response.data.message}`,
      refetch: true,
    };
  }

  if (error instanceof Error && error.message) {
    return {
      kind: "error",
      message: error.message,
      refetch: false,
    };
  }

  return {
    kind: "error",
    message: "Unable to move work item to the selected status.",
    refetch: false,
  };
}

function handleStatusUpdateSuccess(params: {
  data: unknown;
  variables: StatusUpdateMutationVariables;
  projectId: string | undefined;
  queryClient: ReturnType<typeof useQueryClient>;
  setStatusNotice: (value: KanbanStatusNotice | null) => void;
}) {
  const parsedResult = parseStatusUpdateResult(params.data);
  if (!parsedResult) {
    void params.queryClient.invalidateQueries({
      queryKey: [WORK_ITEM_QUERY_KEY, params.projectId],
    });
    params.setStatusNotice({
      kind: "error",
      message:
        "Status update response was incomplete. The board was refreshed; retry the move if needed.",
    });
    return;
  }

  params.queryClient.setQueryData<WorkItem[]>(
    [WORK_ITEM_QUERY_KEY, params.projectId],
    (current = []) =>
      current.map((item) =>
        item.id === parsedResult.workItem.id ? parsedResult.workItem : item,
      ),
  );

  void params.queryClient.invalidateQueries({
    queryKey: [WORK_ITEM_QUERY_KEY, params.projectId],
  });

  const successNotice = buildStatusUpdateSuccessNotice({
    result: parsedResult,
    variables: params.variables,
  });
  if (successNotice) {
    params.setStatusNotice(successNotice);
  }
}

export function useKanbanBoardQueries(
  projectId: string | undefined,
  configWorkItemId: string | null,
) {
  const { data: items = [] } = useProjectWorkItems(projectId ?? "");

  const { data: automationStatuses = [] } = useQuery({
    queryKey: ["work-item-automation-statuses", projectId],
    queryFn: () => {
      if (!projectId) {
        throw new Error("projectId is required");
      }
      return api.getWorkItemAutomationTriggers(projectId);
    },
    enabled: !!projectId,
  });

  const { data: agentProfiles = [] } = useQuery({
    queryKey: ["agent-profiles-for-task-config"],
    queryFn: () => api.getAgentProfiles(),
  });

  const { data: repositoryBranches = [] } = useQuery({
    queryKey: ["project-repository-branches", projectId],
    queryFn: () => {
      if (!projectId) {
        throw new Error("projectId is required");
      }
      return api.getProjectRepositoryBranches(projectId);
    },
    enabled: !!projectId,
  });

  const { data: repositoryFiles = [] } = useQuery({
    queryKey: ["project-repository-files", projectId],
    queryFn: () => {
      if (!projectId) {
        throw new Error("projectId is required");
      }
      return api.getProjectRepositoryFiles(projectId);
    },
    enabled: !!projectId,
  });

  const { data: currentExecutionConfig } = useQuery({
    queryKey: ["work-item-execution-config", projectId, configWorkItemId],
    queryFn: () => {
      if (!projectId || !configWorkItemId) {
        throw new Error("projectId and workItemId are required");
      }
      return api.getWorkItemExecutionConfig(projectId, configWorkItemId);
    },
    enabled: !!projectId && !!configWorkItemId,
  });

  return {
    items,
    automationStatuses,
    agentProfiles,
    repositoryBranches,
    repositoryFiles,
    currentExecutionConfig,
  };
}

function useKanbanMutations(params: {
  projectId: string | undefined;
  setFailedItemId: (value: string | null) => void;
  setStatusNotice: (value: KanbanStatusNotice | null) => void;
}) {
  const { projectId, setFailedItemId, setStatusNotice } = params;
  const queryClient = useQueryClient();

  const updateStatus = useMutation({
    mutationFn: ({
      workItemId,
      status,
      bypassReadinessGates,
    }: StatusUpdateMutationVariables) => {
      if (!projectId) {
        throw new Error("projectId is required");
      }

      return api.updateProjectWorkItemStatus(projectId, workItemId, {
        status,
        bypassReadinessGates,
      });
    },
    onMutate: () => {
      setFailedItemId(null);
      setStatusNotice(null);
    },
    onError: (error, variables) => {
      setFailedItemId(variables.workItemId);
      const errorResult = buildStatusUpdateErrorNotice(error);
      setStatusNotice({ kind: errorResult.kind, message: errorResult.message });
      if (errorResult.refetch) {
        void queryClient.invalidateQueries({
          queryKey: [WORK_ITEM_QUERY_KEY, projectId],
        });
      }
    },
    onSuccess: (data, variables) => {
      handleStatusUpdateSuccess({
        data,
        variables,
        projectId,
        queryClient,
        setStatusNotice,
      });
    },
  });

  const upsertExecutionConfig = useMutation({
    mutationFn: ({
      workItemId,
      config,
    }: {
      workItemId: string;
      config: WorkItemExecutionConfig;
    }) => {
      if (!projectId) {
        throw new Error("projectId is required");
      }

      return api.upsertWorkItemExecutionConfig(projectId, workItemId, config);
    },
    onSuccess: (updatedWorkItem) => {
      queryClient.setQueryData<WorkItem[]>(
        [WORK_ITEM_QUERY_KEY, projectId],
        (current = []) =>
          current.map((item) =>
            item.id === updatedWorkItem.id ? updatedWorkItem : item,
          ),
      );
    },
  });

  const createWorkItem = useMutation({
    mutationFn: (data: CreateWorkItemRequest) => {
      if (!projectId) {
        throw new Error("projectId is required");
      }
      return api.createWorkItem(projectId, data);
    },
    onMutate: () => {
      setFailedItemId(null);
      setStatusNotice(null);
    },
    onError: (error) => {
      setStatusNotice({
        kind: "error",
        message: getApiErrorMessage(error, "Unable to create work item."),
      });
    },
    onSuccess: (newItem) => {
      queryClient.setQueryData<WorkItem[]>(
        [WORK_ITEM_QUERY_KEY, projectId],
        (current = []) => [newItem, ...current],
      );
      void queryClient.invalidateQueries({
        queryKey: [WORK_ITEM_QUERY_KEY, projectId],
      });
    },
  });

  return { updateStatus, upsertExecutionConfig, createWorkItem };
}

export function useKanbanBoardActions(params: {
  projectId: string | undefined;
  setFailedItemId: (value: string | null) => void;
  setStatusNotice: (value: KanbanStatusNotice | null) => void;
}) {
  const { projectId, setFailedItemId, setStatusNotice } = params;
  const { updateStatus, upsertExecutionConfig, createWorkItem } =
    useKanbanMutations({
      projectId,
      setFailedItemId,
      setStatusNotice,
    });
  useWorkItemRealtimeSubscription(projectId);
  return { updateStatus, upsertExecutionConfig, createWorkItem };
}
