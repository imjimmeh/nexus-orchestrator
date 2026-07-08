import { useQueryClient } from "@tanstack/react-query";
import { WorkItem } from "@/lib/api/work-items.types";
import {
  useDeleteWorkItemFlow,
  useRestartExecutionMutation,
} from "./work-item-detail-sheet.hooks";

/**
 * Board-level work item actions shared by the card context menu. Reuses the same
 * restart-execution mutation and delete flow that power the work item detail
 * panel so retrigger/delete behave identically from either surface.
 */
export function useKanbanCardActions() {
  const queryClient = useQueryClient();
  const restartExecutionMutation = useRestartExecutionMutation({ queryClient });
  const deleteFlow = useDeleteWorkItemFlow({ queryClient });

  const retriggerItemExecution = (item: WorkItem) => {
    restartExecutionMutation.mutate(item);
  };

  const deleteItem = (item: WorkItem) => {
    deleteFlow.requestDelete(item);
  };

  return { retriggerItemExecution, deleteItem, deleteFlow };
}
