/**
 * `MemoryQueryPlanner` — pure routing module for the
 * `MemoryManagerService` read path.
 *
 * This module extracts the four-cell (entityId × query) routing
 * decision tree that used to live inline in
 * `MemoryListingService.loadSegments` so the matrix has exactly one
 * definition in the codebase. The planner is intentionally a
 * PURE FUNCTION module — no `@Injectable()` decorator, no DI token,
 * no module-level mutable state, no IO. Consumers import `plan`
 * (and the optional Honcho-routing helper) directly.
 *
 * ─── The four-branch matrix ──────────────────────────────────────
 *
 * Given a `PlannerParams` input, the planner returns a `PlannedCall`
 * whose `method` and `args` map to one of the four `MemoryManagerService`
 * read methods. The matrix below is the single source of truth — the
 * tests in `memory-query-planner.spec.ts` assert each cell verbatim.
 *
 * ┌─────────────────┬──────────────────┬───────────────────────────┐
 * │ entityId        │ query (trim)     │ → method / args           │
 * ├─────────────────┼──────────────────┼───────────────────────────┤
 * │ present         │ non-empty        │ searchMemory              │
 * │                 │                  │   (entityType, entityId,  │
 * │                 │                  │    query)                 │
 * │ present         │ empty / null /   │ getMemorySegments         │
 * │                 │ undefined        │   (entityType, entityId,  │
 * │                 │                  │    { memory_type })       │
 * │ absent          │ non-empty        │ searchMemoryByType        │
 * │                 │                  │   (entityType, query,     │
 * │                 │                  │    { memory_type })       │
 * │ absent          │ empty / null /   │ getMemorySegmentsByType   │
 * │                 │ undefined        │   (entityType,            │
 * │                 │                  │    { memory_type })       │
 * └─────────────────┴──────────────────┴───────────────────────────┘
 *
 * "query (trim)" means: the planner treats `null`, `undefined`, the
 * empty string, and any string that is empty after `.trim()` as
 * "no query" — they all route to the no-query branches above.
 *
 * "query" is trimmed BEFORE being forwarded to the backend so the
 * postgres full-text-search backend never receives a whitespace-only
 * `query` (which it would reject with a thrown error). The trim is
 * the planner's contract, not the caller's — callers can pass
 * `'  foo  '` and the planner forwards `'foo'`.
 *
 * ─── Out-of-scope decision trees ─────────────────────────────────
 *
 * - `MemoryManagerService.upsertMemorySegment` is the write-path
 *   decision tree (insert-or-replace the singleton
 *   `strategic_intent` segment for a scope). It is NOT part of this
 *   planner and is intentionally left untouched by this refactor.
 *   The read/write split is the planner's defining boundary.
 * - `ChatMemoryAdminService.listSegments` is the admin-tooling read
 *   path. It uses a different parameter shape (page, scope filters)
 *   and a different caller contract; this refactor deliberately
 *   leaves it alone so the planner's responsibility stays narrow.
 * - `HonchoFallbackMemoryBackendService` is the explicit
 *   "honcho → postgres" fallback backend. It composes the entity-
 *   bound methods on the `postgres` and `honcho` backends and is
 *   reached when `honcho` errors or returns empty. The planner does
 *   not know about it; the caller's service composition decides
 *   when to fall back.
 *
 * ─── Drift D8 invariant for `HonchoMemoryBackendService` ─────────
 *
 * The Honcho backend (`HonchoMemoryBackendService`) has two read
 * shapes that the planner routes between, and the
 * `BackendInstrumentation.recordFallback` attribution policy
 * differs by shape:
 *
 *   - **Entity-bound methods** (`searchMemory`, `getMemorySegments`):
 *     the inner method wraps its Honcho call in
 *     `BackendInstrumentation.recordRead`, which observes the
 *     Honcho read latency. The outer `recordFallback` only fires
 *     when the inner method itself decided to fall back (empty
 *     results or thrown error). For this path the planner routes
 *     to the entity-bound method directly and the caller MUST NOT
 *     wrap the call in an additional `recordFallback` — the inner
 *     method is the sole authority on attribution.
 *
 *   - **ByType methods** (`searchMemoryByType`,
 *     `getMemorySegmentsByType`): the inner method
 *     unconditionally falls back to postgres WITHOUT making a
 *     Honcho attempt (Honcho does not support cross-entity-id
 *     search). The outer `recordFallback` is the only attribution
 *     point — without it the Honcho→Postgres routing would be
 *     invisible to the fallback counter. For this path the caller
 *     MUST wrap the call in `recordFallback` so the
 *     `from: 'honcho'`, `to: 'postgres'` counter increments.
 *
 * `planHonchoRouting` encodes the second rule: it returns
 * `PlannedCall` for the entity-bound branches (so the caller does
 * NOT add an outer `recordFallback`) and `null` for the byType
 * branches (so the caller can detect "no Honcho path" and add the
 * outer `recordFallback` itself). This is the documented D8
 * invariant — see the `HonchoMemoryBackendService` `getMemorySegmentsByType`
 * JSDoc for the same explanation in the destination code.
 *
 * ─── Relationship to `BackendOperation` ──────────────────────────
 *
 * The `MemoryReadMethod` union (defined in
 * `memory-query-planner.types.ts`) is a strict subset of
 * `BackendOperation` (from `backend-instrumentation.types.ts`):
 * the planner never returns the write-path operations
 * (`createMemorySegment`, `updateMemorySegment`,
 * `deleteMemorySegment`). The two unions are kept in sync
 * visually by re-stating the four method names verbatim in
 * `MemoryReadMethod`; a future migration could collapse them
 * to `Extract<BackendOperation, …>` once the type system has a
 * shared `MemoryReadOperation` alias.
 */

import type {
  MemoryReadMethod,
  PlannerParams,
  PlannedCall,
} from './memory-query-planner.types';

/**
 * Sentinel exported for the Honcho "no path" case.
 *
 * `planHonchoRouting` returns this value (typed as `null` with the
 * precise `PlannedCall | null` union) when the planner would route
 * to a `*ByType` method — Honcho does not support cross-entity
 * search, so the Honcho backend has no path to attempt and the
 * outer `BackendInstrumentation.recordFallback` wrapper is the only
 * attribution point. Callers can compare against the exported
 * constant for grep-ability:
 *
 * ```ts
 * const planned = planHonchoRouting(params);
 * if (planned === PLANNER_NO_HONCHO_PATH) {
 *   return instrumentation.recordFallback(
 *     { from: 'honcho', to: 'postgres', operation: '...' },
 *     () => memoryManager[fallbackMethod](...),
 *   );
 * }
 * ```
 *
 * The sentinel is also useful for the type-narrowing return type
 * of `planHonchoRouting` — see the function's signature below.
 */
export const PLANNER_NO_HONCHO_PATH: null = null;

/**
 * The shape of the `args` tuple for the byType methods. Documented
 * in this JSDoc rather than encoded as a TypeScript alias because
 * the published `PlannedCall.args` field is typed as
 * `readonly unknown[]` (see `memory-query-planner.types.ts`); the
 * per-method tuple is a runtime contract between this module and
 * the corresponding `MemoryManagerService` method.
 *
 * The tuple's second element is always an object literal with a
 * single `memory_type` key (which may hold `undefined` when the
 * caller did not pass a `memoryType` filter) so the backend's
 * "no filter" branch stays a single, well-tested code path —
 * matching the legacy matrix's `{ memory_type: undefined }`
 * semantics that `MemoryListingService.loadSegments` already
 * exercises.
 */

/**
 * Pure routing function. Returns a `PlannedCall` whose `args` tuple
 * matches the exact positional signature of the corresponding
 * `MemoryManagerService` method.
 *
 * Side-effect-free. The function allocates two objects per call
 * (the `PlannedCall` envelope and the `{ memory_type }` filter)
 * and otherwise performs no IO, no mutation, and no logging.
 */
export function plan(params: PlannerParams): PlannedCall {
  const { entityType, entityId, memoryType } = params;
  const trimmedQuery = normalizeQuery(params.query);
  const hasEntityId = typeof entityId === 'string' && entityId.length > 0;
  const hasQuery = trimmedQuery.length > 0;

  if (hasEntityId && hasQuery) {
    return {
      method: 'searchMemory',
      args: [entityType, entityId, trimmedQuery],
    };
  }

  if (hasEntityId && !hasQuery) {
    return {
      method: 'getMemorySegments',
      args: [entityType, entityId, { memory_type: memoryType }],
    };
  }

  if (!hasEntityId && hasQuery) {
    return {
      method: 'searchMemoryByType',
      args: [entityType, trimmedQuery, { memory_type: memoryType }],
    };
  }

  return {
    method: 'getMemorySegmentsByType',
    args: [entityType, { memory_type: memoryType }],
  };
}

/**
 * Honcho-aware routing helper.
 *
 * Returns the same `PlannedCall` as {@link plan} for the
 * entity-bound branches (`searchMemory`, `getMemorySegments`) and
 * `PLANNER_NO_HONCHO_PATH` (i.e. `null`) for the byType branches.
 *
 * The contract — see the top-of-file JSDoc for the full Drift D8
 * invariant — is that when this function returns `null` the caller
 * is responsible for wrapping the subsequent memory-manager call in
 * `BackendInstrumentation.recordFallback` because Honcho cannot
 * attempt the operation and the fallback counter is the only
 * attribution point.
 *
 * Side-effect-free. Pure function of `params`; no IO, no mutation.
 */
export function planHonchoRouting(params: PlannerParams): PlannedCall | null {
  const planned = plan(params);
  if (isByTypeMethod(planned.method)) {
    return PLANNER_NO_HONCHO_PATH;
  }
  return planned;
}

/**
 * Treat `null`, `undefined`, and any string that is empty after
 * `.trim()` as "no query" — the no-query branches of the matrix.
 *
 * Returns the trimmed query for the caller to forward to the
 * backend unchanged (so `'  foo  '` arrives as `'foo'`).
 */
function normalizeQuery(query: PlannerParams['query']): string {
  if (typeof query !== 'string') {
    return '';
  }
  return query.trim();
}

/**
 * Narrow a `MemoryReadMethod` to the two byType variants. Used by
 * {@link planHonchoRouting} to detect the Drift D8 "no Honcho path"
 * case — see the top-of-file JSDoc.
 */
function isByTypeMethod(
  method: MemoryReadMethod,
): method is 'searchMemoryByType' | 'getMemorySegmentsByType' {
  return (
    method === 'searchMemoryByType' || method === 'getMemorySegmentsByType'
  );
}
