export type PermissionAction =
  | 'read'
  | 'create'
  | 'update'
  | 'delete'
  | 'manage';

export type PermissionResource =
  | 'scopes'
  | 'resources'
  | 'workflows'
  | 'agents'
  | 'skills'
  | 'approvals'
  | 'goals'
  | 'memory'
  | 'secrets'
  | 'budgets'
  | 'roles'
  | 'users'
  | 'settings'
  | 'gitops'
  | 'audit'
  | 'improvements';

export interface PermissionDefinition {
  name: string;
  resource: PermissionResource;
  action: PermissionAction;
}
