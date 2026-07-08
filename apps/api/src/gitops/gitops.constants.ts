export const GITOPS_MANAGED_BY = 'gitops' as const;

export const RECONCILE_OBJECT_TYPES = [
  'scope_node',
  'role',
  'role_assignment',
  'workflow',
  'agent_profile',
  'skill',
  'config_override',
] as const;

// The order encodes the dependency: a node must exist before any role/assignment binds to it,
// and overrides bind last. Deletes are applied in reverse to respect FK constraints.
export const RECONCILE_ORDER: readonly string[] = [...RECONCILE_OBJECT_TYPES];

export function isReconcileObjectType(
  value: string,
): value is (typeof RECONCILE_OBJECT_TYPES)[number] {
  return (RECONCILE_OBJECT_TYPES as readonly string[]).includes(value);
}

/** Builds the composite identity used across desired/actual/diff engine: `type::key`.
 *  BOTH sides of the reconciler must use this helper to avoid silent format drift. */
export function reconcileKey(type: string, key: string): string {
  return `${type}::${key}`;
}

export const DESIRED_STATE_WORKSPACE_SUBPATH = '/gitops/desired-state';

export const GITOPS_CONFIG = Symbol('GITOPS_CONFIG');
