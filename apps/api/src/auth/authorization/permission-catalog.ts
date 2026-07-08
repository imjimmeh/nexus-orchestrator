import type {
  PermissionAction,
  PermissionResource,
  PermissionDefinition,
} from './permission-catalog.types';

export type {
  PermissionAction,
  PermissionResource,
  PermissionDefinition,
} from './permission-catalog.types';

export const ACTIONS = [
  'read',
  'create',
  'update',
  'delete',
  'manage',
] as const;

export const RESOURCES = [
  'scopes',
  'resources',
  'workflows',
  'agents',
  'skills',
  'approvals',
  'goals',
  'memory',
  'secrets',
  'budgets',
  'roles',
  'users',
  'settings',
  'gitops',
  'audit',
  'improvements',
] as const;

export function permissionName(
  resource: PermissionResource,
  action: PermissionAction,
): string {
  return `${resource}:${action}`;
}

export const PERMISSION_CATALOG: PermissionDefinition[] = RESOURCES.flatMap(
  (resource) =>
    ACTIONS.map((action) => ({
      name: permissionName(resource, action),
      resource,
      action,
    })),
);

export const MEMBER_ADMIN_ROLE_NAME = 'member_admin' as const;

export function resourceAdminRoleName(resource: PermissionResource): string {
  return `${resource}_admin`;
}

export const RESOURCE_ADMIN_ROLE_NAMES: readonly string[] = RESOURCES.map(
  (resource) => resourceAdminRoleName(resource),
);
