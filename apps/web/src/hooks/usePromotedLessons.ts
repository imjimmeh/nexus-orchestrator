import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { selfImprovementApi } from "@/lib/api/self-improvement";
import type {
  PromotedLessonsParams,
  PromotedLessonsResponse,
} from "@/lib/api/self-improvement.types";
import { queryKeys } from "@/lib/queryKeys";

const DEFAULT_REFETCH_INTERVAL_MS = 30_000;
const DEFAULT_SINCE = "7d";

/**
 * React Query hook for the control plane's
 * `PromotedLessonsCard` + `SkillBindingUsageCard` snapshot.
 *
 * Mirrors `useMemoryMetrics`: 30s refetch default so operators
 * see fresh promotion/closure activity without manually
 * refreshing, and the `since` parameter is forwarded verbatim
 * to the backend.
 */
export function usePromotedLessons(
  options: {
    refetchInterval?: number;
    params?: PromotedLessonsParams;
  } = {},
): UseQueryResult<PromotedLessonsResponse, Error> {
  const refetchInterval =
    options.refetchInterval ?? DEFAULT_REFETCH_INTERVAL_MS;
  const params = options.params ?? { since: DEFAULT_SINCE };

  return useQuery<PromotedLessonsResponse, Error>({
    queryKey: queryKeys.selfImprovement.promotedLessons(params),
    queryFn: () => selfImprovementApi.fetchPromotedLessons(params),
    refetchInterval,
  });
}
