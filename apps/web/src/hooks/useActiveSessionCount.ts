import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";

const ACTIVE_CHAT_STATUSES = "RUNNING,STARTING";
const ACTIVE_WORKFLOW_STATUSES = "RUNNING,PENDING";
const REFETCH_INTERVAL_MS = 5000;
// We only need the count, never the rows — request the smallest page possible.
const COUNT_ONLY_LIMIT = 1;

/**
 * Reads the true number of matching records from a paginated response.
 *
 * The badge previously counted the returned page length, which is capped at the
 * request limit (defaulting to 50) — so a heavily-populated status could never
 * read above the page size. The authoritative count is `meta.pagination.total`.
 */
function totalFromPaginated(response: unknown): number {
  if (response && typeof response === "object") {
    const meta = (response as { meta?: { pagination?: { total?: unknown } } })
      .meta;
    const total = meta?.pagination?.total;
    if (typeof total === "number") {
      return total;
    }

    const data = (response as { data?: unknown }).data;
    if (Array.isArray(data)) {
      return data.length;
    }
  }
  return 0;
}

export function useActiveSessionCount(): number {
  const chatSessions = useQuery({
    queryKey: queryKeys.chatSessions.list({
      status: ACTIVE_CHAT_STATUSES,
      limit: COUNT_ONLY_LIMIT,
    }),
    queryFn: () =>
      api.getChatSessions({
        status: ACTIVE_CHAT_STATUSES,
        limit: COUNT_ONLY_LIMIT,
      }),
    refetchInterval: REFETCH_INTERVAL_MS,
  });

  const workflowRuns = useQuery({
    queryKey: queryKeys.workflowRuns.list({
      status: ACTIVE_WORKFLOW_STATUSES,
      limit: COUNT_ONLY_LIMIT,
    }),
    queryFn: () =>
      api.getWorkflowRuns({
        status: ACTIVE_WORKFLOW_STATUSES,
        limit: COUNT_ONLY_LIMIT,
      }),
    refetchInterval: REFETCH_INTERVAL_MS,
  });

  return (
    totalFromPaginated(chatSessions.data) +
    totalFromPaginated(workflowRuns.data)
  );
}
