export function resolveScopeIdFromRun(run: unknown): string | null {
  if (!run || typeof run !== 'object') {
    return null;
  }

  const state = (run as { state_variables?: unknown }).state_variables;
  if (!state || typeof state !== 'object') {
    return null;
  }

  const trigger = (state as { trigger?: unknown }).trigger;
  if (!trigger || typeof trigger !== 'object') {
    return null;
  }

  const scopeId = (trigger as { scopeId?: unknown }).scopeId;
  return typeof scopeId === 'string' && scopeId.trim().length > 0
    ? scopeId
    : null;
}

/**
 * Resolves scopeId from either a direct value (e.g. chat session JWT) or
 * by looking up the workflow run's state_variables. Callers should prefer
 * passing `scopeId` when available to avoid unnecessary DB lookups.
 */
export async function resolveScopeIdFromContext(params: {
  scopeId?: string;
  workflowRunId?: string;
  workflowRunRepo?: { findById: (id: string) => Promise<unknown> };
}): Promise<string | null> {
  if (params.scopeId) {
    return params.scopeId;
  }
  if (!params.workflowRunId || !params.workflowRunRepo) {
    return null;
  }
  const run = await params.workflowRunRepo.findById(params.workflowRunId);
  return resolveScopeIdFromRun(run);
}
