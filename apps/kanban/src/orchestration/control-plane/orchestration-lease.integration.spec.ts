import { describe, expect, it, beforeEach } from "vitest";
import {
  OrchestrationLeaseService,
  CYCLE_LEASE_TTL_MS,
} from "./orchestration-lease.service";
import type {
  AcquireLeaseInput,
  AcquireLeaseResult,
  LeaseConflict,
  OrchestrationConflictKey,
  OrchestrationLane,
  OrchestrationLeaseOwnerKind,
  OrchestrationLeaseStatus,
} from "./control-plane.types";

// ---------------------------------------------------------------------------
// In-memory lease record (mirrors KanbanOrchestrationLeaseEntity columns)
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

// ---------------------------------------------------------------------------
// InMemoryOrchestrationLeaseRepository
//
// Faithfully reimplements the TypeORM-backed KanbanOrchestrationLeaseRepository
// using a plain array so tests never need a real Postgres.  The critical piece
// is that acquire() runs lazy-reclaim before attempting the insert — matching
// the SQL behaviour of reclaimExpired().
// ---------------------------------------------------------------------------
class InMemoryOrchestrationLeaseRepository {
  readonly store: InMemoryLeaseRecord[] = [];

  // ── acquire ───────────────────────────────────────────────────────────────
  acquire(input: AcquireLeaseInput): Promise<AcquireLeaseResult> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.ttlMs);
    const keys = [...input.conflictKeys].sort((a, b) =>
      `${a.kind}:${a.value}`.localeCompare(`${b.kind}:${b.value}`),
    );

    // Lazy-reclaim: expire any active lease on these conflict keys that has passed its TTL.
    this.reclaimExpired(input.projectId, keys, now);

    // Check for remaining active conflicts.
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

    // Insert one row per conflict key.
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

  // ── expireOverdue ─────────────────────────────────────────────────────────
  expireOverdue(now: Date): Promise<InMemoryLeaseRecord[]> {
    const overdue = this.store.filter(
      (r) => r.status === "active" && r.expires_at < now,
    );
    for (const record of overdue) {
      record.status = "expired";
    }
    return Promise.resolve(overdue);
  }

  // ── listActiveByProject ───────────────────────────────────────────────────
  listActiveByProject(projectId: string): Promise<InMemoryLeaseRecord[]> {
    return Promise.resolve(
      this.store.filter(
        (r) => r.project_id === projectId && r.status === "active",
      ),
    );
  }

  // ── countActiveByLane ─────────────────────────────────────────────────────
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

  // ── release ───────────────────────────────────────────────────────────────
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

  // ── releaseAllForProject ──────────────────────────────────────────────────
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

  // ── heartbeat ─────────────────────────────────────────────────────────────
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

  // ── private helpers ───────────────────────────────────────────────────────

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
// Regression test — incident 2026-06-12
//
// Scenario: CEO cycle A acquires the cycle lease and then crashes without
// releasing it.  The lease is now "orphaned" — still `active` in the store
// even though no live workflow holds it.  After the TTL elapses the lazy-
// reclaim inside acquire() must flip it to `expired` so the next CEO cycle
// can proceed.
// ---------------------------------------------------------------------------
describe("orchestration lease — orphaned holder recovery (incident 2026-06-12)", () => {
  let leaseRepo: InMemoryOrchestrationLeaseRepository;
  let leaseService: OrchestrationLeaseService;

  beforeEach(() => {
    nextLeaseSeq = 0;
    leaseRepo = new InMemoryOrchestrationLeaseRepository();
    leaseService = new OrchestrationLeaseService(leaseRepo as never);
  });

  it("a new acquire succeeds once an orphaned lease passes its TTL", async () => {
    // Step 1 — first CEO cycle acquires the lease successfully.
    const first = await leaseService.acquireCycleLease("p-test", "corr-orphan");
    expect(first.acquired).toBe(true);

    // Step 2 — second CEO cycle fires before the TTL; must be blocked.
    const blocked = await leaseService.acquireCycleLease("p-test", "corr-2");
    expect(blocked.acquired).toBe(false);
    if (!blocked.acquired) {
      expect(blocked.conflicts).toHaveLength(1);
      expect(blocked.conflicts[0].heldByOwnerId).toBe("corr-orphan");
    }

    // Step 3 — simulate the sweeper (or enough wall-clock time) expiring the
    //           orphaned lease.  Using far-future `now` means the existing
    //           lease's expires_at is in the past relative to this call.
    await leaseRepo.expireOverdue(
      new Date(Date.now() + CYCLE_LEASE_TTL_MS + 1_000),
    );

    // Confirm the store reflects the expiry before testing the service path.
    const activeAfterExpiry = await leaseRepo.listActiveByProject("p-test");
    expect(activeAfterExpiry).toHaveLength(0);

    // Step 4 — third CEO cycle now succeeds because lazy-reclaim inside
    //           acquire() recognises the now-expired lease and clears it.
    const recovered = await leaseService.acquireCycleLease("p-test", "corr-3");
    expect(recovered.acquired).toBe(true);
  });

  it("lazy reclaim inside acquire reclaims without prior sweeper call", async () => {
    // Acquire and manually back-date expires_at to simulate TTL passage without
    // going through expireOverdue — this exercises the lazy path directly.
    const first = await leaseService.acquireCycleLease("p-test", "corr-lazy");
    expect(first.acquired).toBe(true);

    // Artificially move the lease's expires_at into the past.
    const orphaned = leaseRepo.store.find((r) => r.owner_id === "corr-lazy");
    if (!orphaned) throw new Error("Expected orphaned lease to exist in store");
    orphaned.expires_at = new Date(Date.now() - 1_000);

    // acquire() should lazy-reclaim the expired lease and grant a new one.
    const recovered = await leaseService.acquireCycleLease(
      "p-test",
      "corr-new",
    );
    expect(recovered.acquired).toBe(true);

    // The original orphaned lease must now be expired.
    expect(orphaned.status).toBe("expired");
  });
});
