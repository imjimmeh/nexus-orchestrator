import { Injectable } from "@nestjs/common";
import { LANE_CAPACITY } from "../orchestration/control-plane/lane-capacity.constants";
import { OrchestrationLeaseService } from "../orchestration/control-plane/orchestration-lease.service";
import {
  WORK_ITEM_RUN_LEASE_DEFAULT_TTL_MS,
  type AcquireLeaseResult,
  type OrchestrationConflictKey,
  type OrchestrationLane,
} from "../orchestration/control-plane/control-plane.types";
import type { AcquireWorkItemRunLeaseServiceInput } from "./work-item-run-lease.types";

/**
 * The per-work-item orchestration lease used by
 * `WorkItemService.requestWorkItemRun` to serialize concurrent writers
 * (dispatch / review / merge / lifecycle projection / dispatch cycle) on
 * the same work-item link columns. See
 * `docs/architecture/ADR-20260623-work-item-run-link-lease.md` for the
 * protocol contract.
 *
 * The wrapper is intentionally stateless and the only Nest-injected
 * dependency is `OrchestrationLeaseService`, so unit tests can inject a
 * fake `OrchestrationLeaseService` and verify the contract without a
 * Postgres-backed lease repository.
 */
@Injectable()
export class WorkItemRunLeaseService {
  static readonly OWNER_ID_PREFIX = "kanban:work-item-run";
  static readonly CONFLICT_KEY_KIND: OrchestrationConflictKey["kind"] =
    "work_item";
  static readonly CONFLICT_KEY_PREFIX = "work_item_dispatch:";
  static readonly LANE: OrchestrationLane = "dispatch";

  constructor(
    private readonly leaseService: OrchestrationLeaseService,
  ) {}

  /**
   * Derive the deterministic owner id used for both the lease row and the
   * release path. The format is intentionally collision-free across
   * `(projectId, workItemId, action)` tuples so that two concurrent
   * writers on the same work item are guaranteed to use the same owner
   * id, which is what lets `releaseRunLease` release by id without
   * tracking any per-request state.
   */
  deriveOwnerId(
    projectId: string,
    workItemId: string,
    action: string,
  ): string {
    return `${WorkItemRunLeaseService.OWNER_ID_PREFIX}:${projectId}:${workItemId}:${action}`;
  }

  /**
   * Build the conflict key for a given `(projectId, workItemId)`. The
   * `work_item_dispatch:` prefix is stable so future work-item lease
   * variants (review / merge / repair) can compose with this primitive
   * without colliding on the unique partial index
   * `uq_kanban_orchestration_leases_active_key`.
   */
  buildConflictKey(
    projectId: string,
    workItemId: string,
  ): OrchestrationConflictKey {
    return {
      kind: WorkItemRunLeaseService.CONFLICT_KEY_KIND,
      value: `${WorkItemRunLeaseService.CONFLICT_KEY_PREFIX}${projectId}:${workItemId}`,
    };
  }

  /**
   * Acquire the per-work-item orchestration lease. Returns the
   * `AcquireLeaseResult` discriminated union from
   * `OrchestrationLeaseService.acquireMutationLeases` verbatim so the
   * caller can surface a deterministic `ConflictException` *before*
   * invoking Core when the lease is already held.
   *
   * The `ownerId` input parameter is the caller's correlation/request id
   * and is preserved on the lease metadata for operator-visible tracing;
   * the lease's `owner_id` column is the deterministic id derived from
   * `(projectId, workItemId, action)` so concurrent writers on the same
   * tuple share the same id and the release path is straightforward.
   */
  async acquireRunLease(
    input: AcquireWorkItemRunLeaseServiceInput,
  ): Promise<AcquireLeaseResult> {
    const derivedOwnerId = this.deriveOwnerId(
      input.projectId,
      input.workItemId,
      input.action,
    );
    return this.leaseService.acquireMutationLeases({
      projectId: input.projectId,
      lane: WorkItemRunLeaseService.LANE,
      ownerId: derivedOwnerId,
      conflictKeys: [this.buildConflictKey(input.projectId, input.workItemId)],
      laneCapacity: LANE_CAPACITY[WorkItemRunLeaseService.LANE],
      ttlMs: input.ttlMs ?? WORK_ITEM_RUN_LEASE_DEFAULT_TTL_MS,
    });
  }

  /**
   * Release every active lease owned by `ownerId` for the given project.
   * The `ownerId` is the deterministic id returned by `deriveOwnerId`
   * (or, equivalently, the id the caller previously passed as
   * `acquireRunLease`'s implicit lease owner — see the docstring on
   * `acquireRunLease`).
   */
  async releaseRunLease(projectId: string, ownerId: string): Promise<void> {
    await this.leaseService.releaseOwned(projectId, ownerId);
  }
}
