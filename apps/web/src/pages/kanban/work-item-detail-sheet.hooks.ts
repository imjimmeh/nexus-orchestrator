import { useEffect, useState } from "react";
import { type QueryClient, useMutation, useQuery } from "@tanstack/react-query";
import type { StoryPoints, WorkItemType } from "@nexus/kanban-contracts";
import { api } from "@/lib/api/client";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { useToast } from "@/hooks/useToast";
import { WorkItem } from "@/lib/api/work-items.types";

const WORK_ITEM_QUERY_KEY = "project-work-items";
const GLOBAL_WORK_ITEMS_QUERY_KEY = "global-work-items";

export function useWorkItemRuns(item: WorkItem | null) {
  const { data: currentRun, isLoading: isCurrentRunLoading } = useQuery({
    queryKey: ["workflow-run", item?.currentExecutionId],
    queryFn: () => {
      if (!item?.currentExecutionId) {
        throw new Error("No execution id");
      }

      return api.getWorkflowRun(item.currentExecutionId);
    },
    enabled: !!item?.currentExecutionId,
    refetchInterval: (query) => {
      const run = query.state.data;
      if (!run) {
        return false;
      }

      return run.status === "RUNNING" || run.status === "PENDING"
        ? 3000
        : false;
    },
  });

  const { data: executionHistory = [], isLoading: isLoadingExecutionHistory } =
    useQuery({
      queryKey: ["work-item-executions", item?.project_id, item?.id],
      queryFn: () => {
        if (!item) {
          throw new Error("No item selected");
        }

        return api.getWorkItemExecutions(item.project_id, item.id);
      },
      enabled: !!item,
      refetchInterval: (query) => {
        const runs = query.state.data || [];
        const hasActiveRun = runs.some(
          (run) => run.status === "RUNNING" || run.status === "PENDING",
        );
        return hasActiveRun ? 3000 : false;
      },
    });

  return {
    currentRun,
    isCurrentRunLoading,
    executionHistory,
    isLoadingExecutionHistory,
  };
}

export function useWorkItemFormState(item: WorkItem | null) {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("");
  const [dependencyIds, setDependencyIds] = useState<string[]>([]);
  const [type, setType] = useState<WorkItemType>("task");
  const [parentWorkItemId, setParentWorkItemId] = useState<string | null>(null);
  const [storyPoints, setStoryPoints] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const resetFromItem = () => {
    if (!item) {
      return;
    }

    setTitle(item.title);
    setDescription(item.description ?? "");
    setPriority(item.priority);
    setDependencyIds(item.dependsOn ?? []);
    setType(item.type);
    setParentWorkItemId(item.parentWorkItemId ?? null);
    setStoryPoints(item.storyPoints ?? null);
    setErrors({});
    setIsEditing(false);
  };

  useEffect(() => {
    if (!item) {
      return;
    }

    setTitle(item.title);
    setDescription(item.description ?? "");
    setPriority(item.priority);
    setDependencyIds(item.dependsOn ?? []);
    setType(item.type);
    setParentWorkItemId(item.parentWorkItemId ?? null);
    setStoryPoints(item.storyPoints ?? null);
    setErrors({});
    setIsEditing(false);
  }, [item]);

  return {
    isEditing,
    title,
    description,
    priority,
    dependencyIds,
    type,
    parentWorkItemId,
    storyPoints,
    errors,
    setTitle,
    setDescription,
    setPriority,
    setDependencyIds,
    setType,
    setParentWorkItemId,
    setStoryPoints,
    setErrors,
    setIsEditing,
    resetFromItem,
  };
}

export function useWorkItemUpdateMutation(params: {
  item: WorkItem | null;
  queryClient: QueryClient;
  setIsEditing: (value: boolean) => void;
}) {
  const { item, queryClient, setIsEditing } = params;

  return useMutation({
    mutationFn: (data: {
      title: string;
      description: string;
      priority: string;
      dependencyIds: string[];
      type: WorkItemType;
      parentWorkItemId: string | null;
      storyPoints: StoryPoints | null;
    }) => {
      if (!item) {
        throw new Error("No item selected");
      }

      return api.updateWorkItem(item.project_id, item.id, data);
    },
    onSuccess: (updatedItem) => {
      queryClient.setQueryData<WorkItem[]>(
        [WORK_ITEM_QUERY_KEY, updatedItem.project_id],
        (current = []) =>
          current.map((entry) =>
            entry.id === updatedItem.id ? updatedItem : entry,
          ),
      );
      setIsEditing(false);
    },
  });
}

export function useRestartExecutionMutation(params: {
  queryClient: QueryClient;
}) {
  const { queryClient } = params;
  const toast = useToast();

  return useMutation({
    mutationFn: (item: WorkItem) =>
      api.restartWorkItemExecution(item.project_id, item.id),
    onMutate: (item) => {
      toast.info("Retriggering execution", `For "${item.title}"`);
    },
    onSuccess: ({ workItem }) => {
      toast.success("Execution retriggered", `For "${workItem.title}"`);

      queryClient.setQueryData<WorkItem[]>(
        [WORK_ITEM_QUERY_KEY, workItem.project_id],
        (current = []) =>
          current.map((entry) =>
            entry.id === workItem.id ? { ...entry, ...workItem } : entry,
          ),
      );

      void queryClient.invalidateQueries({
        queryKey: ["work-item-executions", workItem.project_id, workItem.id],
      });

      if (workItem.currentExecutionId) {
        void queryClient.invalidateQueries({
          queryKey: ["workflow-run", workItem.currentExecutionId],
        });
      }
    },
    onError: (error, item) => {
      toast.error(
        "Failed to retrigger execution",
        getApiErrorMessage(error, `For "${item.title}".`),
      );
    },
  });
}

export function useResolveFeedbackMutation(params: {
  item: WorkItem | null;
  queryClient: QueryClient;
}) {
  const { item, queryClient } = params;

  return useMutation({
    mutationFn: (response: string) => {
      if (!item) {
        throw new Error("No item selected");
      }

      return api.submitWorkItemFeedbackResolution(item.project_id, item.id, {
        response,
      });
    },
    onSuccess: (updatedItem) => {
      queryClient.setQueryData<WorkItem[]>(
        [WORK_ITEM_QUERY_KEY, updatedItem.project_id],
        (current = []) =>
          current.map((entry) =>
            entry.id === updatedItem.id ? updatedItem : entry,
          ),
      );
    },
  });
}

export function useDeleteWorkItemFlow(params: {
  queryClient: QueryClient;
  onDeleted?: (workItem: WorkItem) => void;
}) {
  const { queryClient, onDeleted } = params;
  const [pendingDeleteItem, setPendingDeleteItem] = useState<WorkItem | null>(
    null,
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (variables: { projectId: string; workItemId: string }) =>
      api.deleteWorkItem(variables.projectId, variables.workItemId),
    onSuccess: (_, variables) => {
      queryClient.setQueryData<WorkItem[]>(
        [WORK_ITEM_QUERY_KEY, variables.projectId],
        (current = []) =>
          current.filter((entry) => entry.id !== variables.workItemId),
      );

      void queryClient.invalidateQueries({
        queryKey: [WORK_ITEM_QUERY_KEY, variables.projectId],
      });
      void queryClient.invalidateQueries({
        queryKey: [GLOBAL_WORK_ITEMS_QUERY_KEY],
      });
    },
  });

  const requestDelete = (workItem: WorkItem) => {
    setDeleteError(null);
    setPendingDeleteItem(workItem);
  };

  const handleDialogOpenChange = (open: boolean) => {
    if (!open) {
      setPendingDeleteItem(null);
      setDeleteError(null);
    }
  };

  const handleDelete = async () => {
    if (!pendingDeleteItem) {
      return;
    }

    const target = pendingDeleteItem;
    setDeleteError(null);
    try {
      await deleteMutation.mutateAsync({
        projectId: target.project_id,
        workItemId: target.id,
      });
      setPendingDeleteItem(null);
      onDeleted?.(target);
    } catch (error) {
      setDeleteError(getApiErrorMessage(error, "Failed to delete work item."));
    }
  };

  return {
    pendingDeleteItem,
    isDeleteDialogOpen: pendingDeleteItem !== null,
    deleteError,
    deleteMutation,
    requestDelete,
    handleDialogOpenChange,
    handleDelete,
  };
}
