/**
 * Outcome of resolving a `remember` tool `scope` value to a concrete entity
 * id (Epic C). `ok: false` means the scope could not be resolved from run
 * context (e.g. `scope: 'agent'` with no `agentProfileName` on the context)
 * — callers must refuse the write rather than silently falling back to a
 * global memory.
 */
export type RememberScopeResolution =
  | { ok: true; scopeId: string | null }
  | { ok: false };
