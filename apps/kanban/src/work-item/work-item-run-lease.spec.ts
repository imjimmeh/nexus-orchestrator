import { beforeEach, describe, expect, it, vi } from "vitest";
import { LANE_CAPACITY } from "../orchestration/control-plane/lane-capacity.constants";
import { OrchestrationLeaseService } from "../orchestration/control-plane/orchestration-lease.service";
import type {
  AcquireLeaseInput,
  AcquireLeaseResult,
  LeaseConflict,
  OrchestrationConflictKey,
  OrchestrationLane,
  OrchestrationLeaseOwnerKind,
  OrchestrationLeaseStatus,
} from "../orchestration/control-plane/control-plane.types";
import { WORK_ITEM_RUN_LEASE_DEFAULT_TTL_MS } from "../orchestration/control-plane/control-plane.types";
import { WorkItemRunLeaseService } from "./work-item-run-lease";
import type { AcquireWorkItemRunLeaseServiceInput } from "./work-item-run-lease.types";

// ---------------------------------------------------------------------------
// In-memory lease record (mirrors KanbanOrchestrationLeaseEntity columns)
// Reused from orchestration-lease.integration.spec.ts so the contract
// stays honest — no mocks of the lease service, no mocks of the repository.
// ---------------------------------------------------------------------------
interface InMemoryLeaseRecord {
  id: string;
  project_id: string;
  conflict_key_kind: OrchestrationConflictKey["kind"];
  conflict_key_value: string;
  lane: OrchestrationLane;
  owner_kind: OrchestrationLeaseOwnerKind;
  owner_id: string;
  status: OrchestrationLeaseStatus;
  acquired_at: Date;
  heartbeat_at: Date;
  expires_at: Date;
  released_at: Date | null;
  metadata: Record<string, unknown> | null;
}

let nextLeaseSeq = 0;
function newLeaseId(): string {
  return `lease-${++nextLeaseSeq}`;
}

class InMemoryOrchestrationLeaseRepository {
  readonly store: InMemoryLeaseRecord[] = [];

  acquire(input: AcquireLeaseInput): Promise<AcquireLeaseResult> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.ttlMs);
    const keys = [...input.conflictKeys].sort((a, b) =>
      `${a.kind}:${a.value}`.localeCompare(`${b.kind}:${b.value}`),
    );

    this.reclaimExpired(input.projectId, keys, now);

    const conflictingRows = this.findActiveConflicts(input.projectId, keys);
    if (conflictingRows.length > 0) {
      const conflicts: LeaseConflict[] = conflictingRows.map((row) => ({
        conflictKey: {
          kind: row.conflict_key_kind,
          value: row.conflict_key_value,
        },
        heldByOwnerKind: row.owner_kind,
        heldByOwnerId: row.owner_id,
        expiresAt: row.expires_at.toISOString(),
      }));
      return Promise.resolve({ acquired: false, conflicts });
    }

    const leaseIds: string[] = [];
    for (const key of keys) {
      const record: InMemoryLeaseRecord = {
        id: newLeaseId(),
        project_id: input.projectId,
        conflict_key_kind: key.kind,
        conflict_key_value: key.value,
        lane: input.lane,
        owner_kind: input.owner.kind,
        owner_id: input.owner.id,
        status: "active",
        acquired_at: now,
        heartbeat_at: now,
        expires_at: expiresAt,
        released_at: null,
        metadata: input.metadata ?? null,
      };
      this.store.push(record);
      leaseIds.push(record.id);
    }

    return Promise.resolve({ acquired: true, leaseIds });
  }

  expireOverdue(now: Date): Promise<InMemoryLeaseRecord[]> {
    const overdue = this.store.filter(
      (r) => r.status === "active" && r.expires_at < now,
    );
    for (const record of overdue) {
      record.status = "expired";
    }
    return Promise.resolve(overdue);
  }

  listActiveByProject(projectId: string): Promise<InMemoryLeaseRecord[]> {
    return Promise.resolve(
      this.store.filter(
        (r) => r.project_id === projectId && r.status === "active",
      ),
    );
  }

  countActiveByLane(
    projectId: string,
    lane: OrchestrationLane,
  ): Promise<number> {
    return Promise.resolve(
      this.store.filter(
        (r) =>
          r.project_id === projectId &&
          r.lane === lane &&
          r.status === "active",
      ).length,
    );
  }

  listActiveByLane(
    projectId: string,
    lane: OrchestrationLane,
  ): Promise<InMemoryLeaseRecord[]> {
    return Promise.resolve(
      this.store.filter(
        (r) =>
          r.project_id === projectId &&
          r.lane === lane &&
          r.status === "active",
      ),
    );
  }

  release(leaseId: string, ownerId: string): Promise<boolean> {
    const record = this.store.find(
      (r) =>
        r.id === leaseId && r.owner_id === ownerId && r.status === "active",
    );
    if (!record) return Promise.resolve(false);
    record.status = "released";
    record.released_at = new Date();
    return Promise.resolve(true);
  }

  releaseAllForProject(projectId: string): Promise<number> {
    const active = this.store.filter(
      (r) => r.project_id === projectId && r.status === "active",
    );
    const now = new Date();
    for (const record of active) {
      record.status = "released";
      record.released_at = now;
    }
    return Promise.resolve(active.length);
  }

  heartbeat(leaseId: string, ttlMs: number): Promise<void> {
    const now = new Date();
    const record = this.store.find(
      (r) => r.id === leaseId && r.status === "active",
    );
    if (record) {
      record.heartbeat_at = now;
      record.expires_at = new Date(now.getTime() + ttlMs);
    }
    return Promise.resolve();
  }

  private reclaimExpired(
    projectId: string,
    keys: OrchestrationConflictKey[],
    now: Date,
  ): void {
    for (const key of keys) {
      for (const record of this.store) {
        if (
          record.project_id === projectId &&
          record.conflict_key_kind === key.kind &&
          record.conflict_key_value === key.value &&
          record.status === "active" &&
          record.expires_at < now
        ) {
          record.status = "expired";
        }
      }
    }
  }

  private findActiveConflicts(
    projectId: string,
    keys: OrchestrationConflictKey[],
  ): InMemoryLeaseRecord[] {
    const conflicts: InMemoryLeaseRecord[] = [];
    for (const key of keys) {
      const hit = this.store.find(
        (r) =>
          r.project_id === projectId &&
          r.conflict_key_kind === key.kind &&
          r.conflict_key_value === key.value &&
          r.status === "active",
      );
      if (hit) conflicts.push(hit);
    }
    return conflicts;
  }
}

// ---------------------------------------------------------------------------
// WorkItemRunLeaseService
// ---------------------------------------------------------------------------
describe("WorkItemRunLeaseService", () => {
  let leaseRepo: InMemoryOrchestrationLeaseRepository;
  let leaseService: OrchestrationLeaseService;
  let service: WorkItemRunLeaseService;

  beforeEach(() => {
    nextLeaseSeq = 0;
    leaseRepo = new InMemoryOrchestrationLeaseRepository();
    leaseService = new OrchestrationLeaseService(leaseRepo as never);
    service = new WorkItemRunLeaseService(leaseService);
  });

  it("(a) successful acquire returns acquired=true and forwards the expected conflict key + lane + owner kind", async () => {
    const result = await service.acquireRunLease({
      projectId: "p-1",
      workItemId: "wi-42",
      action: "dispatch",
      ownerId: "corr-1",
    });

    expect(result.acquired).toBe(true);
    if (!result.acquired) {
      throw new Error("expected acquire to succeed");
    }
    expect(result.leaseIds).toHaveLength(1);

    // Verify the lease row in the store matches the protocol contract.
    const active = await leaseRepo.listActiveByProject("p-1");
    expect(active).toHaveLength(1);
    const [record] = active;
    expect(record.conflict_key_kind).toBe("work_item");
    expect(record.conflict_key_value).toBe("work_item_dispatch:p-1:wi-42");
    expect(record.lane).toBe("dispatch");
    // The lease row is owned by the deterministic id, not the caller's
    // correlation id, so the release path can address it without
    // per-request state.
    expect(record.owner_kind).toBe("direct_mutation");
    expect(record.owner_id).toBe(
      "kanban:work-item-run:p-1:wi-42:dispatch",
    );
  });

  it("(b) concurrent acquire on the same (project_id, work_item_id) returns acquired=false with conflicts, without mutating state", async () => {
    const first = await service.acquireRunLease({
      projectId: "p-2",
      workItemId: "wi-9",
      action: "dispatch",
      ownerId: "corr-a",
    });
    expect(first.acquired).toBe(true);

    // Snapshot the active state before the second acquire so we can
    // assert "without mutating state" precisely.
    const before = await leaseRepo.listActiveByProject("p-2");
    expect(before).toHaveLength(1);

    const second = await service.acquireRunLease({
      projectId: "p-2",
      workItemId: "wi-9",
      action: "dispatch",
      ownerId: "corr-b",
    });

    expect(second.acquired).toBe(false);
    if (second.acquired) {
      throw new Error("expected second acquire to be denied");
    }
    expect(second.conflicts).toHaveLength(1);
    expect(second.conflicts[0].conflictKey).toEqual({
      kind: "work_item",
      value: "work_item_dispatch:p-2:wi-9",
    });
    expect(second.conflicts[0].heldByOwnerId).toBe(
      "kanban:work-item-run:p-2:wi-9:dispatch",
    );

    // The second acquire must not have created a new lease row.
    const after = await leaseRepo.listActiveByProject("p-2");
    expect(after).toHaveLength(1);
    expect(after[0].owner_id).toBe("kanban:work-item-run:p-2:wi-9:dispatch");
  });

  it("(b) two distinct actions on the same work item also conflict — the primitive serialises *all* actions on the same (project_id, work_item_id) tuple", async () => {
    // The conflict-key value is `work_item_dispatch:{project_id}:{work_item_id}`
    // — the action is encoded in the owner id, not the conflict key. This
    // is the F2 boundary (concurrent dispatch + review) per the work-item
    // README: both call shapes are denied so the second caller surfaces
    // ConflictException *before* invoking Core.
    const first = await service.acquireRunLease({
      projectId: "p-3",
      workItemId: "wi-9",
      action: "dispatch",
      ownerId: "corr-d",
    });
    expect(first.acquired).toBe(true);

    const second = await service.acquireRunLease({
      projectId: "p-3",
      workItemId: "wi-9",
      action: "review",
      ownerId: "corr-r",
    });
    expect(second.acquired).toBe(false);
    if (second.acquired) {
      throw new Error("expected second acquire to be denied");
    }
    expect(second.conflicts).toHaveLength(1);
    expect(second.conflicts[0].conflictKey).toEqual({
      kind: "work_item",
      value: "work_item_dispatch:p-3:wi-9",
    });
    // The holder is identified by the *dispatch*-derived owner id, not
    // the review caller's correlation id.
    expect(second.conflicts[0].heldByOwnerId).toBe(
      "kanban:work-item-run:p-3:wi-9:dispatch",
    );

    const active = await leaseRepo.listActiveByProject("p-3");
    expect(active).toHaveLength(1);
  });

  it("(c) releaseRunLease forwards to leaseService.releaseOwned for the derived owner id", async () => {
    const acquired = await service.acquireRunLease({
      projectId: "p-4",
      workItemId: "wi-7",
      action: "dispatch",
      ownerId: "corr-1",
    });
    expect(acquired.acquired).toBe(true);

    // Forwarding observable via the underlying service: we spy on
    // releaseOwned to confirm the wrapper passes projectId + derived id.
    const releaseSpy = vi.spyOn(leaseService, "releaseOwned");
    const derivedOwnerId = service.deriveOwnerId("p-4", "wi-7", "dispatch");
    await service.releaseRunLease("p-4", derivedOwnerId);

    expect(releaseSpy).toHaveBeenCalledWith("p-4", derivedOwnerId);

    // The lease row is no longer active.
    const active = await leaseRepo.listActiveByProject("p-4");
    expect(active).toHaveLength(0);
  });

  it("(c) releaseRunLease is a no-op when no lease exists for the owner id", async () => {
    const releaseSpy = vi.spyOn(leaseService, "releaseOwned");
    await service.releaseRunLease("p-empty", "kanban:work-item-run:p-empty:wi-1:dispatch");
    expect(releaseSpy).toHaveBeenCalledWith(
      "p-empty",
      "kanban:work-item-run:p-empty:wi-1:dispatch",
    );
    // The store is still empty — releaseOwned is allowed to be a no-op.
    const active = await leaseRepo.listActiveByProject("p-empty");
    expect(active).toHaveLength(0);
  });

  it("(d) acquireRunLease derives a deterministic owner id kanban:work-item-run:{project_id}:{work_item_id}:{action}", async () => {
    const spy = vi.spyOn(leaseService, "acquireMutationLeases");
    await service.acquireRunLease({
      projectId: "p-5",
      workItemId: "wi-3",
      action: "merge",
      ownerId: "corr-merge-1",
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const [call] = spy.mock.calls[0];
    expect(call.ownerId).toBe("kanban:work-item-run:p-5:wi-3:merge");
    expect(call.lane).toBe("dispatch");
    expect(call.conflictKeys).toEqual([
      { kind: "work_item", value: "work_item_dispatch:p-5:wi-3" },
    ]);
  });

  it("(d) deriveOwnerId is deterministic and shape-stable across calls", () => {
    // Pure function: same inputs ⇒ same output, no side effects.
    const a = service.deriveOwnerId("p-x", "wi-y", "dispatch");
    const b = service.deriveOwnerId("p-x", "wi-y", "dispatch");
    expect(a).toBe(b);
    expect(a).toBe("kanban:work-item-run:p-x:wi-y:dispatch");

    // Different action ⇒ different owner id (the protocol requires
    // distinct ids so that, when the conflict key is widened in a later
    // milestone, dispatch and review can coexist as separate leases).
    const review = service.deriveOwnerId("p-x", "wi-y", "review");
    expect(review).not.toBe(a);
  });

  it("uses the documented default TTL when the caller omits ttlMs", async () => {
    const spy = vi.spyOn(leaseService, "acquireMutationLeases");
    await service.acquireRunLease({
      projectId: "p-6",
      workItemId: "wi-1",
      action: "dispatch",
      ownerId: "corr-1",
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const [call] = spy.mock.calls[0];
    expect(call.ttlMs).toBe(WORK_ITEM_RUN_LEASE_DEFAULT_TTL_MS);
    expect(call.laneCapacity).toBe(LANE_CAPACITY.dispatch);
  });

  it("forwards a caller-supplied ttlMs verbatim", async () => {
    const spy = vi.spyOn(leaseService, "acquireMutationLeases");
    await service.acquireRunLease({
      projectId: "p-7",
      workItemId: "wi-1",
      action: "dispatch",
      ownerId: "corr-1",
      ttlMs: 5_000,
    });

    const [call] = spy.mock.calls[0];
    expect(call.ttlMs).toBe(5_000);
  });
});
