import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { memoryApi } from "@/lib/api/memory";
import type { MemoryMetricsResponse } from "@/lib/api/memory.types";
import { queryKeys } from "@/lib/queryKeys";

const DEFAULT_REFETCH_INTERVAL_MS = 30_000;

export function useMemoryMetrics(
  options: { refetchInterval?: number } = {},
): UseQueryResult<MemoryMetricsResponse, Error> {
  const refetchInterval =
    options.refetchInterval ?? DEFAULT_REFETCH_INTERVAL_MS;

  return useQuery<MemoryMetricsResponse, Error>({
    queryKey: queryKeys.memory.metrics(),
    queryFn: () => memoryApi.getMemoryMetrics(),
    refetchInterval,
  });
}