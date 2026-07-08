// apps/web/src/hooks/useAuditLog.ts
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import type { AuditLogFilters } from "@/lib/api/client.audit.types";

export function useAuditLog(filters: AuditLogFilters = {}) {
  return useQuery({
    queryKey: queryKeys.audit.log(filters as Record<string, unknown>),
    queryFn: () => api.getAuditLog(filters),
    staleTime: 15_000,
  });
}
