export const AUTHZ_EVENT_TYPES = {
  DENIED: 'authz.denied',
  ROLE_GRANTED: 'authz.role_granted',
  ROLE_REVOKED: 'authz.role_revoked',
  SCOPE_CREATED: 'authz.scope_created',
  SCOPE_MOVED: 'authz.scope_moved',
  SCOPE_DELETED: 'authz.scope_deleted',
  SCOPE_UPDATED: 'authz.scope_updated',
  SCOPE_ARCHIVED: 'authz.scope_archived',
  SCOPE_RESTORED: 'authz.scope_restored',
} as const;
