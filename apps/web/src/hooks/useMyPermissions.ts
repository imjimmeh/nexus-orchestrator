// apps/web/src/hooks/useMyPermissions.ts
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";

const MANAGE_ACTION = "manage";

/**
 * Returns true when `permissions` grants `permission`, either directly or via
 * the `<resource>:manage` wildcard (e.g. `scopes:manage` implies `scopes:create`).
 * Mirrors `AuthorizationService.can()` in apps/api/src/auth/authorization.
 */
function evaluateCan(
  permissions: readonly string[],
  permission: string,
): boolean {
  if (permissions.includes(permission)) return true;
  const [resource] = permission.split(":");
  return permissions.includes(`${resource}:${MANAGE_ACTION}`);
}

/**
 * Fetches the current user's effective permissions at a scope node and
 * exposes a `can()` helper honouring the `<resource>:manage` wildcard.
 * Reused across Phase 4 (org hierarchy) and Phase 5.
 */
export function useMyPermissions(scopeNodeId: string): {
  permissions: string[];
  can: (permission: string) => boolean;
  isLoading: boolean;
} {
  const enabled = scopeNodeId.length > 0;

  const query = useQuery({
    queryKey: queryKeys.authz.myPermissions(scopeNodeId),
    queryFn: () => api.getMyPermissions(scopeNodeId),
    enabled,
    staleTime: 60_000,
  });

  const permissions = useMemo(
    () => query.data?.permissions ?? [],
    [query.data],
  );

  const can = useMemo(
    () => (permission: string) => evaluateCan(permissions, permission),
    [permissions],
  );

  return {
    permissions,
    can,
    isLoading: enabled ? query.isLoading : false,
  };
}
