import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { ListProjectMemorySegmentsRequest, MemorySegmentType } from "@/lib/api/chat-sessions.types";
import { queryKeys } from "@/lib/queryKeys";

const DEFAULT_PAGE_LIMIT = 25;
const DEFAULT_PAGE_OFFSET = 0;

function normalizeParams(params?: ListProjectMemorySegmentsRequest): {
  memory_type?: MemorySegmentType;
  query?: string;
  limit: number;
  offset: number;
} {
  const trimmedQuery = params?.query?.trim();

  return {
    memory_type: params?.memory_type,
    query: trimmedQuery && trimmedQuery.length > 0 ? trimmedQuery : undefined,
    limit: params?.limit ?? DEFAULT_PAGE_LIMIT,
    offset: params?.offset ?? DEFAULT_PAGE_OFFSET,
  };
}

export function useProjectMemorySegments(
  projectId: string,
  params?: ListProjectMemorySegmentsRequest,
) {
  const normalized = normalizeParams(params);

  return useQuery({
    queryKey: queryKeys.memory.projectMemory(projectId, normalized),
    queryFn: () => api.getProjectMemorySegments(projectId, normalized),
    enabled: projectId.trim().length > 0,
  });
}