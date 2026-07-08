# Service Shutdown Pause / Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze in-flight agent containers (workflow-step, chat) when the API/kanban service shuts down and resume them on startup, with a resilient agent→API client as the safety net so rebuilds and crash restarts no longer error running agents.

**Architecture:** A process-wide `ServiceLifecycleStateService` flag (`RUNNING`/`DRAINING`/`BOOTING`) gates the watchdogs. A `ShutdownFreezeCoordinator` (`OnApplicationShutdown`) drains the BullMQ workers and `docker pause`s non-terminal executions, marking them `frozen` in the `executions` table. A `StartupResumeCoordinator` (`OnApplicationBootstrap`) `docker unpause`s them (falling back to the existing session rehydrate path when a container is gone), clears the flag, and emits audit events. A retry/backoff layer in `packages/harness-runtime` covers the un-frozen tail and kanban-only rebuilds. The `executions.frozen` flag is orthogonal to the execution state machine — execution `state` stays `running`, so no transition-table changes are needed.

**Tech Stack:** NestJS 10, TypeORM (Postgres), BullMQ (Redis), dockerode, Vitest/SWC, Vite + React (web), `packages/harness-runtime` (in-container agent runtime, ESM `.js` import suffixes).

---

## Scope notes (locked during planning)

- **In-scope execution kinds for freezing:** `workflow_step`, `workflow_chat`, `adhoc_chat` (from `EXECUTION_KINDS` in `apps/api/src/execution-lifecycle/execution-lifecycle.contracts.ts:1`).
- **Out of scope for freezing:** `subagent` (still protected by the resilience layer, never frozen).
- **No new `ExecutionState`.** `frozen` is a boolean flag; `state` remains `running` while frozen. Audit is via two new domain events (`execution.paused`, `execution.resumed`).
- **Workflow run / chat session status is NOT changed** during freeze/resume. Only the container is paused and the execution row flagged. This keeps the run state machine untouched (YAGNI).
- **Kanban** gets `enableShutdownHooks()` + the resilience client only — it does not own Docker, so it never freezes containers.

## File Structure

**Create:**

- `apps/api/src/database/migrations/20260622000000-add-execution-freeze-columns.ts` — migration adding `paused_at`, `pause_reason`, `frozen`.
- `apps/api/src/execution-lifecycle/service-lifecycle-state.service.ts` — process lifecycle flag + paused registry.
- `apps/api/src/execution-lifecycle/service-lifecycle-state.service.spec.ts`
- `apps/api/src/execution-lifecycle/shutdown-freeze.coordinator.ts` — `OnApplicationShutdown` freeze.
- `apps/api/src/execution-lifecycle/shutdown-freeze.coordinator.spec.ts`
- `apps/api/src/execution-lifecycle/startup-resume.coordinator.ts` — `OnApplicationBootstrap` resume.
- `apps/api/src/execution-lifecycle/startup-resume.coordinator.spec.ts`
- `apps/api/src/execution-lifecycle/freeze.contracts.ts` — shared constants/types for freeze (kinds, env keys, reasons).
- `packages/harness-runtime/src/utils/retry-with-backoff.ts` — reusable retry helper.
- `packages/harness-runtime/src/utils/retry-with-backoff.spec.ts`

**Modify:**

- `apps/api/src/execution-lifecycle/database/entities/execution.entity.ts` — add 3 columns.
- `apps/api/src/execution-lifecycle/database/repositories/execution.repository.ts` — freeze query/mutation methods.
- `apps/api/src/execution-lifecycle/execution-lifecycle.contracts.ts` — add `paused`/`resumed` event types.
- `apps/api/src/execution-lifecycle/execution-event.publisher.ts` — add `paused()`/`resumed()`.
- `apps/api/src/execution-lifecycle/execution-supervisor.service.ts` — skip frozen + lifecycle guard.
- `apps/api/src/execution-lifecycle/execution-lifecycle.module.ts` — register new providers, import Docker.
- `apps/api/src/database/migrations/registered-migrations.ts` — register migration.
- `apps/api/src/workflow/workflow-run-operations/workflow-run-reconciliation.service.ts` — immunise frozen runs + lifecycle guard.
- `apps/api/src/main.ts` and `apps/kanban/src/main.ts` — `enableShutdownHooks()`.
- `packages/harness-runtime/src/tools/api-callback.ts` — use backoff helper.
- `packages/core/src/clients/http-request.ts` — retry on 502/503/connection-refused.
- `docker-compose.yml` — `stop_grace_period` for api/kanban.
- `apps/api/src/operations/operations-doctor.controller.ts` + web Doctor page — surface counts (Task 13).
- `docs/guide/README.md` (or the relevant operations page) + new ADR.

---

## Task 1: Add freeze columns to the executions entity + migration

**Files:**

- Modify: `apps/api/src/execution-lifecycle/database/entities/execution.entity.ts:95-99`
- Create: `apps/api/src/database/migrations/20260622000000-add-execution-freeze-columns.ts`
- Modify: `apps/api/src/database/migrations/registered-migrations.ts:1` and `:54`

- [ ] **Step 1: Add columns to the entity**

In `execution.entity.ts`, after the `terminal_at` column (line 96) and before `@VersionColumn()` (line 98), add:

```typescript
  @Column({ type: 'boolean', default: false })
  frozen!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  paused_at?: Date | null;

  @Column({ type: 'text', nullable: true })
  pause_reason?: string | null;
```

Also add an index for fast freeze-candidate / frozen lookups. After the existing `@Index(['chat_session_id'])` (line 21) add:

```typescript
@Index(['frozen'])
```

- [ ] **Step 2: Write the migration**

Create `apps/api/src/database/migrations/20260622000000-add-execution-freeze-columns.ts`:

```typescript
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddExecutionFreezeColumns20260622000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE executions
        ADD COLUMN IF NOT EXISTS frozen boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS paused_at timestamp,
        ADD COLUMN IF NOT EXISTS pause_reason text;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_executions_frozen" ON executions (frozen);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_executions_frozen";
    `);
    await queryRunner.query(`
      ALTER TABLE executions
        DROP COLUMN IF EXISTS frozen,
        DROP COLUMN IF EXISTS paused_at,
        DROP COLUMN IF EXISTS pause_reason;
    `);
  }
}
```

- [ ] **Step 3: Register the migration**

In `registered-migrations.ts`, add the import at the top (line 1):

```typescript
import { AddExecutionFreezeColumns20260622000000 } from "./20260622000000-add-execution-freeze-columns";
```

And add it as the **first** entry in the `registeredMigrations` array (line 55, before `AddExecutionResolvedConfig20260621000000`):

```typescript
export const registeredMigrations = [
  AddExecutionFreezeColumns20260622000000,
  AddExecutionResolvedConfig20260621000000,
  // ...rest unchanged
```

- [ ] **Step 4: Typecheck**

Run: `npm run build:api`
Expected: builds clean (nest build). If TypeORM complains about the new columns, confirm the entity edits compile.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/execution-lifecycle/database/entities/execution.entity.ts apps/api/src/database/migrations/20260622000000-add-execution-freeze-columns.ts apps/api/src/database/migrations/registered-migrations.ts
git commit -m "feat(execution): add freeze columns (frozen/paused_at/pause_reason) + migration"
```

---

## Task 2: ServiceLifecycleStateService

A tiny injectable holding the process lifecycle phase. Watchdogs consult it; coordinators set it.

**Files:**

- Create: `apps/api/src/execution-lifecycle/service-lifecycle-state.service.ts`
- Create: `apps/api/src/execution-lifecycle/service-lifecycle-state.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `service-lifecycle-state.service.spec.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { ServiceLifecycleStateService } from "./service-lifecycle-state.service";

describe("ServiceLifecycleStateService", () => {
  it("starts in BOOTING and is not accepting work", () => {
    const svc = new ServiceLifecycleStateService();
    expect(svc.phase).toBe("booting");
    expect(svc.isAcceptingWork()).toBe(false);
  });

  it("accepts work only when RUNNING", () => {
    const svc = new ServiceLifecycleStateService();
    svc.markRunning();
    expect(svc.phase).toBe("running");
    expect(svc.isAcceptingWork()).toBe(true);
  });

  it("suspends watchdog reaping while booting or draining", () => {
    const svc = new ServiceLifecycleStateService();
    expect(svc.isReapingSuspended()).toBe(true); // booting
    svc.markRunning();
    expect(svc.isReapingSuspended()).toBe(false);
    svc.markDraining();
    expect(svc.phase).toBe("draining");
    expect(svc.isReapingSuspended()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- service-lifecycle-state`
Expected: FAIL — cannot find module `./service-lifecycle-state.service`.

- [ ] **Step 3: Write the implementation**

Create `service-lifecycle-state.service.ts`:

```typescript
import { Injectable } from "@nestjs/common";

export type ServiceLifecyclePhase = "booting" | "running" | "draining";

/**
 * Process-wide lifecycle phase. Watchdogs consult this to suspend reaping
 * while the service is starting up (resume in progress) or shutting down
 * (freeze in progress); dispatch consults it to stop accepting new work.
 */
@Injectable()
export class ServiceLifecycleStateService {
  private currentPhase: ServiceLifecyclePhase = "booting";

  get phase(): ServiceLifecyclePhase {
    return this.currentPhase;
  }

  markRunning(): void {
    this.currentPhase = "running";
  }

  markDraining(): void {
    this.currentPhase = "draining";
  }

  isAcceptingWork(): boolean {
    return this.currentPhase === "running";
  }

  isReapingSuspended(): boolean {
    return this.currentPhase !== "running";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- service-lifecycle-state`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/execution-lifecycle/service-lifecycle-state.service.ts apps/api/src/execution-lifecycle/service-lifecycle-state.service.spec.ts
git commit -m "feat(execution): add ServiceLifecycleStateService lifecycle phase flag"
```

---

## Task 3: Freeze constants/contracts + repository methods

**Files:**

- Create: `apps/api/src/execution-lifecycle/freeze.contracts.ts`
- Modify: `apps/api/src/execution-lifecycle/database/repositories/execution.repository.ts`
- Create/extend: `apps/api/src/execution-lifecycle/database/repositories/execution.repository.spec.ts`

- [ ] **Step 1: Write the freeze contracts**

Create `freeze.contracts.ts`:

```typescript
import type { ExecutionKind } from "./execution-lifecycle.contracts";

/** Execution kinds eligible for freeze-on-shutdown. Subagents are excluded. */
export const FREEZABLE_EXECUTION_KINDS: readonly ExecutionKind[] = [
  "workflow_step",
  "workflow_chat",
  "adhoc_chat",
] as const;

export const FREEZE_REASON_SHUTDOWN = "service_shutdown";

/** Max wall-clock budget for the shutdown freeze sweep (must be < compose stop_grace_period). */
export const DEFAULT_FREEZE_BUDGET_MS = 20_000;

export function resolveFreezeBudgetMs(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_FREEZE_BUDGET_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_FREEZE_BUDGET_MS;
  return parsed;
}
```

- [ ] **Step 2: Write the failing repository test**

Add to `execution.repository.spec.ts` (create the file if absent, mirroring `testing-unit-patterns`; use an in-memory test repository or a TypeORM-mock). Minimal behaviour test using a fake `Repository`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { ExecutionRepository } from "./execution.repository";
import type { Repository } from "typeorm";
import type { ExecutionEntity } from "../entities/execution.entity";

function makeRepo(rows: Partial<ExecutionEntity>[]) {
  const find = vi.fn().mockResolvedValue(rows);
  const update = vi.fn().mockResolvedValue({ affected: rows.length });
  const inner = { find, update } as unknown as Repository<ExecutionEntity>;
  return { repo: new ExecutionRepository(inner), find, update };
}

describe("ExecutionRepository freeze methods", () => {
  it("markFrozen sets frozen/paused_at/pause_reason", async () => {
    const { repo, update } = makeRepo([]);
    const at = new Date("2026-06-14T00:00:00.000Z");
    await repo.markFrozen("exec-1", "service_shutdown", at);
    expect(update).toHaveBeenCalledWith(
      { id: "exec-1" },
      { frozen: true, paused_at: at, pause_reason: "service_shutdown" },
    );
  });

  it("clearFrozen resets the flag and refreshes heartbeat", async () => {
    const { repo, update } = makeRepo([]);
    const at = new Date("2026-06-14T00:01:00.000Z");
    await repo.clearFrozen("exec-1", at);
    expect(update).toHaveBeenCalledWith(
      { id: "exec-1" },
      {
        frozen: false,
        paused_at: null,
        pause_reason: null,
        last_heartbeat_at: at,
      },
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- execution.repository`
Expected: FAIL — `markFrozen`/`clearFrozen` not a function.

- [ ] **Step 4: Add repository methods**

In `execution.repository.ts`, add these methods to the class (after `findNonTerminal`, around line 40). Add `IsNull` / keep existing `In`, `Not` imports:

```typescript
  /** Non-terminal executions with a live container, eligible for freezing. */
  async findFreezeCandidates(
    kinds: readonly ExecutionKind[],
  ): Promise<ExecutionEntity[]> {
    return this.repository.find({
      where: {
        state: Not(In(TERMINAL_EXECUTION_STATES)),
        kind: In(kinds as ExecutionKind[]),
        container_id: Not(IsNull()),
        frozen: false,
      },
    });
  }

  /** Executions flagged frozen by a prior shutdown, to resume on boot. */
  async findFrozen(): Promise<ExecutionEntity[]> {
    return this.repository.find({ where: { frozen: true } });
  }

  async markFrozen(
    id: string,
    reason: string,
    pausedAt: Date,
  ): Promise<void> {
    await this.repository.update(
      { id },
      { frozen: true, paused_at: pausedAt, pause_reason: reason },
    );
  }

  async clearFrozen(id: string, resumedAt: Date): Promise<void> {
    await this.repository.update(
      { id },
      {
        frozen: false,
        paused_at: null,
        pause_reason: null,
        last_heartbeat_at: resumedAt,
      },
    );
  }
```

Add `ExecutionKind` to the type import at the top (line 5-8) and `IsNull` to the `typeorm` import (line 3):

```typescript
import { In, IsNull, Not, Repository } from "typeorm";
import type {
  ExecutionFailureReason,
  ExecutionKind,
  ExecutionState,
} from "../../execution-lifecycle.contracts";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- execution.repository`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/execution-lifecycle/freeze.contracts.ts apps/api/src/execution-lifecycle/database/repositories/execution.repository.ts apps/api/src/execution-lifecycle/database/repositories/execution.repository.spec.ts
git commit -m "feat(execution): freeze contracts + repository freeze/clear/query methods"
```

---

## Task 4: Add paused/resumed audit events

**Files:**

- Modify: `apps/api/src/execution-lifecycle/execution-lifecycle.contracts.ts:36-51`
- Modify: `apps/api/src/execution-lifecycle/execution-event.publisher.ts`

- [ ] **Step 1: Add event type keys**

In `execution-lifecycle.contracts.ts`, add two entries to `EXECUTION_EVENT_TYPES` (after `retryScheduled`, line 50):

```typescript
  paused: 'execution.paused',
  resumed: 'execution.resumed',
```

- [ ] **Step 2: Add publisher methods**

In `execution-event.publisher.ts`, add after `reaped()` (line 85):

```typescript
  async paused(
    executionId: string,
    payload: { reason: string },
  ): Promise<void> {
    await this.emit(EXECUTION_EVENT_TYPES.paused, executionId, { ...payload });
  }

  async resumed(
    executionId: string,
    payload: { via: 'unpause' | 'rehydrate' },
  ): Promise<void> {
    await this.emit(EXECUTION_EVENT_TYPES.resumed, executionId, { ...payload });
  }
```

- [ ] **Step 3: Typecheck**

Run: `npm run build:api`
Expected: builds clean (the `ExecutionEventType` union picks up the new keys automatically).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/execution-lifecycle/execution-lifecycle.contracts.ts apps/api/src/execution-lifecycle/execution-event.publisher.ts
git commit -m "feat(execution): add execution.paused/resumed domain events"
```

---

## Task 5: Container freeze helper (docker pause)

`ContainerOrchestratorService` already has `resumeContainer()` (handles unpause/start) at `container-orchestrator.service.ts:333`. Add a matching `freezeContainer()` that uses `docker pause`, and a `getContainerState()` probe used by resume.

**Files:**

- Modify: `apps/api/src/docker/container-orchestrator.service.ts`
- Modify/create: `apps/api/src/docker/container-orchestrator.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to the orchestrator spec (mock `Docker` with a `getContainer` returning a stub):

```typescript
import { describe, expect, it, vi } from "vitest";
import { ContainerOrchestratorService } from "./container-orchestrator.service";

describe("ContainerOrchestratorService.freezeContainer", () => {
  it("issues docker pause on the container", async () => {
    const pause = vi.fn().mockResolvedValue(undefined);
    const docker = { getContainer: vi.fn().mockReturnValue({ pause }) };
    const svc = new ContainerOrchestratorService(docker as never);
    await svc.freezeContainer("container-123");
    expect(docker.getContainer).toHaveBeenCalledWith("container-123");
    expect(pause).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- container-orchestrator`
Expected: FAIL — `freezeContainer` not a function.

- [ ] **Step 3: Implement `freezeContainer` + `getContainerRuntimeState`**

In `container-orchestrator.service.ts`, add after `resumeContainer()` (line 345). Note: the existing deprecated `pauseContainer()` (line 327) sends SIGUSR1 — leave it; this is a distinct cgroup-freeze method:

```typescript
  /** Freeze a running container in place via the cgroup freezer (docker pause). */
  async freezeContainer(containerId: string): Promise<void> {
    const container = this.docker.getContainer(containerId);
    await container.pause();
    this.logger.log(`Paused (froze) container ${containerId}`);
  }

  /**
   * Returns the docker runtime status of a container, or 'missing' when the
   * container no longer exists. Used by resume to decide unpause vs rehydrate.
   */
  async getContainerRuntimeState(
    containerId: string,
  ): Promise<'paused' | 'running' | 'stopped' | 'missing'> {
    try {
      const container = this.docker.getContainer(containerId);
      const data = (await container.inspect()) as {
        State: { Status: string; Running: boolean };
      };
      if (data.State.Status === 'paused') return 'paused';
      if (data.State.Running) return 'running';
      return 'stopped';
    } catch {
      return 'missing';
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- container-orchestrator`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/docker/container-orchestrator.service.ts apps/api/src/docker/container-orchestrator.service.spec.ts
git commit -m "feat(docker): freezeContainer (docker pause) + getContainerRuntimeState probe"
```

---

## Task 6: ShutdownFreezeCoordinator

**Files:**

- Create: `apps/api/src/execution-lifecycle/shutdown-freeze.coordinator.ts`
- Create: `apps/api/src/execution-lifecycle/shutdown-freeze.coordinator.spec.ts`

This coordinator depends on a narrow freeze interface (DIP) rather than the whole orchestrator. Define the token + interface inline.

- [ ] **Step 1: Write the failing test**

Create `shutdown-freeze.coordinator.spec.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { ShutdownFreezeCoordinator } from "./shutdown-freeze.coordinator";
import { ServiceLifecycleStateService } from "./service-lifecycle-state.service";

function build() {
  const lifecycle = new ServiceLifecycleStateService();
  lifecycle.markRunning();
  const candidates = [
    { id: "e1", container_id: "c1" },
    { id: "e2", container_id: "c2" },
  ];
  const repo = {
    findFreezeCandidates: vi.fn().mockResolvedValue(candidates),
    markFrozen: vi.fn().mockResolvedValue(undefined),
  };
  const freezer = { freezeContainer: vi.fn().mockResolvedValue(undefined) };
  const publisher = { paused: vi.fn().mockResolvedValue(undefined) };
  const workers = { pauseAll: vi.fn().mockResolvedValue(undefined) };
  const coordinator = new ShutdownFreezeCoordinator(
    lifecycle,
    repo as never,
    freezer as never,
    publisher as never,
    workers as never,
  );
  return { coordinator, lifecycle, repo, freezer, publisher, workers };
}

describe("ShutdownFreezeCoordinator", () => {
  it("drains workers, freezes every candidate container, and marks them frozen", async () => {
    const { coordinator, lifecycle, repo, freezer, publisher, workers } =
      build();
    await coordinator.onApplicationShutdown("SIGTERM");
    expect(lifecycle.phase).toBe("draining");
    expect(workers.pauseAll).toHaveBeenCalledTimes(1);
    expect(freezer.freezeContainer).toHaveBeenCalledWith("c1");
    expect(freezer.freezeContainer).toHaveBeenCalledWith("c2");
    expect(repo.markFrozen).toHaveBeenCalledTimes(2);
    expect(publisher.paused).toHaveBeenCalledTimes(2);
  });

  it("does not fail the shutdown when one container pause errors", async () => {
    const { coordinator, freezer, repo } = build();
    freezer.freezeContainer.mockRejectedValueOnce(new Error("docker down"));
    await expect(
      coordinator.onApplicationShutdown("SIGTERM"),
    ).resolves.toBeUndefined();
    // The healthy one is still frozen.
    expect(repo.markFrozen).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- shutdown-freeze`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the coordinator**

Create `shutdown-freeze.coordinator.ts`:

```typescript
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from "@nestjs/common";
import { ExecutionRepository } from "./database/repositories/execution.repository";
import { ExecutionEventPublisher } from "./execution-event.publisher";
import { ServiceLifecycleStateService } from "./service-lifecycle-state.service";
import {
  FREEZABLE_EXECUTION_KINDS,
  FREEZE_REASON_SHUTDOWN,
  resolveFreezeBudgetMs,
} from "./freeze.contracts";

export const CONTAINER_FREEZER = Symbol("CONTAINER_FREEZER");
export interface ContainerFreezer {
  freezeContainer(containerId: string): Promise<void>;
}

export const STEP_QUEUE_DRAINER = Symbol("STEP_QUEUE_DRAINER");
export interface StepQueueDrainer {
  /** Pause BullMQ workers so no new jobs are pulled during shutdown. */
  pauseAll(): Promise<void>;
}

@Injectable()
export class ShutdownFreezeCoordinator implements OnApplicationShutdown {
  private readonly logger = new Logger(ShutdownFreezeCoordinator.name);
  private readonly budgetMs = resolveFreezeBudgetMs(
    process.env.EXECUTION_FREEZE_BUDGET_MS,
  );

  constructor(
    private readonly lifecycle: ServiceLifecycleStateService,
    private readonly executions: ExecutionRepository,
    @Inject(CONTAINER_FREEZER) private readonly freezer: ContainerFreezer,
    private readonly publisher: ExecutionEventPublisher,
    @Inject(STEP_QUEUE_DRAINER) private readonly queues: StepQueueDrainer,
  ) {}

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.lifecycle.markDraining();
    this.logger.warn(
      `Shutdown (${signal ?? "unknown"}): freezing in-flight executions`,
    );

    try {
      await this.queues.pauseAll();
    } catch (error) {
      this.logger.error(
        `Failed to pause step workers: ${(error as Error).message}`,
      );
    }

    let candidates: Array<{ id: string; container_id?: string | null }>;
    try {
      candidates = await this.executions.findFreezeCandidates(
        FREEZABLE_EXECUTION_KINDS,
      );
    } catch (error) {
      this.logger.error(
        `Could not load freeze candidates: ${(error as Error).message}`,
      );
      return;
    }

    const pausedAt = new Date();
    const deadline = pausedAt.getTime() + this.budgetMs;
    let frozen = 0;
    let skipped = 0;

    for (const execution of candidates) {
      if (!execution.container_id) {
        skipped += 1;
        continue;
      }
      if (Date.now() > deadline) {
        skipped += candidates.length - frozen - skipped;
        this.logger.warn(
          `Freeze budget (${this.budgetMs}ms) exceeded; ${skipped} execution(s) left to the resilience net`,
        );
        break;
      }
      try {
        await this.freezer.freezeContainer(execution.container_id);
        await this.executions.markFrozen(
          execution.id,
          FREEZE_REASON_SHUTDOWN,
          pausedAt,
        );
        await this.publisher.paused(execution.id, {
          reason: FREEZE_REASON_SHUTDOWN,
        });
        frozen += 1;
      } catch (error) {
        skipped += 1;
        this.logger.error(
          `Failed to freeze execution ${execution.id} (container ${execution.container_id}): ${(error as Error).message}`,
        );
      }
    }

    this.logger.warn(
      `Shutdown freeze complete: frozen=${frozen} skipped=${skipped}`,
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- shutdown-freeze`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/execution-lifecycle/shutdown-freeze.coordinator.ts apps/api/src/execution-lifecycle/shutdown-freeze.coordinator.spec.ts
git commit -m "feat(execution): ShutdownFreezeCoordinator freezes in-flight executions on shutdown"
```

---

## Task 7: StartupResumeCoordinator

**Files:**

- Create: `apps/api/src/execution-lifecycle/startup-resume.coordinator.ts`
- Create: `apps/api/src/execution-lifecycle/startup-resume.coordinator.spec.ts`

Depends on a narrow `ContainerResumer` interface (unpause + state probe) and an optional `SessionRehydrator` fallback. Holds a `lastResumeSummary` for the visibility endpoint (Task 13).

- [ ] **Step 1: Write the failing test**

Create `startup-resume.coordinator.spec.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { StartupResumeCoordinator } from "./startup-resume.coordinator";
import { ServiceLifecycleStateService } from "./service-lifecycle-state.service";

function build(states: Record<string, "paused" | "missing">) {
  const lifecycle = new ServiceLifecycleStateService();
  const frozen = Object.keys(states).map((id) => ({
    id,
    container_id: `cont-${id}`,
    workflow_run_id: `run-${id}`,
  }));
  const repo = {
    findFrozen: vi.fn().mockResolvedValue(frozen),
    clearFrozen: vi.fn().mockResolvedValue(undefined),
  };
  const resumer = {
    getContainerRuntimeState: vi.fn((cid: string) =>
      Promise.resolve(states[cid.replace("cont-", "")]),
    ),
    resumeContainer: vi.fn().mockResolvedValue(undefined),
  };
  const rehydrator = { rehydrateAndResume: vi.fn().mockResolvedValue(true) };
  const publisher = { resumed: vi.fn().mockResolvedValue(undefined) };
  const coordinator = new StartupResumeCoordinator(
    lifecycle,
    repo as never,
    resumer as never,
    rehydrator as never,
    publisher as never,
  );
  return { coordinator, lifecycle, repo, resumer, rehydrator, publisher };
}

describe("StartupResumeCoordinator", () => {
  it("unpauses present containers, clears frozen, marks RUNNING", async () => {
    const { coordinator, lifecycle, repo, resumer, publisher } = build({
      a: "paused",
    });
    await coordinator.onApplicationBootstrap();
    expect(resumer.resumeContainer).toHaveBeenCalledWith("cont-a");
    expect(repo.clearFrozen).toHaveBeenCalledWith("a", expect.any(Date));
    expect(publisher.resumed).toHaveBeenCalledWith("a", { via: "unpause" });
    expect(lifecycle.phase).toBe("running");
    expect(coordinator.lastResumeSummary.resumed).toBe(1);
  });

  it("falls back to rehydrate when the container is gone", async () => {
    const { coordinator, resumer, rehydrator, publisher } = build({
      b: "missing",
    });
    await coordinator.onApplicationBootstrap();
    expect(resumer.resumeContainer).not.toHaveBeenCalled();
    expect(rehydrator.rehydrateAndResume).toHaveBeenCalledWith("b");
    expect(publisher.resumed).toHaveBeenCalledWith("b", { via: "rehydrate" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- startup-resume`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the coordinator**

Create `startup-resume.coordinator.ts`:

```typescript
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from "@nestjs/common";
import { ExecutionRepository } from "./database/repositories/execution.repository";
import { ExecutionEventPublisher } from "./execution-event.publisher";
import { ServiceLifecycleStateService } from "./service-lifecycle-state.service";

export const CONTAINER_RESUMER = Symbol("CONTAINER_RESUMER");
export interface ContainerResumer {
  getContainerRuntimeState(
    containerId: string,
  ): Promise<"paused" | "running" | "stopped" | "missing">;
  resumeContainer(containerId: string): Promise<void>;
}

export const SESSION_REHYDRATOR = Symbol("SESSION_REHYDRATOR");
export interface SessionRehydrator {
  /** Re-provision + rehydrate the session for an execution. Returns false if impossible. */
  rehydrateAndResume(executionId: string): Promise<boolean>;
}

export interface ResumeSummary {
  frozenFound: number;
  resumed: number;
  failed: number;
  lastResumeAt: string | null;
}

@Injectable()
export class StartupResumeCoordinator implements OnApplicationBootstrap {
  private readonly logger = new Logger(StartupResumeCoordinator.name);
  lastResumeSummary: ResumeSummary = {
    frozenFound: 0,
    resumed: 0,
    failed: 0,
    lastResumeAt: null,
  };

  constructor(
    private readonly lifecycle: ServiceLifecycleStateService,
    private readonly executions: ExecutionRepository,
    @Inject(CONTAINER_RESUMER) private readonly resumer: ContainerResumer,
    @Inject(SESSION_REHYDRATOR) private readonly rehydrator: SessionRehydrator,
    private readonly publisher: ExecutionEventPublisher,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.resumeFrozen();
    } catch (error) {
      this.logger.error(`Startup resume failed: ${(error as Error).message}`);
    } finally {
      // Always leave the service accepting work, even if resume hit errors —
      // the watchdogs (now released) will recover anything left behind.
      this.lifecycle.markRunning();
    }
  }

  private async resumeFrozen(): Promise<void> {
    const frozen = await this.executions.findFrozen();
    const resumedAt = new Date();
    let resumed = 0;
    let failed = 0;

    for (const execution of frozen) {
      try {
        const containerId = execution.container_id ?? null;
        const state = containerId
          ? await this.resumer.getContainerRuntimeState(containerId)
          : "missing";

        if (
          containerId &&
          (state === "paused" || state === "running" || state === "stopped")
        ) {
          await this.resumer.resumeContainer(containerId);
          await this.executions.clearFrozen(execution.id, new Date());
          await this.publisher.resumed(execution.id, { via: "unpause" });
          resumed += 1;
          continue;
        }

        // Container gone — fall back to rehydrate/re-provision.
        const ok = await this.rehydrator.rehydrateAndResume(execution.id);
        if (ok) {
          await this.executions.clearFrozen(execution.id, new Date());
          await this.publisher.resumed(execution.id, { via: "rehydrate" });
          resumed += 1;
        } else {
          failed += 1;
          this.logger.error(
            `Could not resume execution ${execution.id}: container missing and no rehydratable session`,
          );
        }
      } catch (error) {
        failed += 1;
        this.logger.error(
          `Failed to resume execution ${execution.id}: ${(error as Error).message}`,
        );
      }
    }

    this.lastResumeSummary = {
      frozenFound: frozen.length,
      resumed,
      failed,
      lastResumeAt: resumedAt.toISOString(),
    };
    if (frozen.length > 0) {
      this.logger.warn(
        `Startup resume complete: found=${frozen.length} resumed=${resumed} failed=${failed}`,
      );
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- startup-resume`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/execution-lifecycle/startup-resume.coordinator.ts apps/api/src/execution-lifecycle/startup-resume.coordinator.spec.ts
git commit -m "feat(execution): StartupResumeCoordinator unpauses frozen executions on boot with rehydrate fallback"
```

---

## Task 8: Wire providers into ExecutionLifecycleModule

Bind the new coordinators and the `CONTAINER_FREEZER` / `CONTAINER_RESUMER` / `STEP_QUEUE_DRAINER` / `SESSION_REHYDRATOR` tokens. The freezer/resumer map to `ContainerOrchestratorService`; the drainer wraps the BullMQ workers; the rehydrator wraps the existing session hydration path.

**Files:**

- Modify: `apps/api/src/execution-lifecycle/execution-lifecycle.module.ts`

> **Note for the implementer:** confirm which module owns `ContainerOrchestratorService` (`apps/api/src/docker/`) and `SessionHydrationService` (`apps/api/src/session/`) and import those modules (and export the orchestrator if not already exported). The step-queue drainer needs the BullMQ workers; if the `Worker` instances aren't directly injectable, implement `pauseAll()` by injecting the `workflow-steps` `Queue` and calling the worker pause via the queue's connection, or expose a small `StepWorkerRegistry` from `WorkflowStepExecutionModule`. Verify the actual worker wiring in `apps/api/src/workflow/workflow-step-execution/step-execution.consumer.ts` before implementing — adjust the adapter to match.

- [ ] **Step 1: Add providers**

Edit `execution-lifecycle.module.ts` to import `DockerModule` (or wherever `ContainerOrchestratorService` is provided/exported) and `SessionModule`, and register:

```typescript
import { ServiceLifecycleStateService } from "./service-lifecycle-state.service";
import {
  ShutdownFreezeCoordinator,
  CONTAINER_FREEZER,
  STEP_QUEUE_DRAINER,
} from "./shutdown-freeze.coordinator";
import {
  StartupResumeCoordinator,
  CONTAINER_RESUMER,
  SESSION_REHYDRATOR,
} from "./startup-resume.coordinator";
import { ContainerOrchestratorService } from "../docker/container-orchestrator.service";
// ...plus the queue drainer + rehydrator adapter imports
```

Add to `providers`:

```typescript
    ServiceLifecycleStateService,
    ShutdownFreezeCoordinator,
    StartupResumeCoordinator,
    { provide: CONTAINER_FREEZER, useExisting: ContainerOrchestratorService },
    { provide: CONTAINER_RESUMER, useExisting: ContainerOrchestratorService },
    { provide: STEP_QUEUE_DRAINER, useClass: StepQueueDrainerAdapter },
    { provide: SESSION_REHYDRATOR, useClass: SessionRehydratorAdapter },
```

Add `ServiceLifecycleStateService` to `exports` (the supervisor and reconciliation service in other modules need it).

Create the two thin adapters in the same directory:

- `StepQueueDrainerAdapter implements StepQueueDrainer` — injects the `workflow-steps` worker/queue and pauses it.
- `SessionRehydratorAdapter implements SessionRehydrator` — injects `SessionHydrationService` and calls `rehydrateSession()` + re-provision for the given execution; returns `false` when no stored session exists.

- [ ] **Step 2: Build to verify DI resolves**

Run: `npm run build:api`
Expected: builds clean. Then boot once locally (`docker compose up -d --build api`) and confirm no Nest DI errors in logs (`UnknownDependenciesException`).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/execution-lifecycle/execution-lifecycle.module.ts apps/api/src/execution-lifecycle/*adapter*.ts
git commit -m "feat(execution): wire freeze/resume coordinators and adapter providers"
```

---

## Task 9: Enable shutdown hooks in bootstrap (API + kanban)

NestJS only calls `OnApplicationShutdown` after `app.enableShutdownHooks()`.

**Files:**

- Modify: `apps/api/src/main.ts:91`
- Modify: `apps/kanban/src/main.ts` (locate the equivalent `app.listen` line)

- [ ] **Step 1: API — enable hooks**

In `apps/api/src/main.ts`, before `await app.listen(port);` (line 91):

```typescript
app.enableShutdownHooks();
bootstrapLogger.debug("Shutdown hooks enabled");
```

- [ ] **Step 2: Kanban — enable hooks**

In `apps/kanban/src/main.ts`, add `app.enableShutdownHooks();` before its `app.listen(...)` call. (Kanban has no freeze coordinator — this just lets its modules close BullMQ/DB connections gracefully and is required for the resilience story.)

- [ ] **Step 3: Verify graceful shutdown locally**

Run: `docker compose up -d --build api` while a workflow run is in flight, then watch logs:
Run: `docker compose logs -f api | grep -i "Shutdown freeze\|Startup resume"`
Expected: on the rebuild you see `Shutdown freeze complete: frozen=N` then on boot `Startup resume complete: ... resumed=N`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/main.ts apps/kanban/src/main.ts
git commit -m "feat(bootstrap): enable NestJS shutdown hooks for api and kanban"
```

---

## Task 10: Supervisor — skip frozen executions + lifecycle guard

**Files:**

- Modify: `apps/api/src/execution-lifecycle/execution-supervisor.service.ts`
- Modify: `apps/api/src/execution-lifecycle/execution-lifecycle.module.ts` (inject lifecycle into the factory)

- [ ] **Step 1: Write the failing test**

Add to `execution-supervisor.service.spec.ts` (create if needed):

```typescript
import { describe, expect, it, vi } from "vitest";
import { ExecutionSupervisorService } from "./execution-supervisor.service";
import { ServiceLifecycleStateService } from "./service-lifecycle-state.service";

describe("ExecutionSupervisorService freeze awareness", () => {
  it("never reaps frozen executions and stands down while not RUNNING", async () => {
    const lifecycle = new ServiceLifecycleStateService(); // booting
    const repo = { findNonTerminal: vi.fn().mockResolvedValue([]) };
    const publisher = { reaped: vi.fn() };
    const probe = { isContainerLost: vi.fn().mockResolvedValue(false) };
    const svc = new ExecutionSupervisorService(
      repo as never,
      publisher as never,
      probe as never,
      lifecycle,
    );
    await svc.sweepOnce();
    // Suspended while booting: it should not even query.
    expect(repo.findNonTerminal).not.toHaveBeenCalled();

    lifecycle.markRunning();
    repo.findNonTerminal.mockResolvedValue([
      {
        id: "f",
        kind: "workflow_chat",
        state: "running",
        frozen: true,
        created_at: new Date(0),
        last_heartbeat_at: new Date(0),
        container_id: "c",
      },
    ]);
    await svc.sweepOnce();
    expect(publisher.reaped).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- execution-supervisor`
Expected: FAIL — constructor arity / frozen rows still reaped.

- [ ] **Step 3: Implement guards**

In `execution-supervisor.service.ts`:

- Add `ServiceLifecycleStateService` to the constructor (line 48):

```typescript
  constructor(
    private readonly repo: ExecutionRepository,
    private readonly publisher: ExecutionEventPublisher,
    private readonly docker: ContainerLivenessProbe,
    private readonly lifecycle: ServiceLifecycleStateService,
  ) {}
```

- At the top of `sweepOnce()` (after the `if (this.sweeping) return;` guard, line 76), add:

```typescript
if (this.lifecycle.isReapingSuspended()) return;
```

- Inside the `for (const row of rows)` loop (line 81), skip frozen rows first:

```typescript
if (row.frozen) {
  continue;
}
```

- [ ] **Step 4: Update the module factory**

In `execution-lifecycle.module.ts`, the `ExecutionSupervisorService` `useFactory` (line 24-35) must inject `ServiceLifecycleStateService`:

```typescript
    {
      provide: ExecutionSupervisorService,
      useFactory: (
        repo: ExecutionRepository,
        publisher: ExecutionEventPublisher,
        probe: SubagentContainerLivenessProbe,
        lifecycle: ServiceLifecycleStateService,
      ) => new ExecutionSupervisorService(repo, publisher, probe, lifecycle),
      inject: [
        ExecutionRepository,
        ExecutionEventPublisher,
        SubagentContainerLivenessProbe,
        ServiceLifecycleStateService,
      ],
    },
```

- [ ] **Step 5: Run test + build**

Run: `npm run test --workspace=apps/api -- execution-supervisor`
Expected: PASS.
Run: `npm run build:api`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/execution-lifecycle/execution-supervisor.service.ts apps/api/src/execution-lifecycle/execution-supervisor.service.spec.ts apps/api/src/execution-lifecycle/execution-lifecycle.module.ts
git commit -m "feat(execution): supervisor skips frozen executions and stands down off-RUNNING"
```

---

## Task 11: Reconciliation — immunise frozen runs + lifecycle guard

The stale-run watchdog already immunises runs with active executions (`findRunsWithActiveExecutions`, `workflow-run-reconciliation.service.ts:283`). Frozen executions have a stale heartbeat, so add them as an immunising condition, and skip the whole startup sweep while not RUNNING.

**Files:**

- Modify: `apps/api/src/workflow/workflow-run-operations/workflow-run-reconciliation.service.ts`
- Modify: the module that provides it (import `ServiceLifecycleStateService` — it is exported from `ExecutionLifecycleModule`, so ensure that module is imported where this service lives).

- [ ] **Step 1: Write the failing test**

Add to the reconciliation spec a case asserting a RUNNING run whose only execution is `frozen` is NOT recovered as stale, even past the grace window. Mirror existing spec setup; the key assertion:

```typescript
// run-1 RUNNING, updated_at older than grace, no live/failed queue job,
// its single execution row has frozen=true and a stale heartbeat.
await service.reconcileNow("interval");
expect(runExecution.handleJobFailed).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- workflow-run-reconciliation`
Expected: FAIL — frozen run gets recovered/failed.

- [ ] **Step 3: Implement**

In `workflow-run-reconciliation.service.ts`:

- Inject `ServiceLifecycleStateService` in the constructor (line 56).
- At the top of `reconcileNow` (after the in-flight guard, line 94), add:

```typescript
if (this.lifecycle.isReapingSuspended()) {
  return;
}
```

- In `findRunsWithActiveExecutions` (line 283), treat a frozen execution as active (immunising its run) regardless of heartbeat age. Inside the `for (const execution of executions)` loop (line 297), before the activity check:

```typescript
if (execution.frozen && execution.workflow_run_id) {
  activeRunIds.add(execution.workflow_run_id);
  continue;
}
```

- [ ] **Step 4: Run test + build**

Run: `npm run test --workspace=apps/api -- workflow-run-reconciliation`
Expected: PASS.
Run: `npm run build:api`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-run-operations/workflow-run-reconciliation.service.ts apps/api/src/workflow/workflow-run-operations/*.spec.ts
git commit -m "feat(workflow): stale-run watchdog immunises frozen runs and stands down off-RUNNING"
```

---

## Task 12: Resilience layer — retry/backoff for agent→API calls

**Files:**

- Create: `packages/harness-runtime/src/utils/retry-with-backoff.ts`
- Create: `packages/harness-runtime/src/utils/retry-with-backoff.spec.ts`
- Modify: `packages/harness-runtime/src/tools/api-callback.ts`
- Modify: `packages/core/src/clients/http-request.ts`

- [ ] **Step 1: Write the failing test for the helper**

Create `retry-with-backoff.spec.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { retryWithBackoff } from "./retry-with-backoff.js";

describe("retryWithBackoff", () => {
  it("retries the configured number of times then succeeds", async () => {
    let calls = 0;
    const result = await retryWithBackoff(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("ECONNREFUSED");
        return "ok";
      },
      {
        maxAttempts: 5,
        baseDelayMs: 1,
        maxDelayMs: 4,
        shouldRetry: () => true,
      },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("stops retrying when shouldRetry returns false", async () => {
    let calls = 0;
    await expect(
      retryWithBackoff(
        async () => {
          calls += 1;
          throw new Error("400 bad request");
        },
        {
          maxAttempts: 5,
          baseDelayMs: 1,
          maxDelayMs: 4,
          shouldRetry: () => false,
        },
      ),
    ).rejects.toThrow("400");
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/harness-runtime -- retry-with-backoff`
Expected: FAIL — module not found. (If the workspace has no `test` script, run `npx vitest run packages/harness-runtime/src/utils/retry-with-backoff.spec.ts` from repo root.)

- [ ] **Step 3: Implement the helper**

Create `retry-with-backoff.ts`:

```typescript
export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Return true to retry the given error on the given (1-based) attempt. */
  shouldRetry: (error: unknown, attempt: number) => boolean;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Capped exponential backoff retry. Re-throws the last error when exhausted. */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (
        attempt >= options.maxAttempts ||
        !options.shouldRetry(error, attempt)
      ) {
        break;
      }
      const delay = Math.min(
        options.maxDelayMs,
        options.baseDelayMs * 2 ** (attempt - 1),
      );
      await sleep(delay);
    }
  }
  throw lastError;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/harness-runtime -- retry-with-backoff`
Expected: PASS.

- [ ] **Step 5: Apply backoff in api-callback.ts**

In `packages/harness-runtime/src/tools/api-callback.ts`, the retry loop (lines 87-108) currently `continue`s immediately on `retry`/`network_error` with no delay. Add capped backoff between attempts. Add a constant near line 22:

```typescript
const API_CALLBACK_RETRY_BASE_MS = 500;
const API_CALLBACK_RETRY_MAX_MS = 8_000;
```

Then inside the loop, after a `retry`/`network_error` outcome and before the next iteration, sleep with backoff (only when another attempt remains):

```typescript
if (attemptResult.kind === "retry" || attemptResult.kind === "network_error") {
  if (attemptResult.kind === "network_error") {
    lastErrorMessage = attemptResult.message;
  }
  if (attempt < API_CALLBACK_MAX_ATTEMPTS) {
    const delay = Math.min(
      API_CALLBACK_RETRY_MAX_MS,
      API_CALLBACK_RETRY_BASE_MS * 2 ** (attempt - 1),
    );
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
  }
  continue;
}
```

Also raise `API_CALLBACK_MAX_ATTEMPTS` (line 22) from `3` to a value that covers a rebuild window with backoff — e.g. `6` (attempts at 0/0.5/1/2/4/8s ≈ 15s of coverage). Make it env-configurable:

```typescript
const API_CALLBACK_MAX_ATTEMPTS = Number.parseInt(
  process.env.NEXUS_API_CALLBACK_MAX_ATTEMPTS ?? "6",
  10,
);
```

> **Note:** the existing `API_CALLBACK_RETRIABLE_STATUS_CODES` already includes 502/503/504 — connection-refused already lands in the `network_error` branch and retries. The only gap was the missing backoff delay, which this step fixes.

- [ ] **Step 6: Add retry to the core HTTP client**

In `packages/core/src/clients/http-request.ts`, `sendJsonRequest()` throws immediately on `!response.ok` (line ~36) with no retry. Wrap the fetch in `retryWithBackoff` from a small inline helper (core cannot import from harness-runtime — copy the minimal backoff loop or add an equivalent `packages/core/src/utils/retry-with-backoff.ts` and a unit test). Retry only on connection errors and 502/503/504; never on 4xx. Read the file first and match its existing structure; add a focused unit test asserting it retries a 503 then succeeds and does not retry a 400.

- [ ] **Step 7: Build the touched packages**

Run: `npm run build --workspace=packages/core && npm run build --workspace=packages/harness-runtime`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/harness-runtime/src/utils/retry-with-backoff.ts packages/harness-runtime/src/utils/retry-with-backoff.spec.ts packages/harness-runtime/src/tools/api-callback.ts packages/core/src/clients/http-request.ts packages/core/src/utils/
git commit -m "feat(harness): retry/backoff resilience for agent->API tool calls during restarts"
```

---

## Task 13: Compose stop_grace_period + visibility surface

**Files:**

- Modify: `docker-compose.yml`
- Modify: `apps/api/src/operations/operations-doctor.controller.ts`
- Modify: `apps/web/src/pages/operations/Doctor.tsx`, `apps/web/src/lib/api/client.admin.ts`, `apps/web/src/hooks/useOperationsDoctor.ts`

- [ ] **Step 1: Raise the stop grace period**

In `docker-compose.yml`, under the `api` and `kanban` service definitions, add (Docker default is 10s; freeze budget is 20s, so allow headroom):

```yaml
stop_grace_period: 30s
```

- [ ] **Step 2: Expose the last resume summary**

Add a read-only endpoint that returns `StartupResumeCoordinator.lastResumeSummary`. In `operations-doctor.controller.ts` (or a small new `operations-lifecycle.controller.ts` in the same module), inject `StartupResumeCoordinator` and add:

```typescript
  @Get('lifecycle/resume-summary')
  getResumeSummary(): ResumeSummary {
    return this.resumeCoordinator.lastResumeSummary;
  }
```

Ensure `StartupResumeCoordinator` is exported from `ExecutionLifecycleModule` and that module is imported by the operations module. Add a controller/e2e test asserting the endpoint returns the summary shape.

- [ ] **Step 3: Surface counts in the web Doctor page**

- Add `getLifecycleResumeSummary()` to `apps/web/src/lib/api/client.admin.ts` (GET `/operations/doctor/lifecycle/resume-summary`, mirroring the existing `getDoctorReportEnvelope` at line 390).
- Add a `useLifecycleResumeSummary()` hook in `apps/web/src/hooks/useOperationsDoctor.ts` mirroring `useDoctorReport` (line 16).
- In `apps/web/src/pages/operations/Doctor.tsx`, render a small panel: `Last restart resumed {resumed}/{frozenFound} executions ({failed} failed) at {lastResumeAt}`. Guard on `lastResumeAt !== null`.

- [ ] **Step 4: Run web unit tests + build**

Run: `npm run test:unit:web`
Run: `npm run build:web`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml apps/api/src/operations/ apps/web/src/pages/operations/Doctor.tsx apps/web/src/lib/api/client.admin.ts apps/web/src/hooks/useOperationsDoctor.ts
git commit -m "feat(ops): raise stop_grace_period and surface restart resume summary in Doctor page"
```

---

## Task 14: End-to-end verification + documentation

**Files:**

- Create: `docs/architecture/adr/ADR-XXXX-service-shutdown-pause-resume.md` (next ADR number)
- Modify: `docs/guide/README.md` (operations/lifecycle section) and `docs/operations/README.md`

- [ ] **Step 1: Manual E2E (the actual bug)**

Start the stack, launch a workflow with a long-running agent step, then rebuild the API mid-run:

```bash
docker compose up -d --build
# launch a workflow run via the UI or API; confirm an agent container is RUNNING
docker compose up -d --build api
docker compose logs --since=2m api | grep -i "freeze\|resume"
```

Expected: `Shutdown freeze complete: frozen>=1`, then on boot `Startup resume complete: ... resumed>=1`, the agent container shows `paused` then `running` (`docker ps -a`), and the workflow run continues without an agent error.

- [ ] **Step 2: Full quality gates**

Run: `npm run lint:summary`
Run: `npm run test:api`
Run: `npm run test:unit:web`
Run: `npm run build:api && npm run build:kanban && npm run build:web`
Expected: all green.

- [ ] **Step 3: Write the ADR**

Document context (agents error on API rebuild), decision (hybrid freeze-in-place via `docker pause` + resilience + rehydrate fallback; `frozen` flag orthogonal to state machine; no run-status change), and consequences (memory held while paused; subagents not frozen; relies on agent containers surviving the API rebuild). Reference the design spec at `docs/superpowers/specs/2026-06-14-service-shutdown-pause-resume-design.md`.

- [ ] **Step 4: Update the guide + operations docs**

Add a "Service shutdown freeze/resume" subsection describing the lifecycle phases, the `executions.frozen` flag, the resume-summary endpoint, and the relevant env vars (`EXECUTION_FREEZE_BUDGET_MS`, `NEXUS_API_CALLBACK_MAX_ATTEMPTS`, `WORKFLOW_STALE_RUN_GRACE_MS`).

- [ ] **Step 5: Commit**

```bash
git add docs/
git commit -m "docs(ops): ADR + guide for service shutdown pause/resume"
```

---

## Self-Review notes

- **Spec coverage:** shutdown freeze (Tasks 6, 9), startup resume + rehydrate fallback (Task 7), resilience net (Task 12), watchdog coordination (Tasks 10, 11), data model (Task 1), audit events (Task 4), visibility (Task 13), compose grace (Task 13), docs/ADR (Task 14). Durable-await immunisation is covered by the lifecycle `isReapingSuspended()` guard added to the supervisor and reconciliation services (Tasks 10, 11) — the await reconciler's bounded-retry logic also keys off the same lifecycle service if needed; add the guard there if its first sweep proves to mis-resume during boot (verify during Task 11).
- **Subagents** are deliberately excluded from `FREEZABLE_EXECUTION_KINDS` (Task 3) and protected only by the resilience layer (Task 12).
- **Kanban** only gets `enableShutdownHooks()` (Task 9) + resilience (Task 12); it owns no Docker, so no freeze coordinator — preserving the core/kanban boundary.
- **Open verification items flagged inline:** exact BullMQ worker pause wiring (Task 8), `SessionHydrationService.rehydrateSession` re-provision signature for the adapter (Task 8), and the await-reconciler boot guard (Task 11). The implementer must read those files before writing the adapters.

```

```
