import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { StoryPoints } from "@nexus/kanban-contracts";
import { WorkItem } from "@/lib/api/work-items.types";
import { WorkflowRun } from "@/lib/api/workflows.types";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  canRestartWorkItemExecution,
  validateWorkItemForm,
} from "./kanban.utils";
import { MergeWorkItemDialog } from "./MergeWorkItemDialog";
import { WorkItemDetailPanel } from "./WorkItemDetailPanel";
import { DeleteWorkItemDialog } from "./DeleteWorkItemDialog";
import { LifecycleResultsCard } from "@/components/workflows/LifecycleResultsCard";
import {
  useDeleteWorkItemFlow,
  useResolveFeedbackMutation,
  useRestartExecutionMutation,
  useWorkItemFormState,
  useWorkItemRuns,
  useWorkItemUpdateMutation,
} from "./work-item-detail-sheet.hooks";

interface WorkItemDetailSheetProps {
  item: WorkItem | null;
  allItems: WorkItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function getMergeLifecycleMetadata(
  item: WorkItem,
): Record<string, unknown> | null {
  if (!item.metadata || typeof item.metadata !== "object") {
    return null;
  }

  const lifecycle = item.metadata.lifecycle;
  if (!lifecycle || typeof lifecycle !== "object") {
    return null;
  }

  const merge = (lifecycle as Record<string, unknown>).merge;
  return merge && typeof merge === "object"
    ? (merge as Record<string, unknown>)
    : null;
}

function getMergeStatusAndReason(item: WorkItem): {
  mergeStatus: string | null;
  mergeReason: string | null;
} {
  const mergeMetadata = getMergeLifecycleMetadata(item);
  return {
    mergeStatus:
      typeof mergeMetadata?.status === "string" ? mergeMetadata.status : null,
    mergeReason:
      typeof mergeMetadata?.reason === "string" ? mergeMetadata.reason : null,
  };
}

function hasActiveSession(item: WorkItem | null): boolean {
  return (
    !!item?.currentExecutionId &&
    (item.status === "refinement" ||
      item.status === "in-progress" ||
      item.status === "in-review" ||
      item.status === "ready-to-merge" ||
      item.status === "blocked")
  );
}

function canMergeWorkItem(item: WorkItem | null): boolean {
  if (
    !item?.executionConfig?.targetBranch ||
    !item.executionConfig.baseBranch
  ) {
    return false;
  }

  return (
    item.status === "ready-to-merge" ||
    item.status === "in-review" ||
    item.status === "blocked"
  );
}

function useWorkItemDetailSheetState(params: {
  item: WorkItem | null;
  allItems: WorkItem[];
  onOpenChange: (open: boolean) => void;
}) {
  const { item, allItems, onOpenChange } = params;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);

  const itemsById = useMemo(
    () => new Map(allItems.map((entry) => [entry.id, entry])),
    [allItems],
  );

  const formState = useWorkItemFormState(item);
  const runs = useWorkItemRuns(item);
  const isItemSessionActive = useMemo(() => hasActiveSession(item), [item]);
  const canMerge = useMemo(() => canMergeWorkItem(item), [item]);
  const canRestartExecution = useMemo(
    () => canRestartWorkItemExecution(item),
    [item],
  );

  const updateMutation = useWorkItemUpdateMutation({
    item,
    queryClient,
    setIsEditing: formState.setIsEditing,
  });
  const resolveFeedbackMutation = useResolveFeedbackMutation({
    item,
    queryClient,
  });
  const restartExecutionMutation = useRestartExecutionMutation({ queryClient });
  const deleteFlow = useDeleteWorkItemFlow({
    queryClient,
    onDeleted: () => onOpenChange(false),
  });

  const openActiveSession = () => {
    if (item) {
      navigate(
        `/projects/${item.project_id}/work-items/${item.id}/active-session`,
      );
    }
  };

  const openCurrentRun = () => {
    if (runs.currentRun) {
      navigate(
        `/workflows/${runs.currentRun.workflow_id}/runs/${runs.currentRun.id}`,
      );
    }
  };

  const openHistoryRun = (run: WorkflowRun) => {
    navigate(`/workflows/${run.workflow_id}/runs/${run.id}`);
  };

  const handleSave = () => {
    const parentItem = itemsById.get(formState.parentWorkItemId ?? "");

    const validationErrors = validateWorkItemForm({
      title: formState.title,
      description: formState.description,
      priority: formState.priority,
      dependencyIds: formState.dependencyIds,
      type: formState.type,
      parentType: parentItem?.type ?? null,
      storyPoints: formState.storyPoints,
    });

    formState.setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    updateMutation.mutate({
      title: formState.title,
      description: formState.description,
      priority: formState.priority,
      dependencyIds: formState.dependencyIds,
      type: formState.type,
      parentWorkItemId: formState.parentWorkItemId,
      storyPoints: formState.storyPoints as StoryPoints | null,
    });
  };

  return {
    formState,
    runs,
    isItemSessionActive,
    canMerge,
    canRestartExecution,
    mergeDialogOpen,
    setMergeDialogOpen,
    updateMutation,
    restartExecutionMutation,
    deleteFlow,
    openActiveSession,
    openCurrentRun,
    openHistoryRun,
    handleSave,
    resolveFeedbackMutation,
  };
}

export function WorkItemDetailSheet({
  item,
  allItems,
  open,
  onOpenChange,
}: Readonly<WorkItemDetailSheetProps>) {
  const state = useWorkItemDetailSheetState({ item, allItems, onOpenChange });

  if (!item) {
    return null;
  }

  const { mergeStatus, mergeReason } = getMergeStatusAndReason(item);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Work Item Detail</SheetTitle>
          <SheetDescription>
            {item.id} &middot; {item.status}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          <LifecycleResultsCard
            query={{ scopeId: item.project_id, contextId: item.id }}
          />

          <WorkItemDetailPanel
            item={item}
            allItems={allItems}
            formState={state.formState}
            canMerge={state.canMerge}
            canRestartExecution={state.canRestartExecution}
            hasActiveSession={state.isItemSessionActive}
            mergeStatus={mergeStatus}
            mergeReason={mergeReason}
            runs={state.runs}
            isSaving={state.updateMutation.isPending}
            hasSaveError={state.updateMutation.isError}
            isRestartingExecution={state.restartExecutionMutation.isPending}
            isDeleting={state.deleteFlow.deleteMutation.isPending}
            onSave={state.handleSave}
            onCancel={state.formState.resetFromItem}
            onOpenActiveSession={state.openActiveSession}
            onOpenCurrentRun={state.openCurrentRun}
            onOpenHistoryRun={state.openHistoryRun}
            onOpenMerge={() => {
              state.setMergeDialogOpen(true);
            }}
            onRestartExecution={() => {
              state.restartExecutionMutation.mutate(item);
            }}
            onDelete={() => {
              state.deleteFlow.requestDelete(item);
            }}
            onResolveFeedback={(response) => {
              state.resolveFeedbackMutation.mutate(response);
            }}
          />
        </div>
      </SheetContent>

      {state.canMerge ? (
        <MergeWorkItemDialog
          item={item}
          open={state.mergeDialogOpen}
          onOpenChange={state.setMergeDialogOpen}
        />
      ) : null}

      {state.deleteFlow.pendingDeleteItem ? (
        <DeleteWorkItemDialog
          item={state.deleteFlow.pendingDeleteItem}
          isOpen={state.deleteFlow.isDeleteDialogOpen}
          errorMessage={state.deleteFlow.deleteError}
          isDeleting={state.deleteFlow.deleteMutation.isPending}
          onOpenChange={state.deleteFlow.handleDialogOpenChange}
          onDelete={state.deleteFlow.handleDelete}
        />
      ) : null}
    </Sheet>
  );
}
