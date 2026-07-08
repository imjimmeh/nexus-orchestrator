import type { MemoryType } from './memory-backend.types';

/**
 * Type contracts for the {@link MemoryQueryPlanner} module.
 *
 * The planner is a pure function (no DI, no side effects) extracted
 * from `MemoryListingService.loadSegments` so the four-cell
 * (entityId × query) routing matrix has exactly one definition in the
 * codebase. See `memory-query-planner.ts` for the routing rules and
 * the Drift D8 invariant that ties the planner to
 * `HonchoMemoryBackendService`.
 *
 * The `.types.ts` filename is required by the project's lint policy
 * (`apps/api/eslint.config.mjs`, lines 78–87) — exported interfaces
 * and type aliases must live in `*.types.ts` files so the public
 * surface stays statically analysable.
 */

/**
 * The `entityType` argument passed to every `MemoryManagerService`
 * read method.
 *
 * Typed as `string` (NOT a closed literal union) to match the
 * `MemoryManagerService` and `MemoryListingService` signatures, which
 * intentionally accept any string. The canonical runtime guard lives
 * in the Zod schema
 * `memoryEntityTypeSchema` exported from `@nexus/core`
 * (`packages/core/src/schemas/workflow-runtime/workflow-runtime-inputs.schemas.ts`),
 * which combines the `["User", "Project", "System"]` enum with the
 * `learningScopeTypeSchema` (regex-validated lowercase scope
 * identifier). The planner treats `entityType` as opaque — schema
 * validation is the caller's responsibility, just like the legacy
 * matrix it replaces.
 */
export type EntityType = string;

/**
 * Input parameters for {@link plan}.
 *
 * Mirrors the four `MemoryListingService.loadSegments` branches:
 *   - `entityType` is required (every read path is entity-scoped).
 *   - `entityId` is optional — when absent, the planner routes to
 *     the `*ByType` matrix of methods that span all `entity_id`s for
 *     the given `entityType`.
 *   - `query` is optional and intentionally typed as
 *     `string | null | undefined` so callers can forward a
 *     `ZodEffects`-parsed `query` (which can be `string` or
 *     `undefined`) as well as a pre-existing `null` (e.g. from a
 *     tool input that disambiguates "no query" from "missing key").
 *     `null` and `undefined` are treated identically by the planner
 *     (both route to the no-query branches).
 *   - `memoryType` is optional. When supplied, the planner threads it
 *     into the `{ memory_type: memoryType }` filter object that the
 *     `MemoryManagerService` reads already accept on the no-search
 *     branches. When absent, the filter object is still passed (with
 *     `memory_type: undefined`) so the backend's "no filter" branch
 *     remains a single, well-tested code path.
 */
export interface PlannerParams {
  entityType: EntityType;
  entityId?: string | undefined;
  query?: string | null | undefined;
  memoryType?: MemoryType | undefined;
}

/**
 * The four read-method names on `MemoryManagerService` that the
 * planner can route to.
 *
 * This is a strict subset of {@link BackendOperation} (from
 * `backend-instrumentation.types.ts`); the planner never returns the
 * write-path operations (`createMemorySegment`, `updateMemorySegment`,
 * `deleteMemorySegment`) because writes have their own decision tree
 * (`MemoryManagerService.upsertMemorySegment`) that is out of scope
 * for this refactor. Declared locally rather than via
 * `Extract<BackendOperation, …>` to keep the planner module
 * self-contained and to make the four-cell matrix visually explicit
 * at the call site.
 */
export type MemoryReadMethod =
  | 'searchMemory'
  | 'getMemorySegments'
  | 'searchMemoryByType'
  | 'getMemorySegmentsByType';

/**
 * A planned call into {@link MemoryManagerService}.
 *
 * The `args` tuple is `readonly unknown[]` (rather than a per-method
 * discriminated union) because:
 *   1. The tuple shape is fully determined by `method` — a
 *      discriminated union would be redundant and would force every
 *      consumer to add the same per-method case to its dispatch.
 *   2. The legacy matrix in `MemoryListingService.loadSegments`
 *      never inspected the args past the point of forwarding them
 *      positionally; the planner preserves that property.
 *   3. The `readonly` modifier prevents callers from mutating the
 *      tuple in place (defensive — the planner always returns fresh
 *      tuples per call).
 *
 * The exact positional signature per `method` is documented in
 * `memory-query-planner.ts` and matches
 * `MemoryManagerService.{searchMemory, getMemorySegments,
 * searchMemoryByType, getMemorySegmentsByType}` verbatim.
 */
export interface PlannedCall {
  method: MemoryReadMethod;
  args: readonly unknown[];
}
