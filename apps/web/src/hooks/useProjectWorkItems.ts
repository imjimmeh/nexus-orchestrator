import {
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { WorkItem } from "@/lib/api/work-items.types";
import type { UseProjectWorkItemsOptions } from "./useProjectWorkItems.types";

const DEFAULT_WORK_ITEM_LIMIT = 200;

export function useProjectWorkItems(
  projectId: string,
  options: UseProjectWorkItemsOptions = {},
): UseQueryResult<WorkItem[], Error> {
  const { limit, scope, enabled, refetchInterval } = options;

  return useQuery<WorkItem[], Error>({
    queryKey: queryKeys.projectWorkItems.list(projectId, scope),
    queryFn: async () => {
      if (limit !== undefined) {
        const response = await api.getProjectWorkItems(projectId, { limit });
        return response.items;
      }

      const items: WorkItem[] = [];
      let offset = 0;

      while (true) {
        const response = await api.getProjectWorkItems(projectId, {
          limit: DEFAULT_WORK_ITEM_LIMIT,
          offset,
        });

        items.push(...response.items);

        const nextOffset = response.offset + response.items.length;
        if (nextOffset >= response.total || response.items.length === 0) {
          return items;
        }

        offset = nextOffset;
      }
    },
    enabled: enabled ?? Boolean(projectId),
    ...(refetchInterval === undefined ? {} : { refetchInterval }),
  });
}

export function useInvalidateProjectWorkItems(projectId: string) {
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.projectWorkItems.all(projectId),
    });
  };
}
