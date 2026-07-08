/** Roles granted to internal service-to-service JWT tokens. */
export const SERVICE_JWT_ROLES = ['Admin', 'Developer'] as const;

/** Scopes granted to internal service-to-service JWT tokens for workflow operations. */
export const SERVICE_JWT_SCOPES = [
  'core.workflow-runs:read',
  'core.workflow-runs:write',
  'core.telegram-settings:read',
] as const;
