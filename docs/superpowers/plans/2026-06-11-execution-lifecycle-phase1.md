# Execution Lifecycle Phase 1 — Event-Sourcing Spine + Activity-Aware Subagent Supervision — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the event-sourced execution-lifecycle spine (one `Execution` aggregate, one projection, one event publisher, one projector) and use it to supervise subagents with activity-aware reaping and truthful, structured failure attribution — so a healthy long-running subagent is never killed by a flat wall-clock timeout and never mislabeled "orphaned."

**Architecture:** Lifecycle facts become `execution.*` domain events published through the **already-wired** `OutboxDomainEventBus` (durable outbox + in-process fanout). A single `ExecutionProjector` is the only writer of the new `executions` read-model table, applying events as guarded state-machine transitions. A single `ExecutionSupervisorService` reads that projection (plus Docker truth) and emits `execution.reaped` for genuinely idle/dead/runaway executions only. Subagent lifecycle sites emit lifecycle events and a throttled heartbeat from the telemetry seam. The legacy `SubagentExecutionReaperService` wall-clock 30-minute cap is removed and replaced by the supervisor's idle threshold + a generous hard ceiling; a thin listener mirrors terminal state to the legacy `subagent_executions`/`chat_sessions` rows during migration (dual-write).

**Tech Stack:** NestJS + TypeORM (PostgreSQL) for `apps/api`; BullMQ unchanged here; the existing `apps/api/src/domain-events/` outbox bus; Vitest for tests. Source-of-truth design in `docs/specs/SDD-unified-execution-lifecycle.md`; root-cause in `docs/analysis/2026-06-11-execution-lifecycle-reaper-redesign.md`.

**Scope note:** This is SDD Phase 1 (the incident-fixing, foundation-laying slice). Converging chat sessions and workflow steps onto async dispatch (SDD Phases 2–3) and retiring the legacy tables (Phase 4) are **separate later plans**. This plan keeps legacy tables authoritative and dual-writes the projection, so it is independently shippable and revertible.

---

## Conventions (read once)

- **Run one api test file:** `cd apps/api && npx vitest run --config vitest.config.ts <relative-spec-path>`
- **Typecheck api:** `cd apps/api && npx tsc --noEmit -p tsconfig.json`
- **Apply migrations:** `docker restart nexus-api` (migrations run on boot; `TYPEORM_MIGRATIONS_RUN` is unset ⇒ true).
- **Inspect DB:** `docker exec nexus-postgres psql -U nexus -d nexus_orchestrator -c "<sql>"`
- New code lives under `apps/api/src/execution-lifecycle/`. Keep enums/contracts api-local for this phase; migrating them to `packages/core` happens when chat/workflow consume them (SDD Phase 2+).

---

## File Structure

**New module `apps/api/src/execution-lifecycle/`:**

- `execution-lifecycle.contracts.ts` — `ExecutionKind`, `ExecutionState`, `ExecutionFailureReason`, `EXECUTION_EVENT_TYPES`, payload types.
- `execution-transition.helpers.ts` — pure `isLegalTransition(from, to)` + `TERMINAL_EXECUTION_STATES`.
- `execution-supervision.helpers.ts` — pure `classifyExecutionForReaping(input)` decision function.
- `database/entities/execution.entity.ts` — the `executions` projection entity.
- `database/repositories/execution.repository.ts` — `findById`, `findNonTerminal`, `create`, `applyTransition` (optimistic version).
- `execution-event.publisher.ts` — builds + publishes `execution.*` envelopes via `OutboxDomainEventBus`.
- `execution.projector.ts` — registers handlers on `InProcessDomainEventBus`, applies events to the repo.
- `execution-supervisor.service.ts` — periodic sweep; emits `execution.reaped`.
- `execution-legacy-cascade.listener.ts` — mirrors terminal `executions` state to `subagent_executions` + `chat_sessions`.
- `execution-lifecycle.module.ts` — wires the above.

**Migrations (`apps/api/src/database/migrations/`):**

- `20260615000000-create-executions.ts` — the projection table.
- Modify `registered-migrations.ts` — register it.

**Subagent integration (`apps/api/src/workflow/workflow-subagents/`):**

- Modify `subagent-orchestrator.spawn.operations.ts` — emit `execution.created`/`provisioned`/`running`.
- Modify `subagent-orchestrator.runtime.operations.ts` — emit `execution.completed`/`failed`.
- Modify `subagent-execution-reaper.service.ts` — remove the wall-clock running-timeout branch (supervisor owns it).

**Telemetry heartbeat (`apps/api/src/telemetry/`):**

- Modify `telemetry-gateway-runtime.helpers.ts` — emit `execution.heartbeat` for subagent telemetry/tool/turn events.

---

## Task 1: Execution lifecycle contracts

Pure type/enum module — the vocabulary every later task depends on.

**Files:**

- Create: `apps/api/src/execution-lifecycle/execution-lifecycle.contracts.ts`
- Test: `apps/api/src/execution-lifecycle/execution-lifecycle.contracts.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import {
  EXECUTION_STATES,
  EXECUTION_FAILURE_REASONS,
  EXECUTION_EVENT_TYPES,
} from "./execution-lifecycle.contracts";

describe("execution-lifecycle.contracts", () => {
  it("exposes the full state set", () => {
    expect(EXECUTION_STATES).toEqual([
      "pending",
      "provisioning",
      "running",
      "awaiting_input",
      "completing",
      "completed",
      "failed",
      "reaped",
      "cancelled",
      "retry_scheduled",
    ]);
  });

  it("exposes the closed failure taxonomy including never_dispatched", () => {
    expect(EXECUTION_FAILURE_REASONS).toContain("idle_timeout");
    expect(EXECUTION_FAILURE_REASONS).toContain("max_runtime_exceeded");
    expect(EXECUTION_FAILURE_REASONS).toContain("container_lost");
    expect(EXECUTION_FAILURE_REASONS).toContain("never_dispatched");
  });

  it("namespaces every event type under execution.", () => {
    for (const type of Object.values(EXECUTION_EVENT_TYPES)) {
      expect(type.startsWith("execution.")).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/execution-lifecycle/execution-lifecycle.contracts.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
export const EXECUTION_KINDS = [
  "workflow_step",
  "workflow_chat",
  "adhoc_chat",
  "subagent",
] as const;
export type ExecutionKind = (typeof EXECUTION_KINDS)[number];

export const EXECUTION_STATES = [
  "pending",
  "provisioning",
  "running",
  "awaiting_input",
  "completing",
  "completed",
  "failed",
  "reaped",
  "cancelled",
  "retry_scheduled",
] as const;
export type ExecutionState = (typeof EXECUTION_STATES)[number];

export const EXECUTION_FAILURE_REASONS = [
  "provision_failed",
  "idle_timeout",
  "max_runtime_exceeded",
  "container_lost",
  "agent_error",
  "step_failed",
  "cancelled_by_user",
  "parent_terminated",
  "never_dispatched",
] as const;
export type ExecutionFailureReason = (typeof EXECUTION_FAILURE_REASONS)[number];

export const EXECUTION_AGGREGATE_TYPE = "execution";

export const EXECUTION_EVENT_TYPES = {
  created: "execution.created",
  provisioning: "execution.provisioning",
  provisioned: "execution.provisioned",
  provisionFailed: "execution.provision_failed",
  running: "execution.running",
  heartbeat: "execution.heartbeat",
  awaitingInput: "execution.awaiting_input",
  inputReceived: "execution.input_received",
  completionSignaled: "execution.completion_signaled",
  completed: "execution.completed",
  failed: "execution.failed",
  reaped: "execution.reaped",
  cancelled: "execution.cancelled",
  retryScheduled: "execution.retry_scheduled",
} as const;

export type ExecutionEventType =
  (typeof EXECUTION_EVENT_TYPES)[keyof typeof EXECUTION_EVENT_TYPES];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/execution-lifecycle/execution-lifecycle.contracts.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/execution-lifecycle/execution-lifecycle.contracts.ts apps/api/src/execution-lifecycle/execution-lifecycle.contracts.spec.ts
git commit -m "feat(execution-lifecycle): add lifecycle state/kind/failure contracts"
```

---

## Task 2: Pure transition rules

The state machine as a pure function — the projector's guard and the single definition of legal edges.

**Files:**

- Create: `apps/api/src/execution-lifecycle/execution-transition.helpers.ts`
- Test: `apps/api/src/execution-lifecycle/execution-transition.helpers.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import {
  isLegalTransition,
  isTerminalState,
  TERMINAL_EXECUTION_STATES,
} from "./execution-transition.helpers";

describe("execution transitions", () => {
  it("marks terminal states", () => {
    expect(TERMINAL_EXECUTION_STATES).toEqual([
      "completed",
      "failed",
      "reaped",
      "cancelled",
    ]);
    expect(isTerminalState("reaped")).toBe(true);
    expect(isTerminalState("running")).toBe(false);
  });

  it("allows pending -> provisioning -> running", () => {
    expect(isLegalTransition("pending", "provisioning")).toBe(true);
    expect(isLegalTransition("provisioning", "running")).toBe(true);
  });

  it("allows running <-> awaiting_input and running -> completing", () => {
    expect(isLegalTransition("running", "awaiting_input")).toBe(true);
    expect(isLegalTransition("awaiting_input", "running")).toBe(true);
    expect(isLegalTransition("running", "completing")).toBe(true);
  });

  it("allows reaping from any non-terminal active state", () => {
    expect(isLegalTransition("running", "reaped")).toBe(true);
    expect(isLegalTransition("provisioning", "reaped")).toBe(true);
  });

  it("forbids leaving a terminal state", () => {
    expect(isLegalTransition("completed", "running")).toBe(false);
    expect(isLegalTransition("reaped", "failed")).toBe(false);
  });

  it("treats a self-transition as legal only for running heartbeat refresh", () => {
    expect(isLegalTransition("running", "running")).toBe(true);
    expect(isLegalTransition("completed", "completed")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/execution-lifecycle/execution-transition.helpers.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { ExecutionState } from "./execution-lifecycle.contracts";

export const TERMINAL_EXECUTION_STATES: ExecutionState[] = [
  "completed",
  "failed",
  "reaped",
  "cancelled",
];

export function isTerminalState(state: ExecutionState): boolean {
  return TERMINAL_EXECUTION_STATES.includes(state);
}

const LEGAL_EDGES: Record<ExecutionState, ExecutionState[]> = {
  pending: ["provisioning", "reaped", "cancelled", "retry_scheduled"],
  provisioning: ["running", "failed", "reaped", "cancelled"],
  running: [
    "running",
    "awaiting_input",
    "completing",
    "failed",
    "reaped",
    "cancelled",
  ],
  awaiting_input: ["running", "completing", "failed", "reaped", "cancelled"],
  completing: ["completed", "failed", "reaped"],
  retry_scheduled: ["pending", "provisioning", "cancelled", "reaped"],
  completed: [],
  failed: [],
  reaped: [],
  cancelled: [],
};

export function isLegalTransition(
  from: ExecutionState,
  to: ExecutionState,
): boolean {
  return LEGAL_EDGES[from].includes(to);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/execution-lifecycle/execution-transition.helpers.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/execution-lifecycle/execution-transition.helpers.ts apps/api/src/execution-lifecycle/execution-transition.helpers.spec.ts
git commit -m "feat(execution-lifecycle): add pure state-machine transition rules"
```

---

## Task 3: Execution projection entity

**Files:**

- Create: `apps/api/src/execution-lifecycle/database/entities/execution.entity.ts`
- Test: `apps/api/src/execution-lifecycle/database/entities/execution.entity.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { ExecutionEntity } from "./execution.entity";

describe("ExecutionEntity", () => {
  it("constructs with lifecycle fields and a dedicated terminal_at separate from updated_at", () => {
    const row = new ExecutionEntity();
    row.kind = "subagent";
    row.state = "running";
    row.version = 0;
    expect(row.kind).toBe("subagent");
    expect(row.state).toBe("running");
    // terminal_at and last_heartbeat_at are distinct optional columns
    expect("terminal_at" in row).toBe(true);
    expect("last_heartbeat_at" in row).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/execution-lifecycle/database/entities/execution.entity.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from "typeorm";
import type {
  ExecutionFailureReason,
  ExecutionKind,
  ExecutionState,
} from "../../execution-lifecycle.contracts";

@Entity("executions")
@Index(["state"])
@Index(["kind", "state"])
@Index(["state", "last_heartbeat_at"])
@Index(["workflow_run_id"])
@Index(["chat_session_id"])
export class ExecutionEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 32 })
  kind!: ExecutionKind;

  @Column({ type: "uuid", nullable: true })
  parent_execution_id?: string | null;

  @Column({ type: "uuid", nullable: true })
  workflow_run_id?: string | null;

  @Column({ type: "uuid", nullable: true })
  chat_session_id?: string | null;

  @Column({ type: "uuid", nullable: true })
  scope_id?: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  context_id?: string | null;

  @Column({ type: "varchar", length: 128, nullable: true })
  container_id?: string | null;

  @Column({ type: "smallint", default: 2 })
  container_tier!: number;

  @Column({ type: "varchar", length: 32, default: "pending" })
  state!: ExecutionState;

  @Column({ type: "varchar", length: 48, nullable: true })
  failure_reason?: ExecutionFailureReason | null;

  @Column({ type: "text", nullable: true })
  error_message?: string | null;

  @Column({ type: "timestamp", nullable: true })
  last_heartbeat_at?: Date | null;

  @Column({ type: "int", default: 0 })
  attempt!: number;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  @Column({ type: "timestamp", nullable: true })
  terminal_at?: Date | null;

  @VersionColumn()
  version!: number;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/execution-lifecycle/database/entities/execution.entity.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/execution-lifecycle/database/entities/execution.entity.ts apps/api/src/execution-lifecycle/database/entities/execution.entity.spec.ts
git commit -m "feat(execution-lifecycle): add executions projection entity"
```

---

## Task 4: `executions` table migration

**Files:**

- Create: `apps/api/src/database/migrations/20260615000000-create-executions.ts`
- Modify: `apps/api/src/database/migrations/registered-migrations.ts`

- [ ] **Step 1: Write the migration**

```typescript
import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateExecutions20260615000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS executions (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "kind" varchar(32) NOT NULL,
        "parent_execution_id" uuid,
        "workflow_run_id" uuid,
        "chat_session_id" uuid,
        "scope_id" uuid,
        "context_id" varchar(255),
        "container_id" varchar(128),
        "container_tier" smallint NOT NULL DEFAULT 2,
        "state" varchar(32) NOT NULL DEFAULT 'pending',
        "failure_reason" varchar(48),
        "error_message" text,
        "last_heartbeat_at" timestamp,
        "attempt" integer NOT NULL DEFAULT 0,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        "terminal_at" timestamp,
        "version" integer NOT NULL DEFAULT 1,
        CONSTRAINT "PK_executions_id" PRIMARY KEY ("id")
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_executions_state" ON executions ("state");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_executions_kind_state" ON executions ("kind","state");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_executions_state_heartbeat" ON executions ("state","last_heartbeat_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_executions_workflow_run_id" ON executions ("workflow_run_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_executions_chat_session_id" ON executions ("chat_session_id");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS executions;`);
  }
}
```

- [ ] **Step 2: Register the migration**

In `apps/api/src/database/migrations/registered-migrations.ts`, add the import at the top (newest first, matching existing ordering):

```typescript
import { CreateExecutions20260615000000 } from "./20260615000000-create-executions";
```

and add `CreateExecutions20260615000000,` as the first entry of the `registeredMigrations` array.

- [ ] **Step 3: Typecheck**

Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Apply + verify**

```bash
docker restart nexus-api && sleep 25
docker exec nexus-postgres psql -U nexus -d nexus_orchestrator -c "SELECT to_regclass('public.executions');"
```

Expected: `executions` (not null).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/database/migrations/20260615000000-create-executions.ts apps/api/src/database/migrations/registered-migrations.ts
git commit -m "feat(execution-lifecycle): create executions projection table"
```

---

## Task 5: Execution repository

`applyTransition` is the only mutation path; it enforces legality and optimistic version.

**Files:**

- Create: `apps/api/src/execution-lifecycle/database/repositories/execution.repository.ts`
- Test: `apps/api/src/execution-lifecycle/database/repositories/execution.repository.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { ExecutionRepository } from "./execution.repository";
import type { ExecutionEntity } from "../entities/execution.entity";

function fakeRepo() {
  const rows = new Map<string, ExecutionEntity>();
  return {
    rows,
    findOne: vi.fn(
      async ({ where: { id } }: { where: { id: string } }) =>
        rows.get(id) ?? null,
    ),
    save: vi.fn(async (row: ExecutionEntity) => {
      rows.set(row.id, row);
      return row;
    }),
    find: vi.fn(async () => Array.from(rows.values())),
  };
}

describe("ExecutionRepository.applyTransition", () => {
  it("writes a legal transition and bumps state", async () => {
    const inner = fakeRepo();
    inner.rows.set("e1", {
      id: "e1",
      kind: "subagent",
      state: "running",
      version: 1,
    } as ExecutionEntity);
    const repo = new ExecutionRepository(inner as never);

    const result = await repo.applyTransition("e1", "reaped", {
      failure_reason: "idle_timeout",
      error_message: "no heartbeat",
    });

    expect(result?.state).toBe("reaped");
    expect(result?.failure_reason).toBe("idle_timeout");
    expect(result?.terminal_at).toBeInstanceOf(Date);
  });

  it("no-ops an illegal transition (already terminal)", async () => {
    const inner = fakeRepo();
    inner.rows.set("e1", {
      id: "e1",
      kind: "subagent",
      state: "completed",
      version: 1,
    } as ExecutionEntity);
    const repo = new ExecutionRepository(inner as never);

    const result = await repo.applyTransition("e1", "reaped", {
      failure_reason: "idle_timeout",
    });

    expect(result).toBeNull();
    expect(inner.save).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/execution-lifecycle/database/repositories/execution.repository.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Not, Repository } from "typeorm";
import { ExecutionEntity } from "../entities/execution.entity";
import type {
  ExecutionFailureReason,
  ExecutionState,
} from "../../execution-lifecycle.contracts";
import {
  isLegalTransition,
  isTerminalState,
  TERMINAL_EXECUTION_STATES,
} from "../../execution-transition.helpers";

interface TransitionPatch {
  failure_reason?: ExecutionFailureReason | null;
  error_message?: string | null;
  container_id?: string | null;
  last_heartbeat_at?: Date | null;
}

@Injectable()
export class ExecutionRepository {
  constructor(
    @InjectRepository(ExecutionEntity)
    private readonly repository: Repository<ExecutionEntity>,
  ) {}

  async findById(id: string): Promise<ExecutionEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findNonTerminal(): Promise<ExecutionEntity[]> {
    return this.repository.find({
      where: { state: Not(In(TERMINAL_EXECUTION_STATES)) },
    });
  }

  async create(data: Partial<ExecutionEntity>): Promise<ExecutionEntity> {
    return this.repository.save(this.repository.create(data));
  }

  async applyTransition(
    id: string,
    to: ExecutionState,
    patch: TransitionPatch = {},
  ): Promise<ExecutionEntity | null> {
    const row = await this.findById(id);
    if (!row || !isLegalTransition(row.state, to)) {
      return null;
    }
    row.state = to;
    if (patch.failure_reason !== undefined)
      row.failure_reason = patch.failure_reason;
    if (patch.error_message !== undefined)
      row.error_message = patch.error_message;
    if (patch.container_id !== undefined) row.container_id = patch.container_id;
    if (patch.last_heartbeat_at !== undefined)
      row.last_heartbeat_at = patch.last_heartbeat_at;
    if (isTerminalState(to)) {
      row.terminal_at = new Date();
    }
    return this.repository.save(row);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/execution-lifecycle/database/repositories/execution.repository.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/execution-lifecycle/database/repositories/execution.repository.ts apps/api/src/execution-lifecycle/database/repositories/execution.repository.spec.ts
git commit -m "feat(execution-lifecycle): add execution repository with guarded transitions"
```

---

## Task 6: Execution event publisher

Builds `DomainEventEnvelope`s and publishes them through the existing `OutboxDomainEventBus`.

**Files:**

- Create: `apps/api/src/execution-lifecycle/execution-event.publisher.ts`
- Test: `apps/api/src/execution-lifecycle/execution-event.publisher.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { ExecutionEventPublisher } from "./execution-event.publisher";
import { EXECUTION_EVENT_TYPES } from "./execution-lifecycle.contracts";

describe("ExecutionEventPublisher", () => {
  it("publishes a heartbeat envelope with execution aggregate identity", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const pub = new ExecutionEventPublisher({ publish } as never);

    await pub.heartbeat("exec-1", { source: "telemetry" });

    expect(publish).toHaveBeenCalledTimes(1);
    const envelope = publish.mock.calls[0][0];
    expect(envelope.eventType).toBe(EXECUTION_EVENT_TYPES.heartbeat);
    expect(envelope.aggregateType).toBe("execution");
    expect(envelope.aggregateId).toBe("exec-1");
    expect(typeof envelope.eventId).toBe("string");
    expect(envelope.occurredAt).toBeInstanceOf(Date);
  });

  it("publishes a reaped envelope carrying failure_reason", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const pub = new ExecutionEventPublisher({ publish } as never);

    await pub.reaped("exec-1", {
      failure_reason: "idle_timeout",
      error_message: "no heartbeat for 20m",
    });

    const envelope = publish.mock.calls[0][0];
    expect(envelope.eventType).toBe(EXECUTION_EVENT_TYPES.reaped);
    expect(envelope.payload.failure_reason).toBe("idle_timeout");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/execution-lifecycle/execution-event.publisher.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { OutboxDomainEventBus } from "../domain-events/outbox-domain-event.bus";
import type { DomainEventEnvelope } from "../domain-events/domain-event-bus.types";
import {
  EXECUTION_AGGREGATE_TYPE,
  EXECUTION_EVENT_TYPES,
  type ExecutionEventType,
  type ExecutionFailureReason,
  type ExecutionKind,
} from "./execution-lifecycle.contracts";

interface CreatedPayload {
  kind: ExecutionKind;
  parent_execution_id?: string | null;
  workflow_run_id?: string | null;
  chat_session_id?: string | null;
  container_tier?: number;
}

interface FailurePayload {
  failure_reason: ExecutionFailureReason;
  error_message?: string | null;
}

@Injectable()
export class ExecutionEventPublisher {
  constructor(private readonly bus: OutboxDomainEventBus) {}

  private async emit(
    eventType: ExecutionEventType,
    executionId: string,
    payload: Record<string, unknown>,
    correlationId?: string,
  ): Promise<void> {
    const envelope: DomainEventEnvelope = {
      eventId: randomUUID(),
      eventType,
      aggregateId: executionId,
      aggregateType: EXECUTION_AGGREGATE_TYPE,
      payload,
      correlationId,
      occurredAt: new Date(),
    };
    await this.bus.publish(envelope);
  }

  async created(executionId: string, payload: CreatedPayload): Promise<void> {
    await this.emit(EXECUTION_EVENT_TYPES.created, executionId, { ...payload });
  }

  async provisioned(executionId: string, containerId: string): Promise<void> {
    await this.emit(EXECUTION_EVENT_TYPES.provisioned, executionId, {
      container_id: containerId,
    });
  }

  async running(executionId: string): Promise<void> {
    await this.emit(EXECUTION_EVENT_TYPES.running, executionId, {});
  }

  async heartbeat(
    executionId: string,
    payload: { source: string },
  ): Promise<void> {
    await this.emit(EXECUTION_EVENT_TYPES.heartbeat, executionId, {
      ...payload,
    });
  }

  async completed(executionId: string): Promise<void> {
    await this.emit(EXECUTION_EVENT_TYPES.completed, executionId, {});
  }

  async failed(executionId: string, payload: FailurePayload): Promise<void> {
    await this.emit(EXECUTION_EVENT_TYPES.failed, executionId, { ...payload });
  }

  async reaped(executionId: string, payload: FailurePayload): Promise<void> {
    await this.emit(EXECUTION_EVENT_TYPES.reaped, executionId, { ...payload });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/execution-lifecycle/execution-event.publisher.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/execution-lifecycle/execution-event.publisher.ts apps/api/src/execution-lifecycle/execution-event.publisher.spec.ts
git commit -m "feat(execution-lifecycle): add execution event publisher over the outbox bus"
```

---

## Task 7: Execution projector

The only writer of the `executions` table. Subscribes to `execution.*` on the in-process fanout and applies each event as a guarded transition.

**Files:**

- Create: `apps/api/src/execution-lifecycle/execution.projector.ts`
- Test: `apps/api/src/execution-lifecycle/execution.projector.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { ExecutionProjector } from "./execution.projector";
import { EXECUTION_EVENT_TYPES } from "./execution-lifecycle.contracts";

function fakeBus() {
  const handlers = new Map<string, (e: unknown) => Promise<void>>();
  return {
    handlers,
    on: vi.fn((type: string, h: (e: unknown) => Promise<void>) =>
      handlers.set(type, h),
    ),
    fire: (type: string, e: unknown) => handlers.get(type)!(e),
  };
}

function fakeRepo() {
  return {
    create: vi.fn().mockResolvedValue(undefined),
    applyTransition: vi.fn().mockResolvedValue(undefined),
  };
}

describe("ExecutionProjector", () => {
  it("creates a row on execution.created", async () => {
    const bus = fakeBus();
    const repo = fakeRepo();
    const projector = new ExecutionProjector(bus as never, repo as never);
    projector.onModuleInit();

    await bus.fire(EXECUTION_EVENT_TYPES.created, {
      aggregateId: "e1",
      payload: { kind: "subagent", workflow_run_id: "r1" },
    });

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: "e1", kind: "subagent", state: "pending" }),
    );
  });

  it("applies a reaped transition with failure reason", async () => {
    const bus = fakeBus();
    const repo = fakeRepo();
    const projector = new ExecutionProjector(bus as never, repo as never);
    projector.onModuleInit();

    await bus.fire(EXECUTION_EVENT_TYPES.reaped, {
      aggregateId: "e1",
      payload: { failure_reason: "idle_timeout", error_message: "x" },
    });

    expect(repo.applyTransition).toHaveBeenCalledWith("e1", "reaped", {
      failure_reason: "idle_timeout",
      error_message: "x",
    });
  });

  it("refreshes last_heartbeat_at on execution.heartbeat", async () => {
    const bus = fakeBus();
    const repo = fakeRepo();
    const projector = new ExecutionProjector(bus as never, repo as never);
    projector.onModuleInit();

    await bus.fire(EXECUTION_EVENT_TYPES.heartbeat, {
      aggregateId: "e1",
      payload: { source: "telemetry" },
    });

    expect(repo.applyTransition).toHaveBeenCalledWith(
      "e1",
      "running",
      expect.objectContaining({ last_heartbeat_at: expect.any(Date) }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/execution-lifecycle/execution.projector.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import type { DomainEventEnvelope } from "../domain-events/domain-event-bus.types";
import { InProcessDomainEventBus } from "../domain-events/in-process-domain-event.bus";
import { LOCAL_DOMAIN_EVENT_FANOUT } from "../domain-events/outbox-domain-event.bus";
import { ExecutionRepository } from "./database/repositories/execution.repository";
import {
  EXECUTION_EVENT_TYPES,
  type ExecutionFailureReason,
  type ExecutionKind,
} from "./execution-lifecycle.contracts";

@Injectable()
export class ExecutionProjector implements OnModuleInit {
  private readonly logger = new Logger(ExecutionProjector.name);

  constructor(
    @Inject(LOCAL_DOMAIN_EVENT_FANOUT)
    private readonly bus: InProcessDomainEventBus,
    private readonly repo: ExecutionRepository,
  ) {}

  onModuleInit(): void {
    const E = EXECUTION_EVENT_TYPES;
    this.bus.on(E.created, (e) => this.onCreated(e as DomainEventEnvelope));
    this.bus.on(E.provisioned, (e) =>
      this.transition(e as DomainEventEnvelope, "provisioning", "running"),
    );
    this.bus.on(E.running, (e) =>
      this.transition(e as DomainEventEnvelope, "running"),
    );
    this.bus.on(E.heartbeat, (e) => this.onHeartbeat(e as DomainEventEnvelope));
    this.bus.on(E.completed, (e) =>
      this.transition(e as DomainEventEnvelope, "completed"),
    );
    this.bus.on(E.failed, (e) =>
      this.onTerminalFailure(e as DomainEventEnvelope, "failed"),
    );
    this.bus.on(E.reaped, (e) =>
      this.onTerminalFailure(e as DomainEventEnvelope, "reaped"),
    );
  }

  private async onCreated(event: DomainEventEnvelope): Promise<void> {
    const payload = event.payload as {
      kind: ExecutionKind;
      parent_execution_id?: string | null;
      workflow_run_id?: string | null;
      chat_session_id?: string | null;
      container_tier?: number;
    };
    await this.repo.create({
      id: event.aggregateId,
      kind: payload.kind,
      parent_execution_id: payload.parent_execution_id ?? null,
      workflow_run_id: payload.workflow_run_id ?? null,
      chat_session_id: payload.chat_session_id ?? null,
      container_tier: payload.container_tier ?? 2,
      state: "pending",
    });
  }

  private async onHeartbeat(event: DomainEventEnvelope): Promise<void> {
    await this.repo.applyTransition(event.aggregateId, "running", {
      last_heartbeat_at: new Date(),
    });
  }

  private async onTerminalFailure(
    event: DomainEventEnvelope,
    to: "failed" | "reaped",
  ): Promise<void> {
    const payload = event.payload as {
      failure_reason: ExecutionFailureReason;
      error_message?: string | null;
    };
    await this.repo.applyTransition(event.aggregateId, to, {
      failure_reason: payload.failure_reason,
      error_message: payload.error_message ?? null,
    });
  }

  private async transition(
    event: DomainEventEnvelope,
    to: Parameters<ExecutionRepository["applyTransition"]>[1],
    container_id_from_provisioned?: "provisioning" | "running",
  ): Promise<void> {
    const patch =
      container_id_from_provisioned !== undefined
        ? {
            container_id:
              (event.payload as { container_id?: string }).container_id ?? null,
          }
        : {};
    await this.repo.applyTransition(event.aggregateId, to, patch);
  }
}
```

> Note: the `provisioned` handler maps to state `running` only after `provisioning`. If your sequence emits `provisioned` while still `pending`, the legal-edge guard will no-op it; emit `execution.provisioning` first (Task 9 wires this) so the row is in `provisioning` when `provisioned` arrives. The third arg to `transition` is a marker to copy `container_id` from the provisioned payload.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/execution-lifecycle/execution.projector.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/execution-lifecycle/execution.projector.ts apps/api/src/execution-lifecycle/execution.projector.spec.ts
git commit -m "feat(execution-lifecycle): add projector as the single executions writer"
```

---

## Task 8: Supervisor decision function (pure)

The reaping logic as a pure function — this is the direct regression guard for the incident.

**Files:**

- Create: `apps/api/src/execution-lifecycle/execution-supervision.helpers.ts`
- Test: `apps/api/src/execution-lifecycle/execution-supervision.helpers.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import {
  classifyExecutionForReaping,
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_MAX_RUNTIME_MS,
  resolveIdleTimeoutMs,
} from "./execution-supervision.helpers";

const base = {
  state: "running" as const,
  createdAtMs: 0,
  lastHeartbeatAtMs: 0,
  containerLost: false,
};

describe("classifyExecutionForReaping", () => {
  it("does not reap an actively-heartbeating execution past 30 minutes", () => {
    const now = 45 * 60_000;
    const verdict = classifyExecutionForReaping(
      { ...base, createdAtMs: 0, lastHeartbeatAtMs: now - 10_000 },
      now,
    );
    expect(verdict).toBeNull();
  });

  it("reaps idle_timeout when no heartbeat within the idle window", () => {
    const now = 45 * 60_000;
    const verdict = classifyExecutionForReaping(
      { ...base, lastHeartbeatAtMs: now - (DEFAULT_IDLE_TIMEOUT_MS + 1) },
      now,
    );
    expect(verdict).toBe("idle_timeout");
  });

  it("reaps container_lost regardless of heartbeat", () => {
    const now = 60_000;
    const verdict = classifyExecutionForReaping(
      { ...base, lastHeartbeatAtMs: now, containerLost: true },
      now,
    );
    expect(verdict).toBe("container_lost");
  });

  it("reaps max_runtime_exceeded past the hard ceiling even if active", () => {
    const now = DEFAULT_MAX_RUNTIME_MS + 1;
    const verdict = classifyExecutionForReaping(
      { ...base, createdAtMs: 0, lastHeartbeatAtMs: now - 1_000 },
      now,
    );
    expect(verdict).toBe("max_runtime_exceeded");
  });

  it("never idle-reaps an awaiting_input execution", () => {
    const now = 60 * 60_000;
    const verdict = classifyExecutionForReaping(
      {
        ...base,
        state: "awaiting_input",
        lastHeartbeatAtMs: now - (DEFAULT_IDLE_TIMEOUT_MS + 1),
      },
      now,
    );
    expect(verdict).toBeNull();
  });

  it("reads idle timeout from env, falling back on invalid input", () => {
    expect(resolveIdleTimeoutMs("600000")).toBe(600_000);
    expect(resolveIdleTimeoutMs("nope")).toBe(DEFAULT_IDLE_TIMEOUT_MS);
    expect(resolveIdleTimeoutMs(undefined)).toBe(DEFAULT_IDLE_TIMEOUT_MS);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/execution-lifecycle/execution-supervision.helpers.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type {
  ExecutionFailureReason,
  ExecutionState,
} from "./execution-lifecycle.contracts";

export const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60_000; // 15 min with no heartbeat
export const DEFAULT_MAX_RUNTIME_MS = 4 * 60 * 60_000; // 4h hard ceiling

function resolvePositiveIntMs(
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function resolveIdleTimeoutMs(raw: string | undefined): number {
  return resolvePositiveIntMs(raw, DEFAULT_IDLE_TIMEOUT_MS);
}

export function resolveMaxRuntimeMs(raw: string | undefined): number {
  return resolvePositiveIntMs(raw, DEFAULT_MAX_RUNTIME_MS);
}

export interface SupervisionInput {
  state: ExecutionState;
  createdAtMs: number;
  lastHeartbeatAtMs: number;
  containerLost: boolean;
}

export function classifyExecutionForReaping(
  input: SupervisionInput,
  nowMs: number,
  idleTimeoutMs: number = DEFAULT_IDLE_TIMEOUT_MS,
  maxRuntimeMs: number = DEFAULT_MAX_RUNTIME_MS,
): ExecutionFailureReason | null {
  if (input.containerLost) {
    return "container_lost";
  }
  if (nowMs - input.createdAtMs > maxRuntimeMs) {
    return "max_runtime_exceeded";
  }
  if (input.state === "awaiting_input") {
    return null;
  }
  if (nowMs - input.lastHeartbeatAtMs > idleTimeoutMs) {
    return "idle_timeout";
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/execution-lifecycle/execution-supervision.helpers.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/execution-lifecycle/execution-supervision.helpers.ts apps/api/src/execution-lifecycle/execution-supervision.helpers.spec.ts
git commit -m "feat(execution-lifecycle): add pure supervision/reaping decision function"
```

---

## Task 9: Supervisor service

Periodic sweep over non-terminal executions; uses the pure classifier + a Docker probe; emits `execution.reaped`. Never writes state directly.

**Files:**

- Create: `apps/api/src/execution-lifecycle/execution-supervisor.service.ts`
- Test: `apps/api/src/execution-lifecycle/execution-supervisor.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { ExecutionSupervisorService } from "./execution-supervisor.service";

describe("ExecutionSupervisorService.sweepOnce", () => {
  it("emits reaped for an idle execution and skips an active one", async () => {
    const now = 60 * 60_000;
    const repo = {
      findNonTerminal: vi.fn().mockResolvedValue([
        {
          id: "idle",
          state: "running",
          created_at: new Date(0),
          last_heartbeat_at: new Date(0),
          container_id: "c1",
        },
        {
          id: "busy",
          state: "running",
          created_at: new Date(now - 1000),
          last_heartbeat_at: new Date(now - 1000),
          container_id: "c2",
        },
      ]),
    };
    const publisher = { reaped: vi.fn().mockResolvedValue(undefined) };
    const docker = { isContainerLost: vi.fn().mockResolvedValue(false) };
    const service = new ExecutionSupervisorService(
      repo as never,
      publisher as never,
      docker as never,
    );
    (service as unknown as { now: () => number }).now = () => now;

    await service.sweepOnce();

    expect(publisher.reaped).toHaveBeenCalledTimes(1);
    expect(publisher.reaped).toHaveBeenCalledWith(
      "idle",
      expect.objectContaining({ failure_reason: "idle_timeout" }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/execution-lifecycle/execution-supervisor.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ExecutionRepository } from "./database/repositories/execution.repository";
import { ExecutionEventPublisher } from "./execution-event.publisher";
import {
  classifyExecutionForReaping,
  resolveIdleTimeoutMs,
  resolveMaxRuntimeMs,
} from "./execution-supervision.helpers";
import type { ExecutionFailureReason } from "./execution-lifecycle.contracts";

export const SUPERVISOR_SWEEP_INTERVAL_MS = 30_000;

export interface ContainerLivenessProbe {
  isContainerLost(containerId: string): Promise<boolean>;
}

const REASON_MESSAGES: Record<ExecutionFailureReason, string> = {
  provision_failed: "Container failed to provision",
  idle_timeout: "No activity heartbeat within the idle timeout window",
  max_runtime_exceeded: "Execution exceeded the maximum allowed runtime",
  container_lost: "Execution container exited or was lost",
  agent_error: "Agent reported a terminal error",
  step_failed: "Step execution failed",
  cancelled_by_user: "Cancelled by user",
  parent_terminated: "Parent execution terminated",
  never_dispatched: "Execution was created but never dispatched",
};

@Injectable()
export class ExecutionSupervisorService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ExecutionSupervisorService.name);
  private handle: NodeJS.Timeout | null = null;
  private sweeping = false;
  private readonly idleTimeoutMs = resolveIdleTimeoutMs(
    process.env.EXECUTION_IDLE_TIMEOUT_MS,
  );
  private readonly maxRuntimeMs = resolveMaxRuntimeMs(
    process.env.EXECUTION_MAX_RUNTIME_MS,
  );

  constructor(
    private readonly repo: ExecutionRepository,
    private readonly publisher: ExecutionEventPublisher,
    private readonly docker: ContainerLivenessProbe,
  ) {}

  private now(): number {
    return Date.now();
  }

  onModuleInit(): void {
    this.handle = setInterval(() => {
      void this.sweepOnce().catch((error: unknown) => {
        this.logger.error(
          `Supervisor sweep failed: ${(error as Error).message}`,
        );
      });
    }, SUPERVISOR_SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.handle) {
      clearInterval(this.handle);
      this.handle = null;
    }
  }

  async sweepOnce(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const now = this.now();
      const rows = await this.repo.findNonTerminal();
      for (const row of rows) {
        const containerLost = row.container_id
          ? await this.docker.isContainerLost(row.container_id)
          : false;
        const reason = classifyExecutionForReaping(
          {
            state: row.state,
            createdAtMs: row.created_at.getTime(),
            lastHeartbeatAtMs: (
              row.last_heartbeat_at ?? row.created_at
            ).getTime(),
            containerLost,
          },
          now,
          this.idleTimeoutMs,
          this.maxRuntimeMs,
        );
        if (reason) {
          await this.publisher.reaped(row.id, {
            failure_reason: reason,
            error_message: REASON_MESSAGES[reason],
          });
        }
      }
    } finally {
      this.sweeping = false;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/execution-lifecycle/execution-supervisor.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/execution-lifecycle/execution-supervisor.service.ts apps/api/src/execution-lifecycle/execution-supervisor.service.spec.ts
git commit -m "feat(execution-lifecycle): add supervisor that emits reaped events"
```

---

## Task 10: Legacy cascade listener

Mirrors a terminal `executions` outcome onto the legacy `subagent_executions` + `chat_sessions` rows, so existing UI/queries see the truthful reason during migration. Subscribes to `execution.reaped`/`execution.failed`.

**Files:**

- Create: `apps/api/src/execution-lifecycle/execution-legacy-cascade.listener.ts`
- Test: `apps/api/src/execution-lifecycle/execution-legacy-cascade.listener.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { ExecutionLegacyCascadeListener } from "./execution-legacy-cascade.listener";
import { EXECUTION_EVENT_TYPES } from "./execution-lifecycle.contracts";

function fakeBus() {
  const handlers = new Map<string, (e: unknown) => Promise<void>>();
  return {
    handlers,
    on: vi.fn((type: string, h: (e: unknown) => Promise<void>) =>
      handlers.set(type, h),
    ),
    fire: (type: string, e: unknown) => handlers.get(type)!(e),
  };
}

describe("ExecutionLegacyCascadeListener", () => {
  it("writes the truthful reason to the linked chat session on reaped", async () => {
    const bus = fakeBus();
    const executionRepo = {
      findById: vi
        .fn()
        .mockResolvedValue({
          id: "e1",
          kind: "subagent",
          chat_session_id: "cs1",
          failure_reason: "idle_timeout",
          error_message: "No activity heartbeat within the idle timeout window",
        }),
    };
    const chatSessionRepo = { update: vi.fn().mockResolvedValue(undefined) };
    const listener = new ExecutionLegacyCascadeListener(
      bus as never,
      executionRepo as never,
      chatSessionRepo as never,
    );
    listener.onModuleInit();

    await bus.fire(EXECUTION_EVENT_TYPES.reaped, {
      aggregateId: "e1",
      payload: {},
    });

    expect(chatSessionRepo.update).toHaveBeenCalledWith(
      "cs1",
      expect.objectContaining({
        status: "FAILED",
        execution_state: "failed",
        error_message: "No activity heartbeat within the idle timeout window",
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/execution-lifecycle/execution-legacy-cascade.listener.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ChatSessionStatus } from "@nexus/core";
import type { DomainEventEnvelope } from "../domain-events/domain-event-bus.types";
import { InProcessDomainEventBus } from "../domain-events/in-process-domain-event.bus";
import { LOCAL_DOMAIN_EVENT_FANOUT } from "../domain-events/outbox-domain-event.bus";
import { ChatSessionRepository } from "../chat/database/repositories/chat-session.repository";
import { ExecutionRepository } from "./database/repositories/execution.repository";
import { EXECUTION_EVENT_TYPES } from "./execution-lifecycle.contracts";

@Injectable()
export class ExecutionLegacyCascadeListener implements OnModuleInit {
  private readonly logger = new Logger(ExecutionLegacyCascadeListener.name);

  constructor(
    @Inject(LOCAL_DOMAIN_EVENT_FANOUT)
    private readonly bus: InProcessDomainEventBus,
    private readonly executionRepo: ExecutionRepository,
    private readonly chatSessionRepo: ChatSessionRepository,
  ) {}

  onModuleInit(): void {
    this.bus.on(EXECUTION_EVENT_TYPES.reaped, (e) =>
      this.cascade(e as DomainEventEnvelope),
    );
    this.bus.on(EXECUTION_EVENT_TYPES.failed, (e) =>
      this.cascade(e as DomainEventEnvelope),
    );
  }

  private async cascade(event: DomainEventEnvelope): Promise<void> {
    try {
      const execution = await this.executionRepo.findById(event.aggregateId);
      if (!execution?.chat_session_id) {
        return;
      }
      await this.chatSessionRepo.update(execution.chat_session_id, {
        status: ChatSessionStatus.FAILED,
        execution_state: "failed",
        error_message:
          execution.error_message ?? "Execution terminated by supervisor",
        completed_at: new Date(),
      });
    } catch (error) {
      this.logger.warn(
        `Legacy cascade failed for execution ${event.aggregateId}: ${(error as Error).message}`,
      );
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/execution-lifecycle/execution-legacy-cascade.listener.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/execution-lifecycle/execution-legacy-cascade.listener.ts apps/api/src/execution-lifecycle/execution-legacy-cascade.listener.spec.ts
git commit -m "feat(execution-lifecycle): cascade truthful terminal reason to legacy chat sessions"
```

---

## Task 11: Wire the module

**Files:**

- Create: `apps/api/src/execution-lifecycle/execution-lifecycle.module.ts`
- Modify: `apps/api/src/app.module.ts` (add `ExecutionLifecycleModule` to imports)

- [ ] **Step 1: Write the module**

```typescript
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DomainEventsModule } from "../domain-events/domain-events.module";
import { DockerModule } from "../docker/docker.module";
import { ChatModule } from "../chat/chat.module";
import { ExecutionEntity } from "./database/entities/execution.entity";
import { ExecutionRepository } from "./database/repositories/execution.repository";
import { ExecutionEventPublisher } from "./execution-event.publisher";
import { ExecutionProjector } from "./execution.projector";
import { ExecutionSupervisorService } from "./execution-supervisor.service";
import { ExecutionLegacyCascadeListener } from "./execution-legacy-cascade.listener";
import { SubagentContainerLivenessProbe } from "./subagent-container-liveness.probe";

@Module({
  imports: [
    TypeOrmModule.forFeature([ExecutionEntity]),
    DomainEventsModule,
    DockerModule,
    ChatModule,
  ],
  providers: [
    ExecutionRepository,
    ExecutionEventPublisher,
    ExecutionProjector,
    SubagentContainerLivenessProbe,
    {
      provide: ExecutionSupervisorService,
      useFactory: (
        repo: ExecutionRepository,
        publisher: ExecutionEventPublisher,
        probe: SubagentContainerLivenessProbe,
      ) => new ExecutionSupervisorService(repo, publisher, probe),
      inject: [
        ExecutionRepository,
        ExecutionEventPublisher,
        SubagentContainerLivenessProbe,
      ],
    },
    ExecutionLegacyCascadeListener,
  ],
  exports: [ExecutionEventPublisher, ExecutionRepository],
})
export class ExecutionLifecycleModule {}
```

- [ ] **Step 2: Add the Docker-backed liveness probe**

Create `apps/api/src/execution-lifecycle/subagent-container-liveness.probe.ts`:

```typescript
import { Inject, Injectable, Logger } from "@nestjs/common";
import Docker from "dockerode";
import { DOCKER_CLIENT } from "../docker/docker.constants";
import type { ContainerLivenessProbe } from "./execution-supervisor.service";

interface DockerLikeError {
  statusCode?: number;
}

@Injectable()
export class SubagentContainerLivenessProbe implements ContainerLivenessProbe {
  private readonly logger = new Logger(SubagentContainerLivenessProbe.name);

  constructor(@Inject(DOCKER_CLIENT) private readonly docker: Docker) {}

  async isContainerLost(containerId: string): Promise<boolean> {
    try {
      const info = (await this.docker.getContainer(containerId).inspect()) as {
        State?: { Status?: string };
      };
      const status = info.State?.Status;
      return status === "exited" || status === "dead" || status === "removing";
    } catch (error) {
      if ((error as DockerLikeError).statusCode === 404) {
        return true;
      }
      this.logger.warn(
        `Liveness probe failed for ${containerId}: ${(error as Error).message}`,
      );
      return false;
    }
  }
}
```

- [ ] **Step 3: Register in `app.module.ts`**

Add `import { ExecutionLifecycleModule } from './execution-lifecycle/execution-lifecycle.module';` and include `ExecutionLifecycleModule` in the `imports` array of the root `AppModule`.

- [ ] **Step 4: Typecheck**

Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: no errors. (If `ChatModule` does not export `ChatSessionRepository`, add it to that module's `exports`; if `DockerModule` is `@Global`, the `DockerModule` import may be dropped — verify against the actual module definitions.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/execution-lifecycle/execution-lifecycle.module.ts apps/api/src/execution-lifecycle/subagent-container-liveness.probe.ts apps/api/src/app.module.ts
git commit -m "feat(execution-lifecycle): wire ExecutionLifecycleModule into the app"
```

---

## Task 12: Emit subagent lifecycle events (shadow producers)

Make subagent spawn/completion emit `execution.*` so the projection mirrors real subagents. The `Execution.id` reuses the existing `SubagentExecution.id` (1:1), so no new id mapping is needed.

**Files:**

- Modify: `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.spawn.operations.ts`
- Modify: `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.runtime.operations.ts`

> These files use a `context`/`params` operations pattern. Add `ExecutionEventPublisher` to the relevant operations context type and DI source (the `SubagentOrchestrator*` service that builds the context), then call it at the documented sites. Exact context plumbing varies; the call sites and payloads below are fixed.

- [ ] **Step 1: Emit created + provisioning + provisioned + running on spawn**

In `subagent-orchestrator.spawn.operations.ts`, after the execution record is created (the `createExecutionRecord` call) emit:

```typescript
await context.executionEvents.created(execution.id, {
  kind: "subagent",
  workflow_run_id: params.workflowRunId,
});
await context.executionEvents.provisioning(execution.id);
```

(Add a `provisioning` method to `ExecutionEventPublisher` mirroring `running`: `await this.emit(EXECUTION_EVENT_TYPES.provisioning, executionId, {});`.)

Then in `provisionSubagentContainer`, immediately after the existing `subagentRepo.update(... child_container_id, status: 'Running')` (line ~282-285):

```typescript
await context.executionEvents.provisioned(execution.id, childContainerId);
await context.executionEvents.running(execution.id);
```

- [ ] **Step 2: Emit completed/failed on completion**

In `subagent-orchestrator.runtime.operations.ts`, inside `completeExecutionAndEmitEvent`, after the existing `subagentRepo.update(... status: 'Completed')` (line ~138-142):

```typescript
await params.executionEvents.completed(execution.id);
```

In the failure operations (`markSpawnFailed`, `failSubagentExecutionKickoff`), after they set the subagent status to `Failed`, emit:

```typescript
await params.executionEvents.failed(execution.id, {
  failure_reason: 'agent_error',
  error_message: <existing error string>,
});
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/workflow/workflow-subagents/subagent-orchestrator.spawn.operations.ts apps/api/src/workflow/workflow-subagents/subagent-orchestrator.runtime.operations.ts apps/api/src/execution-lifecycle/execution-event.publisher.ts
git commit -m "feat(execution-lifecycle): emit subagent lifecycle events into the projection"
```

---

## Task 13: Heartbeat from the telemetry seam

Emit a throttled `execution.heartbeat` whenever a subagent client sends telemetry/tool/turn events.

**Files:**

- Create: `apps/api/src/execution-lifecycle/execution-heartbeat.throttle.ts`
- Test: `apps/api/src/execution-lifecycle/execution-heartbeat.throttle.spec.ts`
- Modify: `apps/api/src/telemetry/telemetry-gateway-runtime.helpers.ts`

- [ ] **Step 1: Write the failing test for the throttle**

```typescript
import {
  shouldEmitExecutionHeartbeat,
  EXECUTION_HEARTBEAT_MIN_INTERVAL_MS,
} from "./execution-heartbeat.throttle";

describe("shouldEmitExecutionHeartbeat", () => {
  it("emits when no prior heartbeat", () => {
    expect(shouldEmitExecutionHeartbeat(undefined, 1000)).toBe(true);
  });
  it("suppresses inside the interval", () => {
    const now = 100_000;
    expect(
      shouldEmitExecutionHeartbeat(
        now - (EXECUTION_HEARTBEAT_MIN_INTERVAL_MS - 1),
        now,
      ),
    ).toBe(false);
  });
  it("emits once the interval has elapsed", () => {
    const now = 100_000;
    expect(
      shouldEmitExecutionHeartbeat(
        now - EXECUTION_HEARTBEAT_MIN_INTERVAL_MS,
        now,
      ),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/execution-lifecycle/execution-heartbeat.throttle.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the throttle**

```typescript
export const EXECUTION_HEARTBEAT_MIN_INTERVAL_MS = 15_000;

export function shouldEmitExecutionHeartbeat(
  lastEmittedAtMs: number | undefined,
  nowMs: number,
  minIntervalMs: number = EXECUTION_HEARTBEAT_MIN_INTERVAL_MS,
): boolean {
  if (lastEmittedAtMs === undefined) {
    return true;
  }
  return nowMs - lastEmittedAtMs >= minIntervalMs;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/execution-lifecycle/execution-heartbeat.throttle.spec.ts`
Expected: PASS.

- [ ] **Step 5: Add a heartbeat service holding per-execution timestamps**

Create `apps/api/src/execution-lifecycle/execution-heartbeat.service.ts`:

```typescript
import { Injectable, Logger } from "@nestjs/common";
import { ExecutionEventPublisher } from "./execution-event.publisher";
import { shouldEmitExecutionHeartbeat } from "./execution-heartbeat.throttle";

@Injectable()
export class ExecutionHeartbeatService {
  private readonly logger = new Logger(ExecutionHeartbeatService.name);
  private readonly lastEmittedAtMs = new Map<string, number>();

  constructor(private readonly publisher: ExecutionEventPublisher) {}

  recordActivity(executionId: string, source: string): void {
    if (!executionId) return;
    const now = Date.now();
    if (
      !shouldEmitExecutionHeartbeat(this.lastEmittedAtMs.get(executionId), now)
    ) {
      return;
    }
    this.lastEmittedAtMs.set(executionId, now);
    void this.publisher
      .heartbeat(executionId, { source })
      .catch((error: unknown) => {
        this.logger.debug(
          `Heartbeat emit failed for ${executionId}: ${(error as Error).message}`,
        );
      });
  }

  forget(executionId: string): void {
    this.lastEmittedAtMs.delete(executionId);
  }
}
```

Add `ExecutionHeartbeatService` to `ExecutionLifecycleModule` `providers` and `exports`.

- [ ] **Step 6: Wire into the telemetry handlers**

In `telemetry-gateway-runtime.helpers.ts`, the subagent telemetry/tool/turn handlers run with `client.subagentExecutionId` available. Thread an optional `executionHeartbeat?: Pick<ExecutionHeartbeatService, 'recordActivity'>` into the params of `handleAgentTelemetryGatewayCompat`, `handleToolExecution*GatewayCompat`, and `handleTurnEndGatewayCompat`, and at the top of each (after the `client.role !== 'agent'` guard) add:

```typescript
if (client.isSubagent && client.subagentExecutionId) {
  params.executionHeartbeat?.recordActivity(
    client.subagentExecutionId,
    "telemetry",
  );
}
```

Then in `telemetry.gateway.ts`, inject `ExecutionHeartbeatService` and pass it into those helper calls. (Import `ExecutionLifecycleModule` into the telemetry module, or move `ExecutionHeartbeatService` to a shared provider the telemetry module already imports.)

- [ ] **Step 7: Typecheck + commit**

Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json`

```bash
git add apps/api/src/execution-lifecycle/execution-heartbeat.throttle.ts apps/api/src/execution-lifecycle/execution-heartbeat.throttle.spec.ts apps/api/src/execution-lifecycle/execution-heartbeat.service.ts apps/api/src/execution-lifecycle/execution-lifecycle.module.ts apps/api/src/telemetry/telemetry-gateway-runtime.helpers.ts apps/api/src/telemetry/telemetry.gateway.ts
git commit -m "feat(execution-lifecycle): emit throttled subagent heartbeats from the telemetry seam"
```

---

## Task 14: Retire the reaper's wall-clock running-timeout

The supervisor now owns idle/runtime/container-lost reaping for subagents. Remove the flat 30-minute `REAPER_RUNNING_AGE_MS` branch so the two systems do not both reap; keep the reaper's `Spawning`/spawn-timeout and chat-session-failed handling for now (those move in a later phase).

**Files:**

- Modify: `apps/api/src/workflow/workflow-subagents/subagent-execution-reaper.service.ts`
- Modify: `apps/api/src/workflow/workflow-subagents/subagent-execution-reaper.service.spec.ts`

- [ ] **Step 1: Update the test to assert the wall-clock branch is gone**

In `subagent-execution-reaper.service.spec.ts`, change the running-timeout test so that a `Running` execution older than 30 minutes **with a recent activity signal** (or simply: with a live container) is **not** reaped by the reaper. Replace the existing `RUNNING_TIMEOUT` expectation with:

```typescript
it("no longer reaps a long-running subagent on wall-clock age (supervisor owns idle timeout)", async () => {
  const execution = {
    id: "exec-1",
    status: "Running",
    child_container_id: "c1",
    created_at: new Date(Date.now() - 31 * 60_000),
    subagent_chat_session_id: "cs1",
  };
  findActiveMock.mockResolvedValue([execution]);
  inspectMock.mockResolvedValue({
    State: { Status: "running", Running: true },
  });

  const reaped = await service.sweep();

  expect(reaped).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/workflow/workflow-subagents/subagent-execution-reaper.service.spec.ts`
Expected: FAIL — the reaper still reaps on wall-clock age.

- [ ] **Step 3: Remove the wall-clock branch**

In `subagent-execution-reaper.service.ts` `classifyAbandoned`, delete the running-age check:

```typescript
    if (execution.status === 'Running') {
      if (ageMs > REAPER_RUNNING_AGE_MS) {
        return ABANDON_REASON_RUNNING_TIMEOUT;
      }
      if (execution.child_container_id) {
```

becomes:

```typescript
    if (execution.status === 'Running') {
      if (execution.child_container_id) {
```

Remove the now-unused `REAPER_RUNNING_AGE_MS` constant and the `ABANDON_REASON_RUNNING_TIMEOUT` import if no longer referenced. (Leave `ABANDON_REASON_RUNNING_TIMEOUT` in the types file; the supervisor uses the `execution_timeout`/`idle_timeout` taxonomy now.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/workflow/workflow-subagents/subagent-execution-reaper.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `cd apps/api && npx tsc --noEmit -p tsconfig.json`

```bash
git add apps/api/src/workflow/workflow-subagents/subagent-execution-reaper.service.ts apps/api/src/workflow/workflow-subagents/subagent-execution-reaper.service.spec.ts
git commit -m "refactor(subagents): supervisor owns idle/runtime reaping; drop reaper wall-clock cap"
```

---

## Task 15: Delete the misleading "orphaned" string for timed-out sessions

The cleanup service must no longer label a session "orphaned" when it was actually reaped. Restrict its message to genuinely-never-dispatched sessions and never overwrite an existing `error_message`.

**Files:**

- Modify: `apps/api/src/chat-execution/chat-session-cleanup.service.ts`
- Modify: `apps/api/src/chat-execution/chat-session-cleanup.service.spec.ts`

- [ ] **Step 1: Update the test**

In `chat-session-cleanup.service.spec.ts`, change expectations so that a session which **already has an `error_message`** is left untouched, and a genuinely-orphaned session gets a message that does not claim "execution service was not available":

```typescript
it("does not overwrite an existing error_message", async () => {
  findOrphanedMock.mockResolvedValue([
    {
      id: "session-1",
      error_message: "No activity heartbeat within the idle timeout window",
    },
  ]);

  await service.cleanupOrphanedSessions();

  expect(chatSessionRepo.update).not.toHaveBeenCalled();
});
```

(Adjust the existing "orphaned" assertion tests to expect the new message `'Session never dispatched - no container or execution was ever created'` for sessions with a null `error_message`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/chat-execution/chat-session-cleanup.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the guard + accurate message**

In `chat-session-cleanup.service.ts` `cleanupOrphanedSessions`, skip rows that already carry an error and change the string:

```typescript
    for (const session of orphaned) {
      if (session.error_message) {
        continue;
      }
      try {
        await this.chatSessionRepo.update(session.id, {
          status: ChatSessionStatus.FAILED,
          execution_state: 'failed',
          error_message:
            'Session never dispatched - no container or execution was ever created',
          completed_at: new Date(),
        });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run --config vitest.config.ts src/chat-execution/chat-session-cleanup.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/chat-execution/chat-session-cleanup.service.ts apps/api/src/chat-execution/chat-session-cleanup.service.spec.ts
git commit -m "fix(chat-execution): stop mislabeling reaped sessions as orphaned; never overwrite errors"
```

---

## Final verification (after all tasks)

- [ ] **Typecheck**

```bash
cd apps/api && npx tsc --noEmit -p tsconfig.json
```

- [ ] **Run all new + touched specs**

```bash
cd apps/api && npx vitest run --config vitest.config.ts \
  src/execution-lifecycle \
  src/workflow/workflow-subagents/subagent-execution-reaper.service.spec.ts \
  src/chat-execution/chat-session-cleanup.service.spec.ts
```

Expected: all PASS.

- [ ] **Rebuild + restart**

```bash
docker compose up -d --build api
sleep 25
```

- [ ] **Verify the projection fills for a real subagent run**

Trigger a workflow that spawns a subagent, then:

```bash
docker exec nexus-postgres psql -U nexus -d nexus_orchestrator -c \
"SELECT id, kind, state, failure_reason, last_heartbeat_at FROM executions ORDER BY created_at DESC LIMIT 5;"
```

Expected: subagent rows progress `pending → running`, with `last_heartbeat_at` advancing while active.

- [ ] **Verify a long, active subagent survives past 30 minutes** and that any genuine failure shows a structured reason — never "Session orphaned - execution service was not available at creation time".

---

## Self-Review Notes

- **Spec coverage (SDD Phase 1):** event-sourcing spine → Tasks 1–7, 11 (contracts, transitions, entity, migration, repo, publisher, projector, module); single source of truth → Task 7 (projector is sole writer); activity-aware supervision → Tasks 8–9 (pure classifier + supervisor); heartbeat → Tasks 12–13; structured/truthful failure attribution → Tasks 9, 10, 15; retire wall-clock cap → Task 14. Async dispatch for steps/chat and legacy-table retirement are explicitly deferred (SDD Phases 2–4).
- **Type consistency:** `ExecutionState`/`ExecutionFailureReason`/`EXECUTION_EVENT_TYPES` defined in Task 1 are used identically in Tasks 2, 5–10. `applyTransition(id, to, patch)`, `classifyExecutionForReaping(input, now, idle, max)`, `recordActivity(executionId, source)`, `heartbeat(id, {source})`, `reaped(id, {failure_reason, error_message})` signatures match across definition and call sites.
- **Known integration risks flagged inline:** the projector `provisioned` handler depends on a prior `provisioning` event (Task 12 emits it); module wiring notes the `ChatModule`/`DockerModule` export caveats (Task 11 Step 4); the operations-context plumbing for the publisher is pattern-specific (Task 12 preamble). These are the spots an executing engineer must verify against live code.
- **Dual-write posture:** legacy `subagent_executions`/`chat_sessions` remain authoritative; the projection is shadow + cascade. Reverting = removing the supervisor + restoring the reaper branch; the `executions` table can be dropped via the migration's `down`.
