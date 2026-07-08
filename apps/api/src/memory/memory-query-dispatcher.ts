/**
 * `MemoryQueryDispatcher` — thin execution layer over
 * {@link MemoryQueryPlanner}.
 *
 * The planner (`memory-query-planner.ts`) is a pure routing module —
 * it returns a `PlannedCall` envelope but performs no IO. This module
 * is the execution boundary: it consumes the planner envelope,
 * narrows on `planned.method`, and forwards the planner-supplied
 * `args` tuple to the matching `MemoryManagerService` read method.
 *
 * Why this lives in its own file
 * ──────────────────────────────
 *
 * The four-branch dispatch over `MemoryManagerService` read methods
 * has exactly one definition in the codebase — the inline-ternary
 * shape previously embedded in handler and listing call sites is
 * fully replaced by a single call to {@link loadMemorySegmentsByPlanner}.
 * Concentrating the switch here (instead of duplicating it per caller)
 * keeps the `never`-typed exhaustiveness check in one place: any
 * future addition to `MemoryReadMethod` is caught by the type-checker
 * at this single site rather than scattered across the handler and
 * the listing service.
 *
 * Relationship to `MemoryQueryPlanner` and the call sites
 * ────────────────────────────────────────────────────────
 *
 * The dispatcher's only inputs are a {@link MemoryManagerService}
 * (for execution) and a {@link PlannerParams} (for routing). Callers
 * do not need to import `plan` or `PlannedCall` themselves; the
 * envelope is constructed and consumed inside this module.
 *
 *   handler  → loadMemorySegmentsByPlanner(manager, params)
 *   listing  → (re-uses planner directly; out of scope for M4)
 *
 * The `default:` branch is unreachable today (`MemoryReadMethod`
 * is a closed literal union) but the `never`-typed assertion
 * enforces exhaustiveness if the union grows.
 *
 * Drift D8 note: the call sites for this module MUST NOT wrap the
 * dispatch in a `BackendInstrumentation.recordFallback` for the
 * entity-bound branches (`searchMemory`, `getMemorySegments`),
 * because the inner Honcho method already records fallback
 * attribution. For the byType branches (`searchMemoryByType`,
 * `getMemorySegmentsByType`) the inner method does not attempt a
 * Honcho call (Honcho does not support cross-entity search), so the
 * outer attribution wrapper is the only counter-increment path.
 * See `memory-query-planner.ts` and `HonchoMemoryBackendService`
 * for the full D8 invariant.
 */

import type { IMemorySegment } from '@nexus/core';
import { MemoryManagerService } from './memory-manager.service';
import { plan } from './memory-query-planner';
import type { PlannerParams } from './memory-query-planner.types';

/**
 * Resolve a {@link PlannerParams} envelope to the matching
 * `MemoryManagerService` read call and return its segment list.
 *
 * Side-effect-free beyond the awaited memory-manager call. Pure
 * with respect to `params`; the `memoryManager` argument is the
 * only mutable collaborator.
 */
export async function loadMemorySegmentsByPlanner(
  memoryManager: MemoryManagerService,
  params: PlannerParams,
): Promise<IMemorySegment[]> {
  const planned = plan(params);
  switch (planned.method) {
    case 'searchMemory':
      return memoryManager.searchMemory(
        ...(planned.args as Parameters<MemoryManagerService['searchMemory']>),
      );
    case 'getMemorySegments':
      return memoryManager.getMemorySegments(
        ...(planned.args as Parameters<
          MemoryManagerService['getMemorySegments']
        >),
      );
    case 'searchMemoryByType':
      return memoryManager.searchMemoryByType(
        ...(planned.args as Parameters<
          MemoryManagerService['searchMemoryByType']
        >),
      );
    case 'getMemorySegmentsByType':
      return memoryManager.getMemorySegmentsByType(
        ...(planned.args as Parameters<
          MemoryManagerService['getMemorySegmentsByType']
        >),
      );
    default: {
      const exhaustive: never = planned.method;
      throw new Error(`Unhandled planner method: ${String(exhaustive)}`);
    }
  }
}
