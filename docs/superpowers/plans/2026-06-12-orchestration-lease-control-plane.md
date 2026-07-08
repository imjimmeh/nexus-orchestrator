# Orchestration Lease Control Plane — Implementation Plan (Complete Cutover)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the implicit "non-terminal intent holds a conflict key forever" concurrency model with an explicit, owned, self-expiring **lease**, in a single complete cutover (no feature flag, no shadow mode).

**Architecture:** A new `kanban_orchestration_leases` table enforces "at most one active lease per conflict key" via a Postgres partial unique index. `OrchestrationLeaseRepository` acquires leases in one transaction that lazily reclaims expired holders, so liveness never depends on a background job. `OrchestrationLeaseService` adds lane-capacity and the cycle/mutation helpers. The CEO wakeup gate and direct-mutation executor acquire leases instead of conflict-key intents; the lifecycle-stream consumer releases on terminal runs; the continuation reconciler heartbeats live runs; orchestration status derives from lease presence. All conflict-key intent machinery is deleted.

**Tech Stack:** NestJS, TypeORM (Postgres), Vitest. Kanban app (`apps/kanban`). Reference spec: `docs/superpowers/specs/2026-06-12-orchestration-lease-control-plane-design.md`.

**Conventions (verified):** Entities raw-SQL migrations with `up`/`down`; repositories are `@Injectable` classes wrapping an injected `Repository<T>` and registered in `apps/kanban/src/database/database.module.ts` (`entities`, `repositories`, `migrations` arrays); services registered in `apps/kanban/src/orchestration/orchestration.module.ts` (`providers` + `exports`); tests are Vitest with hand-built mock repositories (see `kanban-orchestration-intent.repository.spec.ts`). Run a single test file: `npm run test --workspace=apps/kanban -- <path>`. Typecheck: `npm run build:kanban` (uses `nest build`).

**Lease key constants (used throughout):**

- `CYCLE_LEASE_TTL_MS = 10 * 60 * 1000`
- Cycle conflict key: `{ kind: "workflow_scope", value: "project_orchestration_cycle_ceo:<projectId>" }`
- Owner kinds: `cycle_request` (acquired at wakeup, before run id exists), `workflow_run` (rebound once run is live), `direct_mutation`.

---

## File Structure

**New files:**

- `apps/kanban/src/database/entities/kanban-orchestration-lease.entity.ts` — lease row.
- `apps/kanban/src/database/migrations/20260612190000-create-kanban-orchestration-leases.ts` — table + partial unique index.
- `apps/kanban/src/database/repositories/kanban-orchestration-lease.repository.ts` — acquire/heartbeat/release/expire/list.
- `apps/kanban/src/database/repositories/kanban-orchestration-lease.repository.spec.ts`
- `apps/kanban/src/orchestration/control-plane/orchestration-lease.service.ts` — cycle/mutation helpers + lane capacity.
- `apps/kanban/src/orchestration/control-plane/orchestration-lease.service.spec.ts`
- `apps/kanban/src/orchestration/control-plane/orchestration-lease-sweeper.service.ts` — `@Interval` expiry + telemetry.
- `apps/kanban/src/orchestration/control-plane/orchestration-lease-sweeper.service.spec.ts`

**Modified files:**

- `apps/kanban/src/orchestration/control-plane/control-plane.types.ts` — lease types.
- `apps/kanban/src/database/database.module.ts` — register entity, repo, migration.
- `apps/kanban/src/orchestration/orchestration.module.ts` — register lease service + sweeper.
- `apps/kanban/src/orchestration/project-orchestration-wakeup.service.ts` — lease-gated launch.
- `apps/kanban/src/core/core-lifecycle-stream.consumer.ts` — rebind/release lease on run state.
- `apps/kanban/src/orchestration/orchestration-continuation-reconciler.service.ts` — heartbeat live cycle lease.
- `apps/kanban/src/orchestration/orchestration.service.ts` — status derives from lease; delete `hasActiveOrPendingCycle`.
- `apps/kanban/src/orchestration/control-plane/orchestration-decision-executor.service.ts` — lease-gated direct mutation.
- `apps/kanban/src/orchestration/control-plane/orchestration-control-plane-scheduler.service.ts` — delete conflict branch; freshness-only; delete `resetBlockedIntents` (moves to lease).
- `apps/kanban/src/database/repositories/kanban-orchestration-intent.repository.ts` — delete `findActiveByConflictKeys` + idempotency resurrection.
- `apps/kanban/src/mcp/tools/mutation/orchestration-reset-intents.tool.ts` — release leases.
- `apps/kanban/src/project/project.controller.ts` + `project.service.ts` — `release-all` endpoint backed by lease release.

---

## Task 1: Lease types

**Files:**

- Modify: `apps/kanban/src/orchestration/control-plane/control-plane.types.ts` (append)

- [ ] **Step 1: Append the lease types**

Append to `control-plane.types.ts`:

```typescript
export type OrchestrationLeaseStatus = "active" | "released" | "expired";

export type OrchestrationLeaseOwnerKind =
  | "cycle_request"
  | "workflow_run"
  | "direct_mutation";

export interface OrchestrationLeaseOwner {
  readonly kind: OrchestrationLeaseOwnerKind;
  readonly id: string;
}

export interface AcquireLeaseInput {
  readonly projectId: string;
  readonly lane: OrchestrationLane;
  readonly owner: OrchestrationLeaseOwner;
  readonly conflictKeys: OrchestrationConflictKey[];
  readonly ttlMs: number;
  readonly metadata?: Record<string, unknown>;
}

export interface LeaseConflict {
  readonly conflictKey: OrchestrationConflictKey;
  readonly heldByOwnerKind: OrchestrationLeaseOwnerKind;
  readonly heldByOwnerId: string;
  readonly expiresAt: string;
}

export type AcquireLeaseResult =
  | { readonly acquired: true; readonly leaseIds: string[] }
  | { readonly acquired: false; readonly conflicts: LeaseConflict[] };
```

- [ ] **Step 2: Typecheck**

Run: `npm run build:kanban`
Expected: PASS (types only; no consumers yet).

- [ ] **Step 3: Commit**

```bash
git add apps/kanban/src/orchestration/control-plane/control-plane.types.ts
git commit -m "feat(kanban): add orchestration lease types"
```

---

## Task 2: Lease entity + registration

**Files:**

- Create: `apps/kanban/src/database/entities/kanban-orchestration-lease.entity.ts`
- Modify: `apps/kanban/src/database/database.module.ts`

- [ ] **Step 1: Create the entity**

```typescript
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import type {
  OrchestrationConflictKeyKind,
  OrchestrationLane,
  OrchestrationLeaseOwnerKind,
  OrchestrationLeaseStatus,
} from "../../orchestration/control-plane/control-plane.types";

@Entity("kanban_orchestration_leases")
@Index("idx_kanban_orchestration_leases_project_status", [
  "project_id",
  "status",
])
@Index("idx_kanban_orchestration_leases_project_lane_status", [
  "project_id",
  "lane",
  "status",
])
export class KanbanOrchestrationLeaseEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  project_id!: string;

  @Column({ type: "varchar", length: 32 })
  conflict_key_kind!: OrchestrationConflictKeyKind;

  @Column({ type: "varchar", length: 512 })
  conflict_key_value!: string;

  @Column({ type: "varchar", length: 64 })
  lane!: OrchestrationLane;

  @Column({ type: "varchar", length: 32 })
  owner_kind!: OrchestrationLeaseOwnerKind;

  @Column({ type: "varchar", length: 255 })
  owner_id!: string;

  @Column({ type: "varchar", length: 16 })
  status!: OrchestrationLeaseStatus;

  @Column({ type: "timestamp" })
  acquired_at!: Date;

  @Column({ type: "timestamp" })
  heartbeat_at!: Date;

  @Column({ type: "timestamp" })
  expires_at!: Date;

  @Column({ type: "timestamp", nullable: true })
  released_at!: Date | null;

  @Column({ type: "jsonb", nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamp" })
  updated_at!: Date;
}
```

- [ ] **Step 2: Register the entity in `database.module.ts`**

Add the import near the other entity imports:

```typescript
import { KanbanOrchestrationLeaseEntity } from "./entities/kanban-orchestration-lease.entity";
```

Add `KanbanOrchestrationLeaseEntity,` to the `entities` array (after `KanbanOrchestrationLaunchAttemptEntity,`).

- [ ] **Step 3: Typecheck**

Run: `npm run build:kanban`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/kanban/src/database/entities/kanban-orchestration-lease.entity.ts apps/kanban/src/database/database.module.ts
git commit -m "feat(kanban): add orchestration lease entity"
```

---

## Task 3: Migration

**Files:**

- Create: `apps/kanban/src/database/migrations/20260612190000-create-kanban-orchestration-leases.ts`
- Modify: `apps/kanban/src/database/database.module.ts`

- [ ] **Step 1: Create the migration**

```typescript
import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateKanbanOrchestrationLeases20260612190000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kanban_orchestration_leases (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL,
        conflict_key_kind character varying(32) NOT NULL,
        conflict_key_value character varying(512) NOT NULL,
        lane character varying(64) NOT NULL,
        owner_kind character varying(32) NOT NULL,
        owner_id character varying(255) NOT NULL,
        status character varying(16) NOT NULL,
        acquired_at TIMESTAMP NOT NULL,
        heartbeat_at TIMESTAMP NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        released_at TIMESTAMP NULL,
        metadata jsonb NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_kanban_orchestration_leases_active_key
      ON kanban_orchestration_leases (project_id, conflict_key_kind, conflict_key_value)
      WHERE status = 'active'
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_orchestration_leases_project_status
      ON kanban_orchestration_leases (project_id, status)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_orchestration_leases_project_lane_status
      ON kanban_orchestration_leases (project_id, lane, status)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE IF EXISTS kanban_orchestration_leases");
  }
}
```

- [ ] **Step 2: Register the migration in `database.module.ts`**

Add the import:

```typescript
import { CreateKanbanOrchestrationLeases20260612190000 } from "./migrations/20260612190000-create-kanban-orchestration-leases";
```

Add `CreateKanbanOrchestrationLeases20260612190000,` to the `migrations` array.

- [ ] **Step 3: Apply the migration**

Run: `docker compose up -d --build kanban` (or restart the kanban service so `migrationsRun` executes it).
Verify: `docker exec nexus-postgres psql -U nexus -d nexus_orchestrator -c "\d kanban_orchestration_leases"`
Expected: table exists with `uq_kanban_orchestration_leases_active_key` partial unique index.

- [ ] **Step 4: Commit**

```bash
git add apps/kanban/src/database/migrations/20260612190000-create-kanban-orchestration-leases.ts apps/kanban/src/database/database.module.ts
git commit -m "feat(kanban): migration for orchestration leases table"
```

---

## Task 4: Lease repository (TDD)

**Files:**

- Create: `apps/kanban/src/database/repositories/kanban-orchestration-lease.repository.ts`
- Test: `apps/kanban/src/database/repositories/kanban-orchestration-lease.repository.spec.ts`
- Modify: `apps/kanban/src/database/database.module.ts`

The repository owns the transactional acquire (lazy reclaim + all-or-nothing). It uses the injected `DataSource` to run a transaction. The unique-violation error code is Postgres `23505` (same check the intent repo uses).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from "vitest";
import type { DataSource, EntityManager } from "typeorm";
import { KanbanOrchestrationLeaseRepository } from "./kanban-orchestration-lease.repository";

function makeManager(overrides: Partial<Record<string, unknown>> = {}) {
  const manager = {
    query: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockResolvedValue({ identifiers: [{ id: "lease-1" }] }),
    ...overrides,
  };
  return manager as unknown as EntityManager;
}

function makeDataSource(manager: EntityManager): DataSource {
  return {
    transaction: vi.fn(async (cb: (m: EntityManager) => Promise<unknown>) =>
      cb(manager),
    ),
  } as unknown as DataSource;
}

describe("KanbanOrchestrationLeaseRepository.acquire", () => {
  it("acquires when no active lease exists for the key", async () => {
    const manager = makeManager();
    const repo = new KanbanOrchestrationLeaseRepository(
      makeDataSource(manager),
    );

    const result = await repo.acquire({
      projectId: "p1",
      lane: "strategy",
      owner: { kind: "cycle_request", id: "corr-1" },
      conflictKeys: [
        { kind: "workflow_scope", value: "project_orchestration_cycle_ceo:p1" },
      ],
      ttlMs: 600000,
    });

    expect(result.acquired).toBe(true);
    // lazy reclaim first, then insert
    expect(manager.query).toHaveBeenCalled();
    expect(manager.insert).toHaveBeenCalledTimes(1);
  });

  it("fails and returns the live holder on unique violation (23505)", async () => {
    const manager = makeManager({
      insert: vi.fn().mockRejectedValue({ code: "23505" }),
      query: vi
        .fn()
        .mockResolvedValueOnce([]) // reclaim update
        .mockResolvedValueOnce([
          {
            conflict_key_kind: "workflow_scope",
            conflict_key_value: "project_orchestration_cycle_ceo:p1",
            owner_kind: "workflow_run",
            owner_id: "run-9",
            expires_at: new Date("2026-06-12T19:00:00Z"),
          },
        ]),
    });
    const repo = new KanbanOrchestrationLeaseRepository(
      makeDataSource(manager),
    );

    const result = await repo.acquire({
      projectId: "p1",
      lane: "strategy",
      owner: { kind: "cycle_request", id: "corr-2" },
      conflictKeys: [
        { kind: "workflow_scope", value: "project_orchestration_cycle_ceo:p1" },
      ],
      ttlMs: 600000,
    });

    expect(result.acquired).toBe(false);
    if (!result.acquired) {
      expect(result.conflicts[0].heldByOwnerId).toBe("run-9");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- kanban-orchestration-lease.repository.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the repository**

```typescript
import { Injectable } from "@nestjs/common";
import { DataSource, type EntityManager, LessThan } from "typeorm";
import { KanbanOrchestrationLeaseEntity } from "../entities/kanban-orchestration-lease.entity";
import type {
  AcquireLeaseInput,
  AcquireLeaseResult,
  LeaseConflict,
  OrchestrationConflictKey,
} from "../../orchestration/control-plane/control-plane.types";

const UNIQUE_VIOLATION = "23505";

@Injectable()
export class KanbanOrchestrationLeaseRepository {
  constructor(private readonly dataSource: DataSource) {}

  async acquire(input: AcquireLeaseInput): Promise<AcquireLeaseResult> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.ttlMs);
    // Canonical order avoids deadlocks between multi-key acquirers.
    const keys = [...input.conflictKeys].sort((a, b) =>
      `${a.kind}:${a.value}`.localeCompare(`${b.kind}:${b.value}`),
    );

    return this.dataSource
      .transaction(async (manager) => {
        await this.reclaimExpired(manager, input.projectId, keys, now);

        const leaseIds: string[] = [];
        try {
          for (const key of keys) {
            const inserted = await manager.insert(
              KanbanOrchestrationLeaseEntity,
              {
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
              },
            );
            leaseIds.push(inserted.identifiers[0].id as string);
          }
        } catch (error) {
          if (this.isUniqueViolation(error)) {
            const conflicts = await this.loadConflicts(
              manager,
              input.projectId,
              keys,
            );
            throw new LeaseConflictRollback(conflicts);
          }
          throw error;
        }

        return { acquired: true, leaseIds };
      })
      .catch((error: unknown) => {
        if (error instanceof LeaseConflictRollback) {
          return { acquired: false, conflicts: error.conflicts };
        }
        throw error;
      });
  }

  async heartbeat(leaseId: string, ttlMs: number): Promise<void> {
    const now = new Date();
    await this.dataSource
      .getRepository(KanbanOrchestrationLeaseEntity)
      .update(
        { id: leaseId, status: "active" },
        { heartbeat_at: now, expires_at: new Date(now.getTime() + ttlMs) },
      );
  }

  async release(leaseId: string, ownerId: string): Promise<boolean> {
    const result = await this.dataSource
      .getRepository(KanbanOrchestrationLeaseEntity)
      .update(
        { id: leaseId, owner_id: ownerId, status: "active" },
        { status: "released", released_at: new Date() },
      );
    return (result.affected ?? 0) > 0;
  }

  async expireOverdue(now: Date): Promise<KanbanOrchestrationLeaseEntity[]> {
    const repo = this.dataSource.getRepository(KanbanOrchestrationLeaseEntity);
    const overdue = await repo.find({
      where: { status: "active", expires_at: LessThan(now) },
    });
    if (overdue.length === 0) return [];
    await repo.update(
      { status: "active", expires_at: LessThan(now) },
      { status: "expired" },
    );
    return overdue;
  }

  listActiveByProject(
    projectId: string,
  ): Promise<KanbanOrchestrationLeaseEntity[]> {
    return this.dataSource
      .getRepository(KanbanOrchestrationLeaseEntity)
      .find({ where: { project_id: projectId, status: "active" } });
  }

  countActiveByLane(projectId: string, lane: string): Promise<number> {
    return this.dataSource
      .getRepository(KanbanOrchestrationLeaseEntity)
      .count({ where: { project_id: projectId, lane, status: "active" } });
  }

  async releaseAllForProject(projectId: string): Promise<number> {
    const result = await this.dataSource
      .getRepository(KanbanOrchestrationLeaseEntity)
      .update(
        { project_id: projectId, status: "active" },
        { status: "released", released_at: new Date() },
      );
    return result.affected ?? 0;
  }

  private async reclaimExpired(
    manager: EntityManager,
    projectId: string,
    keys: OrchestrationConflictKey[],
    now: Date,
  ): Promise<void> {
    for (const key of keys) {
      await manager.query(
        `UPDATE kanban_orchestration_leases
         SET status = 'expired'
         WHERE project_id = $1 AND conflict_key_kind = $2
           AND conflict_key_value = $3 AND status = 'active' AND expires_at < $4`,
        [projectId, key.kind, key.value, now],
      );
    }
  }

  private async loadConflicts(
    manager: EntityManager,
    projectId: string,
    keys: OrchestrationConflictKey[],
  ): Promise<LeaseConflict[]> {
    const conflicts: LeaseConflict[] = [];
    for (const key of keys) {
      const rows: Array<{
        conflict_key_kind: OrchestrationConflictKey["kind"];
        conflict_key_value: string;
        owner_kind: LeaseConflict["heldByOwnerKind"];
        owner_id: string;
        expires_at: Date;
      }> = await manager.query(
        `SELECT conflict_key_kind, conflict_key_value, owner_kind, owner_id, expires_at
         FROM kanban_orchestration_leases
         WHERE project_id = $1 AND conflict_key_kind = $2
           AND conflict_key_value = $3 AND status = 'active'`,
        [projectId, key.kind, key.value],
      );
      for (const row of rows) {
        conflicts.push({
          conflictKey: {
            kind: row.conflict_key_kind,
            value: row.conflict_key_value,
          },
          heldByOwnerKind: row.owner_kind,
          heldByOwnerId: row.owner_id,
          expiresAt: new Date(row.expires_at).toISOString(),
        });
      }
    }
    return conflicts;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === UNIQUE_VIOLATION
    );
  }
}

class LeaseConflictRollback extends Error {
  constructor(public readonly conflicts: LeaseConflict[]) {
    super("lease_conflict");
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- kanban-orchestration-lease.repository.spec.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Register the repository in `database.module.ts`**

Add import:

```typescript
import { KanbanOrchestrationLeaseRepository } from "./repositories/kanban-orchestration-lease.repository";
```

Add `KanbanOrchestrationLeaseRepository,` to the `repositories` array. (It injects `DataSource`, which TypeOrmModule.forRoot provides globally — no `forFeature` entry beyond the entity already added.)

- [ ] **Step 6: Typecheck + commit**

Run: `npm run build:kanban`
Expected: PASS.

```bash
git add apps/kanban/src/database/repositories/kanban-orchestration-lease.repository.ts apps/kanban/src/database/repositories/kanban-orchestration-lease.repository.spec.ts apps/kanban/src/database/database.module.ts
git commit -m "feat(kanban): orchestration lease repository with lazy-reclaim acquire"
```

---

## Task 5: Lease service (TDD)

Wraps the repository with domain helpers and lane-capacity enforcement.

**Files:**

- Create: `apps/kanban/src/orchestration/control-plane/orchestration-lease.service.ts`
- Test: `apps/kanban/src/orchestration/control-plane/orchestration-lease.service.spec.ts`
- Modify: `apps/kanban/src/orchestration/orchestration.module.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from "vitest";
import { OrchestrationLeaseService } from "./orchestration-lease.service";

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    acquire: vi.fn().mockResolvedValue({ acquired: true, leaseIds: ["l1"] }),
    heartbeat: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(true),
    countActiveByLane: vi.fn().mockResolvedValue(0),
    listActiveByProject: vi.fn().mockResolvedValue([]),
    releaseAllForProject: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

describe("OrchestrationLeaseService.acquireCycleLease", () => {
  it("acquires the workflow_scope cycle lease for a project", async () => {
    const repo = makeRepo();
    const service = new OrchestrationLeaseService(repo as never);

    const result = await service.acquireCycleLease("p1", "corr-1");

    expect(result.acquired).toBe(true);
    expect(repo.acquire).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p1",
        lane: "strategy",
        owner: { kind: "cycle_request", id: "corr-1" },
        conflictKeys: [
          {
            kind: "workflow_scope",
            value: "project_orchestration_cycle_ceo:p1",
          },
        ],
      }),
    );
  });

  it("blocks a lane-capped mutation when the lane is full", async () => {
    const repo = makeRepo({ countActiveByLane: vi.fn().mockResolvedValue(1) });
    const service = new OrchestrationLeaseService(repo as never);

    const result = await service.acquireMutationLeases({
      projectId: "p1",
      lane: "strategy",
      ownerId: "corr-2",
      conflictKeys: [{ kind: "work_item", value: "wi-1" }],
      laneCapacity: 1,
    });

    expect(result.acquired).toBe(false);
    expect(repo.acquire).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- orchestration-lease.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

```typescript
import { Injectable } from "@nestjs/common";
import { KanbanOrchestrationLeaseRepository } from "../../database/repositories/kanban-orchestration-lease.repository";
import type {
  AcquireLeaseResult,
  OrchestrationConflictKey,
  OrchestrationLane,
} from "./control-plane.types";

export const CYCLE_LEASE_TTL_MS = 10 * 60 * 1000;

function cycleConflictKey(projectId: string): OrchestrationConflictKey {
  return {
    kind: "workflow_scope",
    value: `project_orchestration_cycle_ceo:${projectId}`,
  };
}

@Injectable()
export class OrchestrationLeaseService {
  constructor(private readonly leases: KanbanOrchestrationLeaseRepository) {}

  acquireCycleLease(
    projectId: string,
    correlationId: string,
  ): Promise<AcquireLeaseResult> {
    return this.leases.acquire({
      projectId,
      lane: "strategy",
      owner: { kind: "cycle_request", id: correlationId },
      conflictKeys: [cycleConflictKey(projectId)],
      ttlMs: CYCLE_LEASE_TTL_MS,
    });
  }

  async heartbeatCycleLease(projectId: string): Promise<void> {
    const active = await this.leases.listActiveByProject(projectId);
    const cycle = active.find(
      (lease) =>
        lease.conflict_key_kind === "workflow_scope" &&
        lease.conflict_key_value ===
          `project_orchestration_cycle_ceo:${projectId}`,
    );
    if (cycle) {
      await this.leases.heartbeat(cycle.id, CYCLE_LEASE_TTL_MS);
    }
  }

  async releaseCycleLease(projectId: string): Promise<void> {
    const active = await this.leases.listActiveByProject(projectId);
    for (const lease of active) {
      if (
        lease.conflict_key_kind === "workflow_scope" &&
        lease.conflict_key_value ===
          `project_orchestration_cycle_ceo:${projectId}`
      ) {
        await this.leases.release(lease.id, lease.owner_id);
      }
    }
  }

  hasActiveCycleLease(projectId: string): Promise<boolean> {
    return this.leases
      .listActiveByProject(projectId)
      .then((active) =>
        active.some(
          (lease) =>
            lease.conflict_key_kind === "workflow_scope" &&
            lease.conflict_key_value ===
              `project_orchestration_cycle_ceo:${projectId}`,
        ),
      );
  }

  async acquireMutationLeases(input: {
    projectId: string;
    lane: OrchestrationLane;
    ownerId: string;
    conflictKeys: OrchestrationConflictKey[];
    laneCapacity: number;
    ttlMs?: number;
  }): Promise<AcquireLeaseResult> {
    const active = await this.leases.countActiveByLane(
      input.projectId,
      input.lane,
    );
    if (active >= input.laneCapacity) {
      return {
        acquired: false,
        conflicts: input.conflictKeys.map((conflictKey) => ({
          conflictKey,
          heldByOwnerKind: "direct_mutation",
          heldByOwnerId: "lane_capacity",
          expiresAt: new Date(0).toISOString(),
        })),
      };
    }
    return this.leases.acquire({
      projectId: input.projectId,
      lane: input.lane,
      owner: { kind: "direct_mutation", id: input.ownerId },
      conflictKeys: input.conflictKeys,
      ttlMs: input.ttlMs ?? CYCLE_LEASE_TTL_MS,
    });
  }

  async releaseOwned(projectId: string, ownerId: string): Promise<void> {
    const active = await this.leases.listActiveByProject(projectId);
    for (const lease of active) {
      if (lease.owner_id === ownerId) {
        await this.leases.release(lease.id, ownerId);
      }
    }
  }

  releaseAllForProject(projectId: string): Promise<number> {
    return this.leases.releaseAllForProject(projectId);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- orchestration-lease.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Register in `orchestration.module.ts`**

Add import:

```typescript
import { OrchestrationLeaseService } from "./control-plane/orchestration-lease.service";
```

Add `OrchestrationLeaseService,` to BOTH the `providers` and `exports` arrays.

- [ ] **Step 6: Typecheck + commit**

Run: `npm run build:kanban` → PASS

```bash
git add apps/kanban/src/orchestration/control-plane/orchestration-lease.service.ts apps/kanban/src/orchestration/control-plane/orchestration-lease.service.spec.ts apps/kanban/src/orchestration/orchestration.module.ts
git commit -m "feat(kanban): orchestration lease service with lane capacity"
```

---

## Task 6: Lease sweeper (TDD)

Proactive expiry + telemetry. Correctness does NOT depend on it (acquire reclaims lazily); it converts silent dead-holder reclaims into log signals.

**Files:**

- Create: `apps/kanban/src/orchestration/control-plane/orchestration-lease-sweeper.service.ts`
- Test: `apps/kanban/src/orchestration/control-plane/orchestration-lease-sweeper.service.spec.ts`
- Modify: `apps/kanban/src/orchestration/orchestration.module.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from "vitest";
import { OrchestrationLeaseSweeperService } from "./orchestration-lease-sweeper.service";

describe("OrchestrationLeaseSweeperService.sweep", () => {
  it("expires overdue leases and logs each reclaimed holder", async () => {
    const repo = {
      expireOverdue: vi.fn().mockResolvedValue([
        {
          id: "l1",
          project_id: "p1",
          owner_kind: "workflow_run",
          owner_id: "run-9",
          conflict_key_value: "project_orchestration_cycle_ceo:p1",
        },
      ]),
    };
    const service = new OrchestrationLeaseSweeperService(repo as never);
    const warn = vi.spyOn(
      (service as never as { logger: { warn: () => void } }).logger,
      "warn",
    );

    const result = await service.sweep();

    expect(result.reclaimed).toBe(1);
    expect(repo.expireOverdue).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- orchestration-lease-sweeper.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the sweeper**

```typescript
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { KanbanOrchestrationLeaseRepository } from "../../database/repositories/kanban-orchestration-lease.repository";

const SWEEP_INTERVAL_MS = 30000;

@Injectable()
export class OrchestrationLeaseSweeperService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(OrchestrationLeaseSweeperService.name);
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private sweeping = false;

  constructor(private readonly leases: KanbanOrchestrationLeaseRepository) {}

  onModuleInit(): void {
    this.intervalId = setInterval(
      () => void this.runSweep(),
      SWEEP_INTERVAL_MS,
    );
  }

  onModuleDestroy(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async sweep(): Promise<{ reclaimed: number }> {
    const reclaimed = await this.leases.expireOverdue(new Date());
    for (const lease of reclaimed) {
      this.logger.warn(
        `Reclaimed expired orchestration lease ${lease.id} ` +
          `(project=${lease.project_id} key=${lease.conflict_key_value} ` +
          `owner=${lease.owner_kind}:${lease.owner_id}) — holder died without releasing.`,
      );
    }
    return { reclaimed: reclaimed.length };
  }

  private async runSweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      await this.sweep();
    } catch (error) {
      this.logger.warn(
        `lease sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.sweeping = false;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- orchestration-lease-sweeper.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Register in `orchestration.module.ts`** (providers only; no need to export)

Add import + add `OrchestrationLeaseSweeperService,` to `providers`.

- [ ] **Step 6: Commit**

```bash
git add apps/kanban/src/orchestration/control-plane/orchestration-lease-sweeper.service.ts apps/kanban/src/orchestration/control-plane/orchestration-lease-sweeper.service.spec.ts apps/kanban/src/orchestration/orchestration.module.ts
git commit -m "feat(kanban): orchestration lease sweeper with reclaim telemetry"
```

---

## Task 7: Lease-gate the CEO wakeup

Replace the conflict-key intent gate (`hasActiveOrPendingCycle` + `scheduler.evaluateIntent`) with `leaseService.acquireCycleLease`. Keep the human-stop suppression gate and the coalesce/cooldown throttles (they are legitimate debounce, not the bug). On launch failure, release the lease.

**Files:**

- Modify: `apps/kanban/src/orchestration/project-orchestration-wakeup.service.ts`
- Test: `apps/kanban/src/orchestration/project-orchestration-wakeup.service.spec.ts`

- [ ] **Step 1: Update the existing test for the lease gate**

In `project-orchestration-wakeup.service.spec.ts`, the constructor and the launch-path expectations change. Replace the scheduler/`hasActiveOrPendingCycle` wiring with a lease service mock. Add this test:

```typescript
it("does not launch when the cycle lease is already held", async () => {
  leaseService.acquireCycleLease.mockResolvedValue({
    acquired: false,
    conflicts: [
      {
        conflictKey: {
          kind: "workflow_scope",
          value: "project_orchestration_cycle_ceo:p1",
        },
        heldByOwnerKind: "workflow_run",
        heldByOwnerId: "run-9",
        expiresAt: new Date().toISOString(),
      },
    ],
  });

  const result = await service.requestWakeup({
    projectId: "p1",
    reason: "workflow_completed",
    source: "core_lifecycle_stream",
  });

  expect(result).toEqual({ emitted: false, reason: "active_cycle_exists" });
  expect(dispatchService.requestOrchestrationCycle).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- project-orchestration-wakeup.service.spec.ts`
Expected: FAIL — `leaseService` undefined / wrong constructor.

- [ ] **Step 3: Rewrite the gate in `project-orchestration-wakeup.service.ts`**

Replace the constructor scheduler dependency with the lease service, and replace the intent-creation + `hasActiveOrPendingCycle` + `evaluateIntent` block with lease acquisition.

Constructor (replace `scheduler` injection):

```typescript
constructor(
	@Inject(forwardRef(() => DispatchService))
	private readonly dispatchService: DispatchService,
	private readonly orchestrationService: OrchestrationService,
	private readonly leaseService: OrchestrationLeaseService,
) {}
```

Add import at top:

```typescript
import { OrchestrationLeaseService } from "./control-plane/orchestration-lease.service";
```

Replace the body of `requestWakeup` (lines ~48-157) with:

```typescript
async requestWakeup(input: RequestWakeupInput): Promise<RequestWakeupResult> {
	// Human stop-decision suppression (legitimate, kept).
	const suppressionState =
		await this.orchestrationService.getAutoWakeSuppressionState(
			input.projectId,
		);
	if (suppressionState.suppressed && this.isAutomaticWakeup(input)) {
		return { emitted: false, reason: "orchestration_auto_wake_suppressed" };
	}

	// Debounce throttles (legitimate, kept).
	const cooldownState = await this.orchestrationService.getWakeupCooldownState(
		input.projectId,
	);
	if (this.isInsideAutomaticWakeupCoalesceWindow(input, cooldownState)) {
		return { emitted: false, reason: "automatic_wakeup_coalesced" };
	}
	if (this.isInsideStaleWakeupCooldown(input, cooldownState)) {
		return { emitted: false, reason: "stale_wakeup_cooldown" };
	}

	// Single concurrency guard: acquire the cycle lease.
	const correlationId = `${input.source ?? "manual"}:${input.reason}`;
	const lease = await this.leaseService.acquireCycleLease(
		input.projectId,
		correlationId,
	);
	if (!lease.acquired) {
		return { emitted: false, reason: "active_cycle_exists" };
	}

	const dedupeKey = this.buildWakeupDedupeKey(
		input.projectId,
		input,
		new Date(Date.now()),
		cooldownState,
	);

	try {
		await this.dispatchService.requestOrchestrationCycle(input.projectId, {
			reason: input.reason,
			source: input.source,
			dedupeKey,
		});
	} catch (error) {
		// Launch failed — do not strand the lease.
		await this.leaseService.releaseCycleLease(input.projectId);
		throw error;
	}

	if (input.source) {
		try {
			await this.orchestrationService.recordWakeup(input.projectId, {
				reason: input.reason,
				source: input.source,
			});
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			this.logger.warn(
				`Failed to record orchestration wakeup metadata for project ${input.projectId}: ${reason}`,
			);
		}
	}

	return { emitted: true };
}
```

Delete the now-unused private helpers that only served the intent path: `recordWakeupNoLaunch`, `resolveErrorMessage` (if unused elsewhere). Keep `buildWakeupDedupeKey`, the coalesce/cooldown helpers, `isAutomaticWakeup`, `isStaleReconcilerWakeup`.

> Note: `RequestWakeupResult`'s `reason` union in `project-orchestration-wakeup.types.ts` may have members tied to the old path (`scheduler_not_launchable`). Remove dead members; keep `active_cycle_exists`, `orchestration_auto_wake_suppressed`, `automatic_wakeup_coalesced`, `stale_wakeup_cooldown`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- project-orchestration-wakeup.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npm run build:kanban` → PASS (fix any references to the removed `scheduler` injection in this file).

```bash
git add apps/kanban/src/orchestration/project-orchestration-wakeup.service.ts apps/kanban/src/orchestration/project-orchestration-wakeup.service.spec.ts apps/kanban/src/orchestration/project-orchestration-wakeup.types.ts
git commit -m "feat(kanban): lease-gate the CEO wakeup, drop conflict-key intent gate"
```

---

## Task 8: Rebind + release the lease on run lifecycle

When the CEO run goes RUNNING, rebind the lease owner to `workflow_run:<runId>` and set `linked_run_id`. On terminal, release the lease (alongside the existing `reconcileLinkedWorkflowRun` link clear).

**Files:**

- Modify: `apps/kanban/src/core/core-lifecycle-stream.consumer.ts`
- Test: the consumer's existing `.spec.ts`

- [ ] **Step 1: Add a failing test**

In the consumer spec, add a case asserting that a terminal run event for a project releases the cycle lease:

```typescript
it("releases the cycle lease when the linked run reaches a terminal state", async () => {
  // arrange a terminal run event for project p1 with run-9 linked
  await consumer.handleLifecycleEvent({
    projectId: "p1",
    workflowRunId: "run-9",
    status: "COMPLETED",
    workflowId: "project_orchestration_cycle_ceo",
  } as never);

  expect(leaseService.releaseCycleLease).toHaveBeenCalledWith("p1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- core-lifecycle-stream.consumer.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Wire the lease service into the consumer**

Inject `OrchestrationLeaseService`. In the handler that processes a CEO-cycle run reaching a terminal status (the same place that already calls `reconcileLinkedWorkflowRun` / `orchestrationService.reconcileLinkedWorkflowRun`), add after the link-clear:

```typescript
if (event.workflowId === "project_orchestration_cycle_ceo") {
  await this.leaseService.releaseCycleLease(event.projectId);
}
```

And in the handler for a run reaching RUNNING for the cycle workflow, rebind + set the linked run:

```typescript
if (
  event.workflowId === "project_orchestration_cycle_ceo" &&
  event.status === "RUNNING"
) {
  await this.leaseService.heartbeatCycleLease(event.projectId);
  // existing: set linked_run_id = event.workflowRunId
}
```

(Use the exact event field names present in the consumer; the executor must read the file's `LifecycleEvent` shape first.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- core-lifecycle-stream.consumer.spec.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
git add apps/kanban/src/core/core-lifecycle-stream.consumer.ts apps/kanban/src/core/core-lifecycle-stream.consumer.spec.ts
git commit -m "feat(kanban): release cycle lease on terminal run, heartbeat on running"
```

---

## Task 9: Heartbeat the live cycle lease from the continuation reconciler

The 60s reconciler is the periodic "still alive" signal for long CEO runs.

**Files:**

- Modify: `apps/kanban/src/orchestration/orchestration-continuation-reconciler.service.ts`
- Test: its `.spec.ts`

- [ ] **Step 1: Add a failing test**

```typescript
it("heartbeats the cycle lease for a project whose linked run is still active", async () => {
  orchestrationService.findOrchestratingStatesForContinuationCleanup.mockResolvedValue(
    [{ project_id: "p1", linked_run_id: "run-9" }],
  );
  dispatchService.reconcileProjectLinkedRuns.mockResolvedValue({
    orphanReconciled: [],
  });

  await service.reconcileStaleContinuations();

  expect(leaseService.heartbeatCycleLease).toHaveBeenCalledWith("p1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- orchestration-continuation-reconciler.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Inject + call the lease service**

Add `OrchestrationLeaseService` to the constructor. Inside the `for (const state of states)` loop in `reconcileStaleContinuations`, after the `reconcileProjectLinkedRuns` call succeeds, add:

```typescript
if (state.linked_run_id) {
  try {
    await this.leaseService.heartbeatCycleLease(state.project_id);
  } catch (error) {
    this.logger.warn(
      `heartbeatCycleLease failed for ${state.project_id}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
```

(`findOrchestratingStatesForContinuationCleanup` returns records that include `linked_run_id`; if the field is absent on the typed shape, widen the local type to read it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- orchestration-continuation-reconciler.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/kanban/src/orchestration/orchestration-continuation-reconciler.service.ts apps/kanban/src/orchestration/orchestration-continuation-reconciler.service.spec.ts
git commit -m "feat(kanban): heartbeat live cycle lease from continuation reconciler"
```

---

## Task 10: Derive orchestration status from the lease; delete `hasActiveOrPendingCycle`

**Files:**

- Modify: `apps/kanban/src/orchestration/orchestration.service.ts`
- Test: `apps/kanban/src/orchestration/orchestration.service.spec.ts`

- [ ] **Step 1: Update the test**

Replace assertions on `hasActiveOrPendingCycle` with `isCycleActive` backed by the lease service:

```typescript
it("reports cycle active iff a cycle lease is held", async () => {
  leaseService.hasActiveCycleLease.mockResolvedValue(true);
  await expect(service.isCycleActive("p1")).resolves.toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- orchestration.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Replace the method**

Inject `OrchestrationLeaseService`. Delete `hasActiveOrPendingCycle` (lines ~326-340) and replace with:

```typescript
isCycleActive(project_id: string): Promise<boolean> {
	return this.leaseService.hasActiveCycleLease(project_id);
}
```

Search for remaining callers of `hasActiveOrPendingCycle` (`grep -rn hasActiveOrPendingCycle apps/kanban/src`) and repoint them to `isCycleActive`. The wakeup service no longer calls it (Task 7).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- orchestration.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npm run build:kanban` → PASS.

```bash
git add apps/kanban/src/orchestration/orchestration.service.ts apps/kanban/src/orchestration/orchestration.service.spec.ts
git commit -m "refactor(kanban): derive cycle-active from lease, remove hasActiveOrPendingCycle"
```

---

## Task 11: Lease-gate direct mutations

`OrchestrationDecisionExecutorService.executeDirectMutationDecision` currently gates on conflict-key intents via `scheduler.evaluateIntent`. Replace the gating with a lease acquire over the decision's conflict keys, keeping the intent only as an audit journal entry and the fact-freshness preflight.

**Files:**

- Modify: `apps/kanban/src/orchestration/control-plane/orchestration-decision-executor.service.ts`
- Test: `apps/kanban/src/orchestration/control-plane/orchestration-decision-executor.service.spec.ts`

- [ ] **Step 1: Update the test**

```typescript
it("blocks the mutation with the real reason when the lease cannot be acquired", async () => {
  leaseService.acquireMutationLeases.mockResolvedValue({
    acquired: false,
    conflicts: [
      {
        conflictKey: { kind: "work_item", value: "wi-1" },
        heldByOwnerKind: "direct_mutation",
        heldByOwnerId: "other",
        expiresAt: new Date().toISOString(),
      },
    ],
  });

  await expect(
    service.executeDirectMutationDecision({
      projectId: "p1",
      requester: "kanban.work_item_transition_status",
      structuredDecision: validTransitionDecision,
      execute: vi.fn(),
    } as never),
  ).rejects.toThrow(/work_item:wi-1/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- orchestration-decision-executor.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Rewrite `executeDirectMutationDecision`**

Inject `OrchestrationLeaseService`. Keep `recordExecutableDecision` for the **freshness preflight + audit intent** but drop its conflict-key terminalization. Replace `executeDirectMutationDecision`:

```typescript
async executeDirectMutationDecision<TResult>(
	input: ExecuteDirectMutationDecisionInput<TResult>,
): Promise<TResult> {
	const parsed = structuredDecisionSchema.safeParse(input.structuredDecision);
	if (!parsed.success) {
		throw new BadRequestException(parsed.error.message);
	}

	// Fact-freshness preflight + audit journal entry (no conflict-key blocking).
	const intentInput = structuredDecisionToIntentInput(
		input.projectId,
		parsed.data,
		input.requester,
	);
	const ownerId = `${input.requester}:${intentInput.idempotencyKey ?? parsed.data.lane}`;

	const lease = await this.leaseService.acquireMutationLeases({
		projectId: input.projectId,
		lane: parsed.data.lane,
		ownerId,
		conflictKeys: intentInput.conflictKeys ?? [],
		laneCapacity: this.resolveLaneCapacity(parsed.data.lane),
	});

	if (!lease.acquired) {
		const keys = lease.conflicts
			.map((c) => `${c.conflictKey.kind}:${c.conflictKey.value}`)
			.join(", ");
		throw new BadRequestException(
			`Mutation blocked — conflicting lease(s) held: ${keys}`,
		);
	}

	try {
		return await input.execute({
			structuredDecision: parsed.data,
			intentId: "",
			schedulerDecision: {
				intentId: "",
				outcomeId: "",
				status: "launchable",
				reason: "no_conflicts",
				conflictKeys: intentInput.conflictKeys ?? [],
				activeConflicts: [],
				metadata: null,
			},
		});
	} finally {
		await this.leaseService.releaseOwned(input.projectId, ownerId);
	}
}
```

> The fact-freshness requirement still matters. If the decision requires fresh facts (`resolveRequiredFacts`), call the existing freshness check before acquiring the lease and throw `BadRequestException` with the missing fact types if stale. (Reuse `resolveRequiredFacts`; query `facts` freshness via the existing `OrchestrationFactSnapshotService` path the scheduler used.) Keep this explicit — do not silently drop freshness.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- orchestration-decision-executor.service.spec.ts`
Expected: PASS. Update other cases in this spec that asserted intent terminalization to assert lease acquire/release instead.

- [ ] **Step 5: Typecheck + commit**

Run: `npm run build:kanban` → PASS.

```bash
git add apps/kanban/src/orchestration/control-plane/orchestration-decision-executor.service.ts apps/kanban/src/orchestration/control-plane/orchestration-decision-executor.service.spec.ts
git commit -m "feat(kanban): lease-gate direct mutations, drop conflict-key intent gate"
```

---

## Task 12: Retarget recovery to release leases + add HTTP endpoint

**Files:**

- Modify: `apps/kanban/src/mcp/tools/mutation/orchestration-reset-intents.tool.ts`
- Modify: `apps/kanban/src/project/project.service.ts`
- Modify: `apps/kanban/src/project/project.controller.ts`
- Test: relevant specs

- [ ] **Step 1: Point `project.service.resetBlockedIntents` at lease release**

Inject `OrchestrationLeaseService` into `ProjectService`. Replace the body of `resetBlockedIntents` (line ~251-257):

```typescript
async resetBlockedIntents(project_id: string): Promise<{ count: number }> {
	const count = await this.leaseService.releaseAllForProject(project_id);
	return { count };
}
```

- [ ] **Step 2: Point the MCP tool at lease release**

In `orchestration-reset-intents.tool.ts`, replace the `scheduler` dependency with `OrchestrationLeaseService` and the call:

```typescript
const count = await this.leaseService.releaseAllForProject(projectId);
return {
  ok: true,
  project_id: projectId,
  reset_count: count,
  message:
    count > 0
      ? `${count} leases released. The next CEO cycle can proceed.`
      : "No active leases found — nothing to release.",
};
```

Update the tool description to reference leases.

- [ ] **Step 3: Add an explicit HTTP `release-all` endpoint**

The existing `POST :project_id/orchestration/reset-intents` now releases leases (via Step 1). Add an alias for clarity in `project.controller.ts`:

```typescript
@Post(":project_id/orchestration/leases/release-all")
async releaseAllLeases(@Param("project_id") project_id: string) {
	const data = await this.projects.resetBlockedIntents(project_id);
	return { success: true, data };
}
```

- [ ] **Step 4: Typecheck + run affected specs + commit**

Run: `npm run build:kanban` → PASS

```bash
git add apps/kanban/src/mcp/tools/mutation/orchestration-reset-intents.tool.ts apps/kanban/src/project/project.service.ts apps/kanban/src/project/project.controller.ts
git commit -m "feat(kanban): recovery releases leases; add HTTP release-all endpoint"
```

---

## Task 13: Delete the dead conflict-key machinery

Now that nothing gates on conflict-key intents, remove them. Aggressive hygiene — no shims.

**Files:**

- Modify: `apps/kanban/src/database/repositories/kanban-orchestration-intent.repository.ts`
- Modify: `apps/kanban/src/orchestration/control-plane/orchestration-control-plane-scheduler.service.ts`
- Modify: `apps/kanban/src/orchestration/control-plane/orchestration-repair-lane.service.ts`
- Tests: the corresponding `.spec.ts` files

- [ ] **Step 1: Delete `findActiveByConflictKeys` and the idempotency resurrection**

In `kanban-orchestration-intent.repository.ts`:

- Delete `findActiveByConflictKeys` (lines ~91-126).
- In `createIntent` (lines ~26-39), delete the terminal-key resurrection branch; an existing terminal intent should simply not block — return a fresh insert with the plain idempotency key, or keep `createIntent` only if still used for the audit journal. If `createIntent` is no longer called anywhere (grep), delete it and `saveNewIntent`/`handleCreateIntentError`/`resolveIdempotencyKey`/`buildIdempotencyKey` too.
- Delete `resetBlockedIntents` (lines ~139-153) — recovery now lives in the lease service.

- [ ] **Step 2: Strip the conflict branch from the scheduler**

In `orchestration-control-plane-scheduler.service.ts`:

- Delete `findActiveConflicts`, `suppressStaleDirectMutations`, `isStaleDirectMutationConflict`, and the `activeConflictResolution` block at the top of `evaluateIntent` (lines ~66-90). `evaluateIntent` keeps only lane-capacity (optional) + fresh-fact checks, or is deleted entirely if `recordExecutableDecision` no longer calls it.
- Delete `resetBlockedIntents` (lines ~205-208) — moved to lease service.
- Delete `DIRECT_MUTATION_REQUESTERS` / `DIRECT_MUTATION_STALE_MS` constants.

- [ ] **Step 3: Stop accumulating `reconcile_stale_links` repair intents**

In `orchestration-repair-lane.service.ts`, delete the path that creates `reconcile_stale_links` intents per terminal run (the design replaces stale-link handling with lease release on terminal). If the service becomes empty, delete it and remove it from `orchestration.module.ts`.

- [ ] **Step 4: Fix reason-masking**

Confirm no remaining path reports a generic `terminalized` instead of the real reason. The new direct-mutation block (Task 11) already surfaces the specific conflicting keys / missing facts.

- [ ] **Step 5: Update/delete affected tests, typecheck**

Run: `npm run build:kanban` and the kanban unit suite:
`npm run test:kanban`
Expected: PASS. Delete tests asserting deleted behavior (conflict-key blocking, resurrection, `resetBlockedIntents` on scheduler).

- [ ] **Step 6: Commit**

```bash
git add apps/kanban/src
git commit -m "refactor(kanban): delete conflict-key intent machinery superseded by leases"
```

---

## Task 14: Integration regression — orphaned lease must not deadlock

Reproduces the 2026-06-12 incident at the model level: an orphaned cycle lease must auto-reclaim so the next cycle launches.

**Files:**

- Create: `apps/kanban/src/orchestration/control-plane/orchestration-lease.integration.spec.ts` (or extend the existing deterministic kanban E2E)

- [ ] **Step 1: Write the test**

```typescript
import { describe, expect, it } from "vitest";
// Boot a NestJS testing module with DatabaseModule + OrchestrationLeaseService
// against the test Postgres (same harness used by other kanban integration specs).

describe("orchestration lease — orphaned holder recovery", () => {
  it("a new acquire succeeds once an orphaned lease passes its TTL", async () => {
    // 1. acquire a cycle lease for project p-test with a tiny ttl and never release it
    const first = await leaseService.acquireCycleLease("p-test", "corr-orphan");
    expect(first.acquired).toBe(true);

    // 2. immediately, a second acquire is blocked
    const blocked = await leaseService.acquireCycleLease("p-test", "corr-2");
    expect(blocked.acquired).toBe(false);

    // 3. force the orphan past its expiry (update expires_at in the past)
    await leaseRepo.expireOverdue(
      new Date(Date.now() + CYCLE_LEASE_TTL_MS + 1000),
    );

    // 4. a fresh acquire now succeeds (lazy reclaim)
    const recovered = await leaseService.acquireCycleLease("p-test", "corr-3");
    expect(recovered.acquired).toBe(true);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm run test --workspace=apps/kanban -- orchestration-lease.integration.spec.ts`
Expected: PASS.

- [ ] **Step 3: Run the deterministic kanban E2E to confirm no regression**

Run: `npm run test:e2e:kanban:deterministic`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/kanban/src/orchestration/control-plane/orchestration-lease.integration.spec.ts
git commit -m "test(kanban): orphaned cycle lease auto-reclaims (incident regression)"
```

---

## Final verification

- [ ] `npm run build:kanban` — PASS
- [ ] `npm run lint:kanban` — PASS (no `eslint-disable`/`@ts-ignore`)
- [ ] `npm run test:kanban` — PASS
- [ ] `npm run test:e2e:kanban:deterministic` — PASS
- [ ] `grep -rn "findActiveByConflictKeys\|hasActiveOrPendingCycle\|reconcile_stale_links" apps/kanban/src` returns nothing in non-test code.
- [ ] Manual: stop a CEO run uncleanly (kill its container), confirm the lease expires and the next wakeup launches a new cycle without operator action.

## Notes for the implementer

- The API-side engine concurrency policy (`apps/api/src/workflow/concurrency-policy.service.ts`, `max_runs:1 on_conflict:skip`) is intentionally left as a silent Core-boundary backstop. Do not remove it; Kanban will not emit a launch event without holding the lease, so it should never fire.
- The **facts/freshness** subsystem is unchanged. Only the conflict-key _locking_ role of intents is removed.
- If `createIntent` survives as the audit journal, ensure it never writes `conflict_keys` that anything reads for blocking — those readers are deleted in Task 13.

```

```
