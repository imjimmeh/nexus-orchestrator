import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";

export function useCharter(projectId: string) {
  return useQuery({
    queryKey: queryKeys.charter.detail(projectId),
    queryFn: () => api.getCharter(projectId),
  });
}