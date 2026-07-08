import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { UpdateWorkItemRequest, WorkItem } from "@/lib/api/work-items.types";

const WORK_ITEM_QUERY_KEY = "project-work-items";

interface UpdateWorkItemVariables {
  readonly projectId: string;
  readonly workItemId: string;
  readonly data: UpdateWorkItemRequest;
}

/**
 * Generic work-item update mutation shared by any surface that edits a
 * single field on a work item in place (e.g. the story point chip). Mirrors
 * the cache-update convention used by `useWorkItemUpdateMutation` in
 * `work-item-detail-sheet.hooks.ts`, but takes the target project/work item
 * per-call instead of being bound to one item up front.
 */
export function useUpdateWorkItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, workItemId, data }: UpdateWorkItemVariables) =>
      api.updateWorkItem(projectId, workItemId, data),
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
