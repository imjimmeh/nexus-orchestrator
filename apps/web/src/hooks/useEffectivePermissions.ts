// apps/web/src/hooks/useEffectivePermissions.ts
import { useMyPermissions } from "@/hooks/useMyPermissions";
import { useScopeContext } from "@/context/ScopeContext";

/**
 * Thin wrapper around `useMyPermissions` that defaults to the ACTIVE scope
 * node (from `ScopeContext`) when no `scopeNodeId` is supplied. Exists so
 * two-plane nav filtering (Phase 5) doesn't need to read `useScopeContext`
 * itself at every call site. All permission evaluation — including the
 * `<resource>:manage` wildcard — is delegated to `useMyPermissions`; no
 * logic is duplicated here.
 */
export function useEffectivePermissions(scopeNodeId?: string): {
  permissions: string[];
  can: (permission: string) => boolean;
  isLoading: boolean;
} {
  const { activeScopeNodeId } = useScopeContext();
  return useMyPermissions(scopeNodeId ?? activeScopeNodeId);
}
