# Workflow Run start_at / completed_at Timestamps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist real `started_at` and `completed_at` timestamps on workflow runs so the API stops relying on `created_at`/`updated_at` proxies and the UI can show accurate run start and completion times.

**Architecture:** Add two nullable timestamp columns to the `workflow_runs` table and the `IWorkflowRun` contract. Stamp them via one pure, side-effect-free helper (`buildRunStatusTimestampPatch`) that every status-transition site composes into its update payload — `started_at` on the first transition into `RUNNING`, `completed_at` on the first transition into a terminal status (`COMPLETED` / `FAILED` / `CANCELLED`). A data migration backfills existing rows from `created_at`/`updated_at`.

**Tech Stack:** NestJS, TypeORM (Postgres), Vitest, `@nexus/core` shared contracts.

## Global Constraints

- **TDD:** Red → Green → Refactor for every task. No production code without a failing test first.
- **Core/Kanban boundary:** All changes are Kanban-neutral. Use `scopeId`/`contextId` only; never introduce Kanban/work-item identifiers into `apps/api` or `packages/core`. (`nexus-boundaries/no-core-kanban-residue` is lint-enforced.)
- **Strict lint:** No `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, or rule downgrades.
- **NestJS quality gate:** Controllers = transport, services = domain logic, repositories = persistence. The timestamp rule is **domain logic** → it lives in the pure helper / service layer, never inside a repository.
- **Build order:** Build `packages/core` before the API when the shared interface changes: `npm run build --workspace=packages/core`.
- **Terminal statuses:** `COMPLETED`, `FAILED`, `CANCELLED`. Active/initial: `PENDING`, `RUNNING`. Enum values defined in `packages/core/src/schemas/workflow-run/workflow-run-contracts.schema.ts` (`WORKFLOW_RUN_EXECUTION_STATUS_VALUES`), surfaced as `WorkflowStatus` in `packages/core/src/interfaces/workflow-legacy.types.ts`.
- **Migration naming:** `apps/api/src/database/migrations/YYYYMMDDHHMMSS-description.ts`; class name `Description<timestamp>`. The timestamp must be **later than every existing migration** (a `20260622000000-*` migration already exists — use `20260623000000` or later). Register in `apps/api/src/database/migrations/registered-migrations.ts` (import + append to the exported array). Migrations auto-run on API startup unless `TYPEORM_MIGRATIONS_RUN === 'false'`.

---

### Task 1: Pure status-timestamp helper

The single source of truth for the stamping rule. Pure function, no I/O — trivially testable.

**Files:**

- Create: `apps/api/src/workflow/workflow-run-status-timestamps.helper.ts`
- Test: `apps/api/src/workflow/workflow-run-status-timestamps.helper.spec.ts`

**Interfaces:**

- Consumes: `WorkflowStatus` from `@nexus/core`.
- Produces:

  ```ts
  interface RunStatusTimestampSnapshot {
    started_at?: Date | null;
    completed_at?: Date | null;
  }
  function buildRunStatusTimestampPatch(
    current: RunStatusTimestampSnapshot,
    nextStatus: WorkflowStatus,
    now: Date,
  ): { started_at?: Date; completed_at?: Date };
  ```

  Returns only the fields that should change (empty object when nothing changes). Idempotent: never overwrites an already-set `started_at`/`completed_at`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/workflow/workflow-run-status-timestamps.helper.spec.ts
import { describe, it, expect } from "vitest";
import { WorkflowStatus } from "@nexus/core";
import { buildRunStatusTimestampPatch } from "./workflow-run-status-timestamps.helper";

const NOW = new Date("2026-06-19T10:00:00.000Z");

describe("buildRunStatusTimestampPatch", () => {
  it("stamps started_at when first entering RUNNING", () => {
    const patch = buildRunStatusTimestampPatch(
      { started_at: null, completed_at: null },
      WorkflowStatus.RUNNING,
      NOW,
    );
    expect(patch).toEqual({ started_at: NOW });
  });

  it("does not re-stamp started_at when already started", () => {
    const existing = new Date("2026-06-19T09:00:00.000Z");
    const patch = buildRunStatusTimestampPatch(
      { started_at: existing, completed_at: null },
      WorkflowStatus.RUNNING,
      NOW,
    );
    expect(patch).toEqual({});
  });

  it("stamps completed_at for each terminal status", () => {
    for (const status of [
      WorkflowStatus.COMPLETED,
      WorkflowStatus.FAILED,
      WorkflowStatus.CANCELLED,
    ]) {
      const patch = buildRunStatusTimestampPatch(
        { started_at: NOW, completed_at: null },
        status,
        NOW,
      );
      expect(patch).toEqual({ completed_at: NOW });
    }
  });

  it("does not re-stamp completed_at when already completed", () => {
    const existing = new Date("2026-06-19T09:30:00.000Z");
    const patch = buildRunStatusTimestampPatch(
      { started_at: NOW, completed_at: existing },
      WorkflowStatus.COMPLETED,
      NOW,
    );
    expect(patch).toEqual({});
  });

  it("returns nothing for non-stamping transitions (e.g. PENDING)", () => {
    const patch = buildRunStatusTimestampPatch(
      { started_at: null, completed_at: null },
      WorkflowStatus.PENDING,
      NOW,
    );
    expect(patch).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:api -- run src/workflow/workflow-run-status-timestamps.helper.spec.ts`
Expected: FAIL — `buildRunStatusTimestampPatch` is not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/api/src/workflow/workflow-run-status-timestamps.helper.ts
import { WorkflowStatus } from "@nexus/core";

const TERMINAL_STATUSES: ReadonlySet<WorkflowStatus> = new Set([
  WorkflowStatus.COMPLETED,
  WorkflowStatus.FAILED,
  WorkflowStatus.CANCELLED,
]);

export interface RunStatusTimestampSnapshot {
  started_at?: Date | null;
  completed_at?: Date | null;
}

/**
 * Computes the timestamp patch for a run status transition. Returns only the
 * fields that should change; never overwrites a timestamp that is already set.
 */
export function buildRunStatusTimestampPatch(
  current: RunStatusTimestampSnapshot,
  nextStatus: WorkflowStatus,
  now: Date,
): { started_at?: Date; completed_at?: Date } {
  const patch: { started_at?: Date; completed_at?: Date } = {};

  if (nextStatus === WorkflowStatus.RUNNING && !current.started_at) {
    patch.started_at = now;
  }

  if (TERMINAL_STATUSES.has(nextStatus) && !current.completed_at) {
    patch.completed_at = now;
  }

  return patch;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:api -- run src/workflow/workflow-run-status-timestamps.helper.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-run-status-timestamps.helper.ts apps/api/src/workflow/workflow-run-status-timestamps.helper.spec.ts
git commit -m "feat(workflow): add pure run status-timestamp patch helper"
```

---

### Task 2: Add timestamp fields to the entity and core contract

**Files:**

- Modify: `packages/core/src/interfaces/workflow-legacy.types.ts:27-41` (the `IWorkflowRun` interface)
- Modify: `apps/api/src/workflow/database/entities/workflow-run.entity.ts:31-49`

**Interfaces:**

- Consumes: nothing new.
- Produces: `IWorkflowRun.started_at?: Date | null` and `IWorkflowRun.completed_at?: Date | null`; matching nullable columns on the `WorkflowRun` entity.

> The web `WorkflowRun` type (`apps/web/src/lib/api/types.ts:347-348`) **already** declares `started_at?`/`completed_at?`, so no web change is needed.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/workflow/database/entities/workflow-run.entity.spec.ts
import { describe, it, expect } from "vitest";
import { getMetadataArgsStorage } from "typeorm";
import { WorkflowRun } from "./workflow-run.entity";

describe("WorkflowRun entity", () => {
  it("declares nullable started_at and completed_at columns", () => {
    const columns = getMetadataArgsStorage()
      .columns.filter((c) => c.target === WorkflowRun)
      .map((c) => c.propertyName);
    expect(columns).toContain("started_at");
    expect(columns).toContain("completed_at");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:api -- run src/workflow/database/entities/workflow-run.entity.spec.ts`
Expected: FAIL — `expected [...] to contain 'started_at'`.

- [ ] **Step 3: Write minimal implementation**

In `packages/core/src/interfaces/workflow-legacy.types.ts`, inside `IWorkflowRun`, add the two fields immediately before `created_at: Date;`:

```ts
  started_at?: Date | null;
  completed_at?: Date | null;
  created_at: Date;
  updated_at: Date;
```

In `apps/api/src/workflow/database/entities/workflow-run.entity.ts`, add the columns immediately before the `@CreateDateColumn()` block (after `launch_dedupe_key`):

```ts
  @Column({ type: 'timestamp', nullable: true })
  started_at?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  completed_at?: Date | null;

  @CreateDateColumn()
  created_at: Date;
```

Rebuild core so the API picks up the new contract:

```bash
npm run build --workspace=packages/core
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:api -- run src/workflow/database/entities/workflow-run.entity.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/interfaces/workflow-legacy.types.ts apps/api/src/workflow/database/entities/workflow-run.entity.ts apps/api/src/workflow/database/entities/workflow-run.entity.spec.ts packages/core/dist
git commit -m "feat(workflow): add started_at/completed_at to run entity and contract"
```

---

### Task 3: Migration — add columns and backfill

**Files:**

- Create: `apps/api/src/database/migrations/20260623000000-add-workflow-run-start-complete-timestamps.ts`
- Modify: `apps/api/src/database/migrations/registered-migrations.ts` (import + append)

**Interfaces:**

- Consumes: nothing.
- Produces: `workflow_runs.started_at` and `workflow_runs.completed_at` columns in the database, backfilled for existing rows.

> Check `registered-migrations.ts` for the newest existing timestamp before naming. If anything is `>= 20260623000000`, bump the filename/class timestamp so this migration sorts last.

- [ ] **Step 1: Write the migration**

```ts
// apps/api/src/database/migrations/20260623000000-add-workflow-run-start-complete-timestamps.ts
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddWorkflowRunStartCompleteTimestamps20260623000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "workflow_runs"
        ADD COLUMN IF NOT EXISTS "started_at" TIMESTAMP NULL,
        ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMP NULL;
    `);

    // Backfill: existing runs that ever left PENDING have effectively started.
    await queryRunner.query(`
      UPDATE "workflow_runs"
        SET "started_at" = "created_at"
        WHERE "started_at" IS NULL
          AND "status" <> 'PENDING';
    `);

    // Backfill: terminal runs completed at their last update.
    await queryRunner.query(`
      UPDATE "workflow_runs"
        SET "completed_at" = "updated_at"
        WHERE "completed_at" IS NULL
          AND "status" IN ('COMPLETED', 'FAILED', 'CANCELLED');
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "workflow_runs"
        DROP COLUMN IF EXISTS "completed_at",
        DROP COLUMN IF EXISTS "started_at";
    `);
  }
}
```

- [ ] **Step 2: Register the migration**

In `apps/api/src/database/migrations/registered-migrations.ts`, add the import alongside the others and append the class to the exported array (keep array order chronological):

```ts
import { AddWorkflowRunStartCompleteTimestamps20260623000000 } from "./20260623000000-add-workflow-run-start-complete-timestamps";
// ...
export const registeredMigrations = [
  // ...existing entries...
  AddWorkflowRunStartCompleteTimestamps20260623000000,
];
```

- [ ] **Step 3: Verify the API build compiles the migration**

Run: `npm run build:api`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Run the migration against the local stack and confirm the columns exist**

Run:

```bash
docker compose up -d postgres api
docker compose exec postgres psql -U postgres -d nexus -c "\d workflow_runs" | grep -E "started_at|completed_at"
```

Expected: two rows listing `started_at` and `completed_at` as `timestamp without time zone`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/database/migrations/20260623000000-add-workflow-run-start-complete-timestamps.ts apps/api/src/database/migrations/registered-migrations.ts
git commit -m "feat(workflow): migrate workflow_runs with start/complete timestamps + backfill"
```

---

### Task 4: Stamp timestamps in the persistence transition path

`WorkflowPersistenceService.updateRunStatus` already loads the run before writing — the natural place to apply the patch. Also stamp `started_at` when a run is **created** directly in `RUNNING`.

**Files:**

- Modify: `apps/api/src/workflow/workflow-persistence.service.ts:245-256` (`updateRunStatus`)
- Modify: `apps/api/src/workflow/workflow-persistence.service.ts:230-232` (`createRun`)
- Test: `apps/api/src/workflow/workflow-persistence.service.spec.ts`

**Interfaces:**

- Consumes: `buildRunStatusTimestampPatch` (Task 1).
- Produces: `updateRunStatus` persists `{ status, ...timestampPatch }`; `createRun` stamps `started_at` when called with `status === RUNNING` and no explicit `started_at`.

- [ ] **Step 1: Write the failing test**

```ts
// add to apps/api/src/workflow/workflow-persistence.service.spec.ts
import { WorkflowStatus } from "@nexus/core";

it("stamps completed_at when transitioning a run to a terminal status", async () => {
  const existing = {
    id: "run-1",
    status: WorkflowStatus.RUNNING,
    started_at: new Date("2026-06-19T09:00:00.000Z"),
    completed_at: null,
  };
  repos.runs.findById.mockResolvedValue(existing);
  repos.runs.update.mockResolvedValue({
    ...existing,
    status: WorkflowStatus.COMPLETED,
  });

  await service.updateRunStatus("run-1", WorkflowStatus.COMPLETED);

  const [, patch] = repos.runs.update.mock.calls[0];
  expect(patch.status).toBe(WorkflowStatus.COMPLETED);
  expect(patch.completed_at).toBeInstanceOf(Date);
});

it("stamps started_at when creating a run already in RUNNING", async () => {
  repos.runs.create.mockImplementation(async (data) => data);

  await service.createRun({
    workflow_id: "wf-1",
    status: WorkflowStatus.RUNNING,
  });

  const [created] = repos.runs.create.mock.calls[0];
  expect(created.started_at).toBeInstanceOf(Date);
});
```

> Match the existing spec's mock-factory style for `repos.runs` (see the top of `workflow-persistence.service.spec.ts`). If `create`/`findById`/`update` are not already mocked there, add them to the mock factory.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:api -- run src/workflow/workflow-persistence.service.spec.ts`
Expected: FAIL — `patch.completed_at` is `undefined`; `created.started_at` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

Add the import near the top of `workflow-persistence.service.ts`:

```ts
import { buildRunStatusTimestampPatch } from "./workflow-run-status-timestamps.helper";
```

Replace `updateRunStatus` (lines 245-256) with:

```ts
  async updateRunStatus(
    id: string,
    status: WorkflowStatus,
  ): Promise<WorkflowRun> {
    const run = await this.repos.runs.findById(id);
    if (!run) {
      throw new NotFoundException(`Workflow run ${id} not found`);
    }
    const timestampPatch = buildRunStatusTimestampPatch(run, status, new Date());
    run.status = status;
    await this.repos.runs.update(id, { status, ...timestampPatch });
    return run;
  }
```

Replace `createRun` (lines 230-232) with:

```ts
  async createRun(data: Partial<WorkflowRun>): Promise<IWorkflowRun> {
    const seeded: Partial<WorkflowRun> =
      data.status === WorkflowStatus.RUNNING && !data.started_at
        ? { ...data, started_at: new Date() }
        : data;
    return this.repos.runs.create(seeded);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:api -- run src/workflow/workflow-persistence.service.spec.ts`
Expected: PASS (including pre-existing tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-persistence.service.ts apps/api/src/workflow/workflow-persistence.service.spec.ts
git commit -m "feat(workflow): stamp run start/complete timestamps in persistence transitions"
```

---

### Task 5: Route bypassing transition sites through the stamping logic

Two completion paths bypass `updateRunStatus` and write status directly. Make each apply `buildRunStatusTimestampPatch` so no terminal transition is missed.

**Files:**

- Modify: `apps/api/src/workflow/workflow-engine.service.ts:343` (createRun → RUNNING) and `:380-381` (immediate COMPLETED)
- Modify: `apps/api/src/workflow/workflow-run-job-execution.service.ts:357` (`handleJobFailed` → FAILED) and the COMPLETED branch inside `progressDagOrComplete` (~`:260`)
- Test: `apps/api/src/workflow/workflow-run-job-execution.service.spec.ts`, `apps/api/src/workflow/workflow-engine.service.spec.ts`

**Interfaces:**

- Consumes: `buildRunStatusTimestampPatch` (Task 1); `createRun`/`updateRunStatus` (Task 4).
- Produces: every RUNNING/terminal write includes the timestamp patch.

> `createAndStartRun` (engine) calls `createRun({ status: RUNNING, ... })` — already stamped by Task 4's `createRun`. Its immediate-complete path and the job-execution paths still need routing.

- [ ] **Step 1: Write the failing test (job-execution FAILED path)**

```ts
// add to apps/api/src/workflow/workflow-run-job-execution.service.spec.ts
import { WorkflowStatus } from "@nexus/core";

it("stamps completed_at when a run fails", async () => {
  runRepo.findById.mockResolvedValue({
    id: "run-1",
    status: WorkflowStatus.RUNNING,
    started_at: new Date("2026-06-19T09:00:00.000Z"),
    completed_at: null,
  });

  await service.handleJobFailed(/* use the existing spec's call shape for this method */);

  const failingUpdate = runRepo.update.mock.calls.find(
    ([, data]) => data.status === WorkflowStatus.FAILED,
  );
  expect(failingUpdate?.[1].completed_at).toBeInstanceOf(Date);
});
```

> Mirror the existing `handleJobFailed` test in this spec for the exact arguments and the `runRepo` mock-factory shape; add `findById` to the mock if absent.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:api -- run src/workflow/workflow-run-job-execution.service.spec.ts`
Expected: FAIL — `completed_at` is `undefined` on the FAILED update.

- [ ] **Step 3: Write minimal implementation**

Add the import to `workflow-run-job-execution.service.ts`:

```ts
import { buildRunStatusTimestampPatch } from "./workflow-run-status-timestamps.helper";
```

At the FAILED site (line 357), replace:

```ts
await this.runRepo.update(workflowRunId, {
  status: WorkflowStatus.FAILED,
});
```

with:

```ts
const failingRun = await this.runRepo.findById(workflowRunId);
await this.runRepo.update(workflowRunId, {
  status: WorkflowStatus.FAILED,
  ...(failingRun
    ? buildRunStatusTimestampPatch(
        failingRun,
        WorkflowStatus.FAILED,
        new Date(),
      )
    : {}),
});
```

In `progressDagOrComplete`, locate the branch that sets the run to `WorkflowStatus.COMPLETED` and apply the same pattern (fetch current run, spread `buildRunStatusTimestampPatch(run, WorkflowStatus.COMPLETED, new Date())` into the update). If the run object is already in scope there, reuse it instead of re-fetching.

In `workflow-engine.service.ts` immediate-complete path (lines 380-381), replace the direct `updateRun(run.id, { status: run.status })` with the stamping persistence call:

```ts
await this.persistence.updateRunStatus(run.id, run.status);
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm run test:api -- run src/workflow/workflow-run-job-execution.service.spec.ts
npm run test:api -- run src/workflow/workflow-engine.service.spec.ts
```

Expected: PASS for both (including pre-existing tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-run-job-execution.service.ts apps/api/src/workflow/workflow-run-job-execution.service.spec.ts apps/api/src/workflow/workflow-engine.service.ts apps/api/src/workflow/workflow-engine.service.spec.ts
git commit -m "feat(workflow): route remaining run terminal transitions through timestamp stamping"
```

---

### Task 6: Full-suite verification, lint, and docs

**Files:**

- Modify: `docs/guide/README.md` (or the run-lifecycle deep-dive it links to) — document that runs now persist `started_at`/`completed_at`.

- [ ] **Step 1: Run API lint and the full API test suite**

Run:

```bash
npm run lint:api
npm run test:api
```

Expected: lint clean for all touched files; all API tests pass.

- [ ] **Step 2: Live smoke test the stamping end-to-end**

Run (with the local stack up): execute any seed workflow, then query the run:

```bash
docker compose exec postgres psql -U postgres -d nexus -c \
  "SELECT id, status, started_at, completed_at FROM workflow_runs ORDER BY created_at DESC LIMIT 3;"
```

Expected: a RUNNING run shows a non-null `started_at` and null `completed_at`; a COMPLETED/FAILED/CANCELLED run shows both non-null, with `completed_at >= started_at`.

- [ ] **Step 3: Confirm the dashboard now renders the real start time**

Open the web dashboard (`npm run dev:web`, port 3120). The Activity Feed and Active Runs should display a relative time derived from the real `started_at` (the `started_at ?? created_at` fallback in `apps/web/src/pages/Dashboard.tsx` / `dashboard/DashboardWidgets.tsx` now resolves to `started_at`).

- [ ] **Step 4: Update documentation**

In the run-lifecycle section of `docs/guide/README.md` (or the linked architecture doc), add a sentence: workflow runs persist `started_at` (first transition into `RUNNING`) and `completed_at` (first terminal transition), backfilled for historical rows from `created_at`/`updated_at`.

- [ ] **Step 5: Commit**

```bash
git add docs/guide/README.md
git commit -m "docs(workflow): document run start/complete timestamp lifecycle"
```

---

## Self-Review Notes

- **Spec coverage:** Helper (T1) → columns/contract (T2) → migration + backfill (T3) → persistence stamping (T4) → bypassing sites routed (T5) → verification + docs (T6). All transition chokepoints identified in analysis are covered: `createAndStartRun` RUNNING/immediate-COMPLETED, `updateRunStatus` CANCELLED (and any caller), `handleJobFailed` FAILED, `progressDagOrComplete` COMPLETED.
- **Type consistency:** `buildRunStatusTimestampPatch(current, nextStatus, now)` signature is identical at all call sites; `started_at`/`completed_at` typed `Date | null` everywhere (entity, `IWorkflowRun`).
- **No new DI / no circular deps:** bypassing sites use the pure helper inline with their existing repository, so no new service injection is introduced into `workflow-run-job-execution.service`.
- **SoC:** the stamping rule lives in a pure helper (domain logic), not in a repository.
- **Idempotency:** the helper never overwrites an existing timestamp, so re-entrant transitions (retries, reconciliation) won't clobber the original `started_at`.
