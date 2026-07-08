export type AuthzEventType =
  | 'authz.denied'
  | 'authz.role_granted'
  | 'authz.role_revoked'
  | 'authz.scope_created'
  | 'authz.scope_moved'
  | 'authz.scope_deleted';
