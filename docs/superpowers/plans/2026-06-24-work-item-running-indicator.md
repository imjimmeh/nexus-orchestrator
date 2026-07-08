# Work Item "Actively Running" Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the kanban work item's `lastExecutionStatus` field — currently never set — so the board's existing (dead) running indicators light up, sourced from the workflow-run lifecycle events kanban already consumes.

**Architecture:** Add a persisted `last_execution_status` column to the kanban work item. Set it from the core lifecycle stream consumer on every non-terminal run event (PENDING/RUNNING), and to the terminal status on completion/failure/cancellation at the existing reconciliation clear-point. Map it into the work item DTO so the board's initial GET carries it, and broadcast it over the existing websocket so the indicator updates live. The frontend already consumes the field and needs **no changes**.

**Tech Stack:** NestJS, TypeORM (Postgres), Vitest, Socket.IO. Web: React + TanStack Query.

## Global Constraints

- **Kanban-only.** All server changes live in `apps/kanban`. Do not add kanban/work-item domain identifiers to `apps/api` or `packages/core` (boundary lint `nexus-boundaries/no-core-kanban-residue`).
- **No lint suppression.** Never add `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, or rule downgrades. Fix findings in code.
- **NestJS build:** use `nest build` for apps, not raw `tsc`.
- **Strong typing.** No `any`. Shared contracts live in `@nexus/kanban-contracts` (already declares `lastExecutionStatus`).
- **TDD.** Red → Green → Refactor for every task. Frequent atomic commits.
- **Run kanban tests with:** `npm run test:kanban` (Vitest). Target a single file with `npm run test --workspace=apps/kanban -- <path>`.
- **Web tests:** `npm run test:unit:web`.
- Migration timestamps must be later than `20260619090000`. Use `20260624120000`.

---

## File Structure

| File                                                                                        | Responsibility                   | Action                                                         |
| ------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------- |
| `apps/kanban/src/database/entities/kanban-work-item.entity.ts`                              | TypeORM entity                   | Add `last_execution_status` column                             |
| `apps/kanban/src/database/migrations/20260624120000-add-work-item-last-execution-status.ts` | Schema migration                 | Create                                                         |
| `apps/kanban/src/work-item/work-item.service.types.ts`                                      | `WorkItemEntityRecord` Pick type | Add field to Pick                                              |
| `apps/kanban/src/work-item/work-item.service.helpers.ts`                                    | `toWorkItemRecord` mapper        | Map field                                                      |
| `apps/kanban/src/database/repositories/kanban-work-item.repository.ts`                      | Persistence                      | Add `recordExecutionStatus`; extend `clearRunLinksIfMatches`   |
| `apps/kanban/src/core/core-lifecycle-stream.consumer.ts`                                    | Lifecycle projection             | Call `recordExecutionStatus` on non-terminal events; broadcast |
| `apps/kanban/src/dispatch/dispatch-work-items-reconciliation.ts`                            | Terminal reconciliation          | Pass terminal status to clear                                  |

Frontend: no source changes. `deriveLiveState`, `hasActiveSession`, the green border, "Session active" badge, and footer live-state badge already read `lastExecutionStatus`.

---

### Task 1: Persist and expose `last_execution_status`

Adds the column, migration, entity-record Pick field, and the mapper line. After this task the board's initial GET carries the field (verifiable via the mapper unit test), but nothing writes it yet.

**Files:**

- Modify: `apps/kanban/src/database/entities/kanban-work-item.entity.ts:55-56`
- Create: `apps/kanban/src/database/migrations/20260624120000-add-work-item-last-execution-status.ts`
- Modify: `apps/kanban/src/work-item/work-item.service.types.ts:30-49`
- Modify: `apps/kanban/src/work-item/work-item.service.helpers.ts:92-130`
- Test: `apps/kanban/src/work-item/work-item.service.helpers.spec.ts` (create if absent)

**Interfaces:**

- Produces: `KanbanWorkItemEntity.last_execution_status: string | null`; `WorkItemEntityRecord` includes `last_execution_status`; `toWorkItemRecord(...)` output includes `lastExecutionStatus: string | null`.

- [ ] **Step 1: Write the failing test** for the mapper.

Create/extend `apps/kanban/src/work-item/work-item.service.helpers.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toWorkItemRecord } from "./work-item.service.helpers";
import type { WorkItemEntityRecord } from "./work-item.service.types";

function makeEntity(
  overrides: Partial<WorkItemEntityRecord> = {},
): WorkItemEntityRecord {
  const now = new Date("2026-06-24T00:00:00.000Z");
  return {
    id: "11111111-1111-1111-1111-111111111111",
    project_id: "22222222-2222-2222-2222-222222222222",
    title: "Item",
    description: null,
    status: "in-progress",
    priority: "p2",
    scope: "standard",
    assigned_agent_id: null,
    token_spend: 0,
    cost_cents: 0,
    current_execution_id: "run-1",
    waiting_for_input: false,
    execution_config: null,
    metadata: null,
    linked_run_id: "run-1",
    last_execution_status: "RUNNING",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("toWorkItemRecord", () => {
  it("maps last_execution_status to lastExecutionStatus", () => {
    const record = toWorkItemRecord(makeEntity(), [], []);
    expect(record.lastExecutionStatus).toBe("RUNNING");
  });

  it("maps a null last_execution_status to null", () => {
    const record = toWorkItemRecord(
      makeEntity({ last_execution_status: null }),
      [],
      [],
    );
    expect(record.lastExecutionStatus).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- work-item.service.helpers.spec`
Expected: FAIL — type error / `lastExecutionStatus` is `undefined` (mapper doesn't set it) and `last_execution_status` missing on `WorkItemEntityRecord`.

- [ ] **Step 3: Add the entity column.** In `kanban-work-item.entity.ts`, after the `linked_run_id` column (line 55-56), add:

```ts
  @Column({ name: "last_execution_status", type: "varchar", nullable: true })
  last_execution_status!: string | null;
```

- [ ] **Step 4: Add the field to `WorkItemEntityRecord`.** In `work-item.service.types.ts`, add `"last_execution_status"` to the Pick union (after `"waiting_for_input"`, line 44):

```ts
export type WorkItemEntityRecord = Pick<
  KanbanWorkItemEntity,
  | "id"
  | "project_id"
  | "title"
  | "status"
  | "linked_run_id"
  | "description"
  | "priority"
  | "scope"
  | "assigned_agent_id"
  | "token_spend"
  | "cost_cents"
  | "current_execution_id"
  | "waiting_for_input"
  | "last_execution_status"
  | "execution_config"
  | "metadata"
  | "created_at"
  | "updated_at"
>;
```

- [ ] **Step 5: Map it in `toWorkItemRecord`.** In `work-item.service.helpers.ts`, in the returned object (after `waitingForInput: item.waiting_for_input,`, line 109), add:

```ts
    lastExecutionStatus: item.last_execution_status,
```

- [ ] **Step 6: Write the migration.** Create `apps/kanban/src/database/migrations/20260624120000-add-work-item-last-execution-status.ts`:

```ts
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddWorkItemLastExecutionStatus20260624120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE kanban_work_items ADD COLUMN last_execution_status varchar NULL",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE kanban_work_items DROP COLUMN last_execution_status",
    );
  }
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- work-item.service.helpers.spec`
Expected: PASS (both cases).

- [ ] **Step 8: Typecheck/build the kanban app**

Run: `npm run build:kanban`
Expected: build succeeds (no TS errors).

- [ ] **Step 9: Commit**

```bash
git add apps/kanban/src/database/entities/kanban-work-item.entity.ts \
        apps/kanban/src/database/migrations/20260624120000-add-work-item-last-execution-status.ts \
        apps/kanban/src/work-item/work-item.service.types.ts \
        apps/kanban/src/work-item/work-item.service.helpers.ts \
        apps/kanban/src/work-item/work-item.service.helpers.spec.ts
git commit -m "feat(kanban): persist and expose last_execution_status on work items"
```

---

### Task 2: Repository write methods for execution status

Adds `recordExecutionStatus` (used for non-terminal events, updates on every matching event) and extends `clearRunLinksIfMatches` to also set the terminal status while clearing the link.

**Files:**

- Modify: `apps/kanban/src/database/repositories/kanban-work-item.repository.ts:27-70`
- Test: `apps/kanban/src/database/repositories/kanban-work-item.repository.spec.ts` (create if absent)

**Interfaces:**

- Consumes: `KanbanWorkItemEntity.last_execution_status` (Task 1).
- Produces:
  - `recordExecutionStatus(params: { project_id: string; workItemId: string; runId: string; status: string }): Promise<boolean>` — sets `last_execution_status = status` where the row matches the project/item **and** the run is the attached run (`current_execution_id = runId OR linked_run_id = runId`). Returns true when a row was updated.
  - `clearRunLinksIfMatches(project_id, workItemId, runId, lastExecutionStatus: string): Promise<boolean>` — now also sets `last_execution_status = lastExecutionStatus` (signature gains a required 4th arg).

- [ ] **Step 1: Write the failing test.** Create/extend `kanban-work-item.repository.spec.ts`. Use an in-memory style spy on the QueryBuilder. Follow the existing repo-spec pattern in the codebase if one exists; otherwise assert against a mocked `Repository`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { KanbanWorkItemRepository } from "./kanban-work-item.repository";

function makeQbSpy(affected = 1) {
  const qb: Record<string, unknown> = {};
  for (const m of ["update", "set", "where", "andWhere", "setParameter"]) {
    qb[m] = vi.fn(() => qb);
  }
  qb.execute = vi.fn(async () => ({ affected }));
  return qb;
}

function makeRepo(qb: Record<string, unknown>) {
  return {
    createQueryBuilder: vi.fn(() => qb),
  } as unknown as ConstructorParameters<typeof KanbanWorkItemRepository>[0];
}

describe("KanbanWorkItemRepository.recordExecutionStatus", () => {
  it("sets last_execution_status keyed on the attached run and returns true", async () => {
    const qb = makeQbSpy(1);
    const repo = new KanbanWorkItemRepository(
      makeRepo(qb),
      {} as never,
      {} as never,
    );

    const updated = await repo.recordExecutionStatus({
      project_id: "p1",
      workItemId: "w1",
      runId: "run-1",
      status: "RUNNING",
    });

    expect(updated).toBe(true);
    expect(qb.set).toHaveBeenCalledWith({ last_execution_status: "RUNNING" });
    expect(qb.execute).toHaveBeenCalledOnce();
  });

  it("returns false when no row matches the run", async () => {
    const qb = makeQbSpy(0);
    const repo = new KanbanWorkItemRepository(
      makeRepo(qb),
      {} as never,
      {} as never,
    );
    const updated = await repo.recordExecutionStatus({
      project_id: "p1",
      workItemId: "w1",
      runId: "run-1",
      status: "RUNNING",
    });
    expect(updated).toBe(false);
  });
});

describe("KanbanWorkItemRepository.clearRunLinksIfMatches", () => {
  it("clears links and records the terminal status", async () => {
    const qb = makeQbSpy(1);
    const repo = new KanbanWorkItemRepository(
      makeRepo(qb),
      {} as never,
      {} as never,
    );
    await repo.clearRunLinksIfMatches("p1", "w1", "run-1", "FAILED");
    expect(qb.set).toHaveBeenCalledWith({
      linked_run_id: null,
      current_execution_id: null,
      last_execution_status: "FAILED",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- kanban-work-item.repository.spec`
Expected: FAIL — `recordExecutionStatus` is not a function / `clearRunLinksIfMatches` arity mismatch.

- [ ] **Step 3: Extend `clearRunLinksIfMatches`.** Replace lines 27-49 with:

```ts
  async clearRunLinksIfMatches(
    project_id: string,
    workItemId: string,
    runId: string,
    lastExecutionStatus: string,
  ): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(KanbanWorkItemEntity)
      .set({
        linked_run_id: null,
        current_execution_id: null,
        last_execution_status: lastExecutionStatus,
      })
      .where("id = :workItemId", { workItemId })
      .andWhere("project_id = :project_id", { project_id })
      .andWhere("linked_run_id = :runId", { runId })
      .andWhere(
        "(current_execution_id = :runId OR current_execution_id IS NULL)",
        { runId },
      )
      .execute();

    return (result.affected ?? 0) > 0;
  }
```

- [ ] **Step 4: Add `recordExecutionStatus`.** Insert immediately after `clearRunLinksIfMatches` (before `linkRunIfUnlinked`):

```ts
  /**
   * Persist the latest workflow-run status onto the work item so the board's
   * running indicators reflect live execution state. Keyed on the attached
   * run (`current_execution_id`/`linked_run_id`) so a stale event for a
   * superseded run cannot overwrite the current status. Safe to call on
   * every non-terminal lifecycle event. Returns true when a row was updated.
   */
  async recordExecutionStatus(params: {
    project_id: string;
    workItemId: string;
    runId: string;
    status: string;
  }): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(KanbanWorkItemEntity)
      .set({ last_execution_status: params.status })
      .where("id = :workItemId", { workItemId: params.workItemId })
      .andWhere("project_id = :project_id", { project_id: params.project_id })
      .andWhere(
        "(current_execution_id = :runId OR linked_run_id = :runId)",
        { runId: params.runId },
      )
      .execute();

    return (result.affected ?? 0) > 0;
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- kanban-work-item.repository.spec`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/kanban/src/database/repositories/kanban-work-item.repository.ts \
        apps/kanban/src/database/repositories/kanban-work-item.repository.spec.ts
git commit -m "feat(kanban): repository writes for work item execution status"
```

---

### Task 3: Set status on non-terminal lifecycle events

Wire the consumer to call `recordExecutionStatus` after the run is linked, so PENDING/RUNNING/awaiting-input states are reflected on every non-terminal event.

**Files:**

- Modify: `apps/kanban/src/core/core-lifecycle-stream.consumer.ts:266-288`
- Test: `apps/kanban/src/core/core-lifecycle-stream.consumer.spec.ts` (extend existing, or create `*.last-execution-status.spec.ts` if the main spec is large)

**Interfaces:**

- Consumes: `KanbanWorkItemRepository.recordExecutionStatus` (Task 2); `resolveProjectIdFromContext`, `resolveWorkItemIdFromContext`, `isRealWorkItemId` from `./core-lifecycle-stream.helpers`.
- Produces: non-terminal `core.workflow.run.*` events persist `envelope.payload.status` onto the matching work item.

- [ ] **Step 1: Write the failing test.** Drive a single non-terminal event through `processEntriesForTest` (the existing test seam at consumer.ts:233) with a stubbed `workItems` repo and assert `recordExecutionStatus` is called with the event's status. Mirror the construction used in the existing consumer spec (reuse its envelope/builder helpers). Skeleton:

```ts
it("records non-terminal run status onto the work item", async () => {
  // Arrange: build a RUNNING core.workflow.run.* envelope whose context
  // resolves to projectId 'p1' / work_item_id 'w1' (reuse existing
  // makeEnvelope helper from the consumer spec).
  const recordExecutionStatus = vi.fn(async () => true);
  // ...construct the consumer with a workItems stub exposing
  //    linkRunIfUnlinked: vi.fn(async () => true),
  //    recordExecutionStatus,
  // and a lease service whose acquireRunLease resolves { acquired: true }.

  await consumer.processEntriesForTest(
    [["1-0", toStreamFields(runningEnvelope)]],
    "test-consumer",
  );

  expect(recordExecutionStatus).toHaveBeenCalledWith({
    project_id: "p1",
    workItemId: "w1",
    runId: runningEnvelope.payload.run_id,
    status: "RUNNING",
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- core-lifecycle-stream.consumer`
Expected: FAIL — `recordExecutionStatus` never called.

- [ ] **Step 3: Add the import.** In `core-lifecycle-stream.consumer.ts`, extend the import from `./core-lifecycle-stream.helpers` (line 33-41) to include `resolveProjectIdFromContext` and `isRealWorkItemId` (alongside the existing `resolveWorkItemIdFromContext`):

```ts
import {
  classifyTerminalWorkItemRun,
  isRealWorkItemId,
  readPollIntervalMs,
  resolveContinuationTrigger,
  resolveProjectIdFromContext,
  resolveWorkItemIdFromContext,
  shouldStopAfterStaleLink,
  toFields,
  toTerminalWorkflowStatus,
} from "./core-lifecycle-stream.helpers";
```

(If any of these are not exported from that helpers module, export them — they are already used by `core-lifecycle-stream-work-item-link.helpers.ts`.)

- [ ] **Step 4: Persist status in the private projection method.** In `linkWorkItemRunFromLifecycleEvent` (consumer.ts:266-288), after the `await linkWorkItemRunFromLifecycleEvent({...}, envelope);` call, add:

```ts
const projectId = resolveProjectIdFromContext(envelope.payload.context);
const workItemId = resolveWorkItemIdFromContext(envelope.payload.context);
if (projectId && isRealWorkItemId(workItemId)) {
  await this.workItems.recordExecutionStatus({
    project_id: projectId,
    workItemId,
    runId: envelope.payload.run_id,
    status: envelope.payload.status,
  });
}
```

This runs after the link commits, so on the first event `current_execution_id` is already set to `runId` and the conditional UPDATE matches.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- core-lifecycle-stream.consumer`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/kanban/src/core/core-lifecycle-stream.consumer.ts \
        apps/kanban/src/core/core-lifecycle-stream.consumer.spec.ts
git commit -m "feat(kanban): record non-terminal run status from lifecycle events"
```

---

### Task 4: Record terminal status on reconciliation

Pass the terminal run status through `clearTerminalLinkedRun` so completion/failure/cancellation is reflected (gives a short-lived "error"/"completed" live state) instead of leaving the last live status stale.

**Files:**

- Modify: `apps/kanban/src/dispatch/dispatch-work-items-reconciliation.ts:213-217`
- Test: existing dispatch reconciliation spec (`apps/kanban/src/dispatch/dispatch.service.spec.ts` or the reconciliation-specific spec)

**Interfaces:**

- Consumes: `clearRunLinksIfMatches(project_id, workItemId, runId, lastExecutionStatus)` (Task 2).

- [ ] **Step 1: Write the failing test.** In the reconciliation spec, drive a terminal run (status `FAILED`) through `clearTerminalLinkedRun` (or its caller) and assert `clearRunLinksIfMatches` is invoked with the terminal status as the 4th argument:

```ts
expect(workItems.clearRunLinksIfMatches).toHaveBeenCalledWith(
  "p1",
  "w1",
  "run-1",
  "FAILED",
);
```

(Reuse the existing fixtures in that spec; only the assertion on the 4th arg is new.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- dispatch-work-items-reconciliation`
Expected: FAIL — called with 3 args / status not recorded.

- [ ] **Step 3: Pass the status.** In `dispatch-work-items-reconciliation.ts`, update the `clearRunLinksIfMatches` call (line 213-217):

```ts
const cleared = await deps.workItems.clearRunLinksIfMatches(
  item.project_id,
  item.id,
  runId,
  status.status,
);
```

`status.status` is the terminal `WorkflowRunStatusV1` already fetched at line 190.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- dispatch-work-items-reconciliation`
Expected: PASS.

- [ ] **Step 5: Build the kanban app** to catch any other `clearRunLinksIfMatches` callers broken by the new required arg.

Run: `npm run build:kanban`
Expected: build succeeds. If another caller exists, pass the appropriate status (the run's terminal status in context).

- [ ] **Step 6: Commit**

```bash
git add apps/kanban/src/dispatch/dispatch-work-items-reconciliation.ts \
        apps/kanban/src/dispatch/*.spec.ts
git commit -m "feat(kanban): record terminal run status on reconciliation"
```

---

### Task 5: Broadcast run-state changes to the board live

Run-state changes (PENDING→RUNNING→terminal) arrive via the lifecycle consumer and otherwise would not reach the board until the next refetch/transition. Inject the existing realtime gateway + publisher into the consumer and broadcast the updated work item after a status change.

**Files:**

- Modify: `apps/kanban/src/core/core-lifecycle-stream.consumer.ts` (constructor + projection method)
- Modify: the consumer's NestJS module (the module that declares `CoreLifecycleStreamConsumerService`) to import `WorkItemModule` if the realtime providers are not already in scope
- Test: `apps/kanban/src/core/core-lifecycle-stream.consumer.spec.ts`

**Interfaces:**

- Consumes: `WorkItemRealtimeGateway.broadcastWorkItemUpdated(projectId, workItem, triggeredRunIds)` and `WorkItemRealtimePublisher.publish(projectId, workItem)` (both exported from `apps/kanban/src/work-item/work-item.module.ts`); `toRecordsWithDependencies(items, workItems)` from `work-item.service.helpers.ts`.
- Produces: after a non-terminal status update (and on terminal reconciliation), a `work-item-updated` socket event carrying the work item with the new `lastExecutionStatus`.

- [ ] **Step 1: Write the failing test.** Extend the consumer spec: after a non-terminal event whose `recordExecutionStatus` returns true, assert `broadcastWorkItemUpdated` is called for the project with a work item whose `lastExecutionStatus` matches the event status. Stub `workItems.findByProjectAndId` (and dependency/subtask finders, returning `[]`) so the record can be built. Skeleton:

```ts
expect(broadcastWorkItemUpdated).toHaveBeenCalledWith(
  "p1",
  expect.objectContaining({ id: "w1", lastExecutionStatus: "RUNNING" }),
  [],
);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- core-lifecycle-stream.consumer`
Expected: FAIL — broadcast never called.

- [ ] **Step 3: Inject the realtime providers.** Add to the consumer constructor (after `workItemRunLeaseService`):

```ts
    private readonly realtimeGateway: WorkItemRealtimeGateway,
    private readonly realtimePublisher: WorkItemRealtimePublisher,
```

Add imports at the top of `core-lifecycle-stream.consumer.ts`:

```ts
import { WorkItemRealtimeGateway } from "../work-item/work-item-realtime.gateway";
import { WorkItemRealtimePublisher } from "../work-item/work-item-realtime.publisher";
import { toRecordsWithDependencies } from "../work-item/work-item.service.helpers";
```

- [ ] **Step 4: Add a broadcast helper and call it.** In the consumer, add a private method:

```ts
  private async broadcastWorkItemRunState(
    projectId: string,
    workItemId: string,
  ): Promise<void> {
    const entity = await this.workItems.findByProjectAndId(
      projectId,
      workItemId,
    );
    if (!entity) return;
    const [record] = await toRecordsWithDependencies([entity], this.workItems);
    if (!record) return;
    this.realtimeGateway.broadcastWorkItemUpdated(projectId, record, []);
    void this.realtimePublisher.publish(
      projectId,
      record as unknown as Record<string, unknown>,
    );
  }
```

Then, in the non-terminal projection block added in Task 3, broadcast only when the status update actually changed a row:

```ts
if (projectId && isRealWorkItemId(workItemId)) {
  const updated = await this.workItems.recordExecutionStatus({
    project_id: projectId,
    workItemId,
    runId: envelope.payload.run_id,
    status: envelope.payload.status,
  });
  if (updated) {
    await this.broadcastWorkItemRunState(projectId, workItemId);
  }
}
```

- [ ] **Step 5: Ensure the realtime providers are resolvable.** Open the module that declares `CoreLifecycleStreamConsumerService` (search: `grep -rl "CoreLifecycleStreamConsumerService" apps/kanban/src --include=*.module.ts`). If `WorkItemRealtimeGateway` / `WorkItemRealtimePublisher` are not already provided/imported there, add `WorkItemModule` to that module's `imports` (it exports both — see `work-item.module.ts:39`). Use `forwardRef(() => WorkItemModule)` only if the build reports a circular dependency.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- core-lifecycle-stream.consumer`
Expected: PASS.

- [ ] **Step 7: Build the kanban app** (catches DI/circular-import issues).

Run: `npm run build:kanban`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add apps/kanban/src/core/core-lifecycle-stream.consumer.ts \
        apps/kanban/src/core/*.module.ts \
        apps/kanban/src/core/core-lifecycle-stream.consumer.spec.ts
git commit -m "feat(kanban): broadcast work item run-state changes to the board"
```

---

### Task 6: Full verification

Confirm the whole feature passes lint + the full kanban and web unit suites, and that the frontend indicators are exercised.

**Files:**

- Verify (no change expected): `apps/web/src/pages/kanban/kanban.utils.spec.ts` (already covers `deriveLiveState` for RUNNING/PENDING/awaiting-input/error). Add cases only if a state is uncovered.

- [ ] **Step 1: Run the full kanban unit suite**

Run: `npm run test:kanban`
Expected: PASS (no regressions).

- [ ] **Step 2: Run the web unit suite**

Run: `npm run test:unit:web`
Expected: PASS.

- [ ] **Step 3: Confirm `deriveLiveState` coverage.** Open `apps/web/src/pages/kanban/kanban.utils.spec.ts`. Verify it asserts `deriveLiveState` returns `"running"` for `{ lastExecutionStatus: "RUNNING" }`, `"queued"` for `"PENDING"`, `"awaiting-input"` for `{ lastExecutionStatus: "RUNNING", waitingForInput: true }`, and `"error"` for `"FAILED"`/`"CANCELLED"`. If any is missing, add it (these are the states the indicator now relies on).

- [ ] **Step 4: Lint the changed workspaces**

Run: `npm run lint:kanban` and `npm run lint:web`
Expected: no errors.

- [ ] **Step 5: Commit** any coverage additions

```bash
git add apps/web/src/pages/kanban/kanban.utils.spec.ts
git commit -m "test(web): cover deriveLiveState states used by running indicator"
```

---

## Self-Review Notes

- **Spec coverage:** Entity+migration (Task 1), repo writes (Task 2), non-terminal set (Task 3), terminal set (Task 4), mapper (Task 1), realtime (Task 5), frontend already wired + tests (Task 6). All spec sections covered.
- **Type consistency:** `recordExecutionStatus(params)` and the 4-arg `clearRunLinksIfMatches(project_id, workItemId, runId, lastExecutionStatus)` are used identically across Tasks 2–5. `lastExecutionStatus` (camelCase DTO) ↔ `last_execution_status` (snake_case column) mapping is isolated to `toWorkItemRecord`.
- **Open verification points flagged inline:** helper-export check (Task 3 Step 3), additional `clearRunLinksIfMatches` callers (Task 4 Step 5), module DI/circular-import (Task 5 Step 5).
