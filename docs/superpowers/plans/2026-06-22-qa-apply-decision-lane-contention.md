# QA Apply-Decision Lane-Contention Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the QA review workflow's terminal `apply_qa_decision` status transition from being blocked (and mis-reported) by a concurrent CEO orchestration-cycle lease that saturates the single-slot `strategy` lane, and make the contention honest in retries and the event ledger.

**Architecture:** Three independent defects compound in run `989e9bfc`. (1) Single-work-item status transitions run in the capacity-1 `strategy` lane, which is also held by the long-lived CEO `cycle_request` lease — so any concurrent cycle blocks the transition for up to the 10-minute lease TTL. (2) `countActiveByLane` counts expired-but-unswept leases, extending the block past the TTL until the 30-second sweeper runs. (3) The lane-capacity denial fabricates a `work_item:<id>` conflict key and the rendered error hides the real cause (`lane_capacity`), and the failed retries are logged as `outcome:success`. We fix the kanban control-plane lane model + capacity counting + honest error, then the API-side retry classification + event outcome.

**Tech Stack:** TypeScript, NestJS, TypeORM (Postgres), Vitest, BullMQ. Kanban service (`apps/kanban`) + orchestration API (`apps/api`).

## Global Constraints

- **Strict lint policy** — never suppress (`eslint-disable`, `@ts-ignore`, `@ts-nocheck`). Fix in code.
- **No magic numbers/strings** — extract named constants.
- **TDD (Red-Green-Refactor)** — every behavioural change starts with a failing test.
- **Core/Kanban boundary** — lease, lane, and work-item lifecycle logic stays in `apps/kanban`. The API-side tasks (4, 5) touch only neutral retry/observability code and must not import kanban domain identifiers.
- **NestJS apps build with `nest build`, test with Vitest** (`unit` project). SWC decorator metadata must stay intact.
- **Frequent atomic commits** — one commit per task, message explains the _why_.
- Single-test invocation:
  - kanban: `npm run test --workspace=apps/kanban -- run <pattern>`
  - api: `npm run test --workspace=apps/api -- run <pattern>`

## Background: confirmed root-cause data (run 989e9bfc, work item a9a08b37)

- Workflow `work-item-in-review-default`; terminal job `apply_qa_decision` = `kanban.work_item_transition_status` → `ready-to-merge`.
- It failed 3 retries 13:46–13:54 with `Mutation blocked — conflicting lease(s) held: work_item:a9a08b37`, then succeeded on the 4th attempt at 13:54:44 (recovered by luck).
- The lease table shows **no** active `work_item:a9a08b37` lease during the window. The only active `strategy`-lane lease was a `cycle_request` (owner `core_lifecycle_stream:work_item_completed`, acquired 13:42:01, TTL 13:52:01). `resolveLaneCapacity("strategy") === 1`. The transition succeeded immediately after the cycle lease's TTL expired.
- Conclusion: this was **strategy-lane capacity exhaustion**, not a work-item lease conflict. Both the QA workflow and the CEO cycle were triggered by the same `work_item.status_changed → in-review` event, making the collision routine.

## File Structure

| File                                                                                     | Responsibility                    | Change                                                  |
| ---------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------- |
| `apps/kanban/src/database/repositories/kanban-orchestration-lease.repository.ts`         | Lease persistence                 | Task 1: exclude expired leases from `countActiveByLane` |
| `apps/kanban/src/orchestration/control-plane/orchestration-lease.service.ts`             | Lease acquisition / capacity gate | Task 2: report real lane holders on capacity denial     |
| `apps/kanban/src/orchestration/control-plane/control-plane.types.ts`                     | Control-plane types               | Task 3: add `work_item_transition` lane                 |
| `apps/kanban/src/orchestration/control-plane/lane-capacity.constants.ts` (new)           | Lane capacity map                 | Task 3: named capacity constants                        |
| `apps/kanban/src/orchestration/control-plane/orchestration-decision-executor.service.ts` | Direct-mutation executor          | Task 3: consume capacity map; Task 2: honest error      |
| `apps/kanban/src/mcp/tools/mutation/work-item-transition-status.tool.ts`                 | Status transition tool            | Task 3: route to `work_item_transition` lane            |
| `apps/api/src/workflow/workflow-failure-classification.helpers.ts`                       | Failure classification            | Task 4: classify `resource_contention`                  |
| `apps/api/src/workflow/workflow-failure-classification.types.ts`                         | Classification type               | Task 4: widen `retryCategory`                           |
| `apps/api/src/workflow/listeners/workflow-audit.listener.ts`                             | Event-ledger audit                | Task 5: emit retry_scheduled as `in_progress`           |
| `docs/guide/*` orchestration lease doc                                                   | Docs                              | Task 6                                                  |

The tasks are ordered so each is independently testable and reviewable. Tasks 1–3 (kanban) are the structural fix; Tasks 4–5 (api) are observability/retry honesty; Task 6 is docs.

---

### Task 1: Exclude expired leases from lane-capacity counting (P3)

`countActiveByLane` filters only `status = 'active'`. A lease whose `expires_at` has passed but which the 30s sweeper has not yet flipped to `expired` is still counted, so a lane stays "full" past the real TTL. Add an `expires_at > now` predicate.

**Files:**

- Modify: `apps/kanban/src/database/repositories/kanban-orchestration-lease.repository.ts:1-2,116-123`
- Test: `apps/kanban/src/database/repositories/kanban-orchestration-lease.repository.spec.ts`

**Interfaces:**

- Consumes: `DataSource.getRepository(KanbanOrchestrationLeaseEntity).count(...)` (TypeORM).
- Produces: `countActiveByLane(projectId: string, lane: OrchestrationLane): Promise<number>` — unchanged signature; now counts only leases with `status = 'active' AND expires_at > now`.

- [ ] **Step 1: Write the failing test**

Add to `kanban-orchestration-lease.repository.spec.ts`:

```typescript
import { MoreThan } from "typeorm";

describe("KanbanOrchestrationLeaseRepository.countActiveByLane", () => {
  it("counts only active leases that have not expired", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const dataSource = {
      getRepository: vi.fn().mockReturnValue({ count }),
    } as unknown as DataSource;
    const repo = new KanbanOrchestrationLeaseRepository(dataSource);

    await repo.countActiveByLane("p1", "strategy");

    const whereArg = count.mock.calls[0][0].where;
    expect(whereArg.project_id).toBe("p1");
    expect(whereArg.lane).toBe("strategy");
    expect(whereArg.status).toBe("active");
    // expires_at must be a MoreThan(now) operator, not absent.
    expect(whereArg.expires_at).toBeDefined();
    expect(whereArg.expires_at._type).toBe("moreThan");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- run kanban-orchestration-lease.repository`
Expected: FAIL — `whereArg.expires_at` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `kanban-orchestration-lease.repository.ts`, extend the typeorm import (line 2) and the method (lines 116-123):

```typescript
import { DataSource, type EntityManager, LessThan, MoreThan } from "typeorm";
```

```typescript
  countActiveByLane(
    projectId: string,
    lane: OrchestrationLane,
  ): Promise<number> {
    return this.dataSource
      .getRepository(KanbanOrchestrationLeaseEntity)
      .count({
        where: {
          project_id: projectId,
          lane,
          status: "active",
          expires_at: MoreThan(new Date()),
        },
      });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- run kanban-orchestration-lease.repository`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/kanban/src/database/repositories/kanban-orchestration-lease.repository.ts apps/kanban/src/database/repositories/kanban-orchestration-lease.repository.spec.ts
git commit -m "fix(kanban): exclude expired leases from lane-capacity count

A lease past its expires_at but not yet swept kept a lane 'full',
blocking acquirers past the real TTL. Count only unexpired active leases."
```

---

### Task 2: Report the real lane holder on capacity denial (P2)

When the lane is full, `acquireMutationLeases` returns `acquired:false` with conflicts fabricated from the _requested_ keys and `heldByOwnerId: "lane_capacity"`. The executor then renders `Mutation blocked — conflicting lease(s) held: work_item:<id>`, which points at a non-existent work-item lease. Return the **actual** active lane leases as the conflicts, and make the executor message name the lane and the real holder.

**Files:**

- Modify: `apps/kanban/src/orchestration/control-plane/orchestration-lease.service.ts:74-104`
- Modify: `apps/kanban/src/orchestration/control-plane/orchestration-decision-executor.service.ts:100-107`
- Add repo helper: `apps/kanban/src/database/repositories/kanban-orchestration-lease.repository.ts` (new `listActiveByLane`)
- Test: `apps/kanban/src/orchestration/control-plane/orchestration-lease.service.spec.ts`
- Test: `apps/kanban/src/orchestration/control-plane/orchestration-decision-executor.service.spec.ts`

**Interfaces:**

- Consumes: `LeaseConflict` (`control-plane.types.ts:213-218`), `KanbanOrchestrationLeaseEntity`.
- Produces:
  - `KanbanOrchestrationLeaseRepository.listActiveByLane(projectId: string, lane: OrchestrationLane): Promise<KanbanOrchestrationLeaseEntity[]>` — active, unexpired leases in the lane.
  - `acquireMutationLeases(...)` unchanged signature; on capacity denial, `conflicts` now describe the real holders (`heldByOwnerKind`, `heldByOwnerId`, `expiresAt` from the held leases), tagged with `conflictKey { kind: "workflow_scope", value: "lane_capacity:<lane>" }`.

- [ ] **Step 1: Write the failing test (repository helper)**

Add to `kanban-orchestration-lease.repository.spec.ts`:

```typescript
describe("KanbanOrchestrationLeaseRepository.listActiveByLane", () => {
  it("returns active unexpired leases scoped to the lane", async () => {
    const find = vi.fn().mockResolvedValue([]);
    const dataSource = {
      getRepository: vi.fn().mockReturnValue({ find }),
    } as unknown as DataSource;
    const repo = new KanbanOrchestrationLeaseRepository(dataSource);

    await repo.listActiveByLane("p1", "strategy");

    const whereArg = find.mock.calls[0][0].where;
    expect(whereArg.project_id).toBe("p1");
    expect(whereArg.lane).toBe("strategy");
    expect(whereArg.status).toBe("active");
    expect(whereArg.expires_at._type).toBe("moreThan");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test --workspace=apps/kanban -- run kanban-orchestration-lease.repository`
Expected: FAIL — `repo.listActiveByLane is not a function`.

- [ ] **Step 3: Implement the repository helper**

In `kanban-orchestration-lease.repository.ts`, add after `countActiveByLane`:

```typescript
  listActiveByLane(
    projectId: string,
    lane: OrchestrationLane,
  ): Promise<KanbanOrchestrationLeaseEntity[]> {
    return this.dataSource
      .getRepository(KanbanOrchestrationLeaseEntity)
      .find({
        where: {
          project_id: projectId,
          lane,
          status: "active",
          expires_at: MoreThan(new Date()),
        },
      });
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test --workspace=apps/kanban -- run kanban-orchestration-lease.repository`
Expected: PASS.

- [ ] **Step 5: Write the failing test (service reports real holders)**

Add to `orchestration-lease.service.spec.ts` (mock the repo with both `countActiveByLane` and `listActiveByLane`):

```typescript
it("reports the real lane holders when capacity is exhausted", async () => {
  const heldLease = {
    conflict_key_kind: "workflow_scope",
    conflict_key_value: "project_orchestration_cycle_ceo:p1",
    owner_kind: "cycle_request",
    owner_id: "core_lifecycle_stream:work_item_completed",
    expires_at: new Date("2026-06-22T13:52:01.000Z"),
  };
  const leases = {
    countActiveByLane: vi.fn().mockResolvedValue(1),
    listActiveByLane: vi.fn().mockResolvedValue([heldLease]),
    acquire: vi.fn(),
  };
  const service = new OrchestrationLeaseService(leases as never);

  const result = await service.acquireMutationLeases({
    projectId: "p1",
    lane: "strategy",
    ownerId: "kanban.work_item_transition_status:ceo-decision:p1:hash",
    conflictKeys: [{ kind: "work_item", value: "a9a08b37" }],
    laneCapacity: 1,
  });

  expect(result.acquired).toBe(false);
  if (result.acquired) throw new Error("expected denial");
  expect(leases.acquire).not.toHaveBeenCalled();
  expect(result.conflicts).toHaveLength(1);
  expect(result.conflicts[0].heldByOwnerKind).toBe("cycle_request");
  expect(result.conflicts[0].heldByOwnerId).toBe(
    "core_lifecycle_stream:work_item_completed",
  );
  expect(result.conflicts[0].conflictKey.value).toBe("lane_capacity:strategy");
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm run test --workspace=apps/kanban -- run orchestration-lease.service`
Expected: FAIL — current code reports `heldByOwnerId: "lane_capacity"` and maps over `conflictKeys`.

- [ ] **Step 7: Implement honest capacity-denial conflicts**

In `orchestration-lease.service.ts`, replace the capacity branch in `acquireMutationLeases` (lines 82-96):

```typescript
const active = await this.leases.countActiveByLane(input.projectId, input.lane);
if (active >= input.laneCapacity) {
  const holders = await this.leases.listActiveByLane(
    input.projectId,
    input.lane,
  );
  return {
    acquired: false,
    conflicts: holders.map((held) => ({
      conflictKey: {
        kind: "workflow_scope" as const,
        value: `lane_capacity:${input.lane}`,
      },
      heldByOwnerKind: held.owner_kind,
      heldByOwnerId: held.owner_id,
      expiresAt: new Date(held.expires_at).toISOString(),
    })),
  };
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npm run test --workspace=apps/kanban -- run orchestration-lease.service`
Expected: PASS.

- [ ] **Step 9: Write the failing test (executor honest message)**

Add to `orchestration-decision-executor.service.spec.ts` a case where `acquireMutationLeases` resolves to the denial shape above and assert the thrown message:

```typescript
it("throws a lane-capacity error naming the real holder", async () => {
  const leaseService = {
    acquireMutationLeases: vi.fn().mockResolvedValue({
      acquired: false,
      conflicts: [
        {
          conflictKey: {
            kind: "workflow_scope",
            value: "lane_capacity:strategy",
          },
          heldByOwnerKind: "cycle_request",
          heldByOwnerId: "core_lifecycle_stream:work_item_completed",
          expiresAt: "2026-06-22T13:52:01.000Z",
        },
      ],
    }),
    releaseOwned: vi.fn(),
  };
  // scheduler is unused on this path; pass a minimal stub.
  const executor = new OrchestrationDecisionExecutorService(
    {} as never,
    leaseService as never,
  );

  await expect(
    executor.executeDirectMutationDecision({
      projectId: "p1",
      requester: "kanban.work_item_transition_status",
      structuredDecision: {
        action: "transition_work_item_status",
        lane: "strategy",
        intent_type: "validate_project_health",
        reason: "Transition a9a08b37 to ready-to-merge",
        work_item_ids: ["a9a08b37"],
        target_status: "ready-to-merge",
        evidence: [{ kind: "tool_result", id: "x" }],
      },
      execute: () => Promise.resolve("unused"),
    }),
  ).rejects.toThrow(/lane_capacity_exhausted.*strategy.*cycle_request/s);
  expect(leaseService.releaseOwned).not.toHaveBeenCalled();
});
```

- [ ] **Step 10: Run to verify it fails**

Run: `npm run test --workspace=apps/kanban -- run orchestration-decision-executor.service`
Expected: FAIL — current message is `Mutation blocked — conflicting lease(s) held: workflow_scope:lane_capacity:strategy`.

- [ ] **Step 11: Implement the honest executor error**

In `orchestration-decision-executor.service.ts`, replace the denial block (lines 100-107):

```typescript
if (!lease.acquired) {
  const laneCapacityConflicts = lease.conflicts.filter((c) =>
    c.conflictKey.value.startsWith("lane_capacity:"),
  );
  if (laneCapacityConflicts.length > 0) {
    const holders = laneCapacityConflicts
      .map(
        (c) => `${c.heldByOwnerKind}:${c.heldByOwnerId} (until ${c.expiresAt})`,
      )
      .join(", ");
    throw new BadRequestException(
      `lane_capacity_exhausted — lane "${parsed.data.lane}" is full, held by: ${holders}`,
    );
  }
  const keys = lease.conflicts
    .map((c) => `${c.conflictKey.kind}:${c.conflictKey.value}`)
    .join(", ");
  throw new BadRequestException(
    `Mutation blocked — conflicting lease(s) held: ${keys}`,
  );
}
```

- [ ] **Step 12: Run to verify it passes**

Run: `npm run test --workspace=apps/kanban -- run orchestration-decision-executor.service`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add apps/kanban/src/orchestration/control-plane/orchestration-lease.service.ts apps/kanban/src/orchestration/control-plane/orchestration-lease.service.spec.ts apps/kanban/src/orchestration/control-plane/orchestration-decision-executor.service.ts apps/kanban/src/orchestration/control-plane/orchestration-decision-executor.service.spec.ts apps/kanban/src/database/repositories/kanban-orchestration-lease.repository.ts apps/kanban/src/database/repositories/kanban-orchestration-lease.repository.spec.ts
git commit -m "fix(kanban): honest lane-capacity denial naming the real holder

Capacity denial fabricated a work_item conflict key and hid the real
lane holder. Report the actual active lane leases and raise a distinct
lane_capacity_exhausted error so contention isn't mis-diagnosed."
```

---

### Task 3: Route work-item status transitions off the single-slot strategy lane (P1 — primary fix)

The `strategy` lane has capacity 1 and is held by the long-lived CEO `cycle_request` lease. Mechanical single-work-item status transitions don't need strategic serialization — per-item exclusivity is already guaranteed by the unique `work_item` conflict-key index. Give transitions a dedicated lane with real concurrency.

**Files:**

- Modify: `apps/kanban/src/orchestration/control-plane/control-plane.types.ts:1-12`
- Create: `apps/kanban/src/orchestration/control-plane/lane-capacity.constants.ts`
- Modify: `apps/kanban/src/orchestration/control-plane/orchestration-decision-executor.service.ts:144-148`
- Modify: `apps/kanban/src/mcp/tools/mutation/work-item-transition-status.tool.ts:125-133`
- Test: `apps/kanban/src/orchestration/control-plane/orchestration-decision-executor.service.spec.ts`
- Test: `apps/kanban/src/mcp/tools/mutation/work-item-transition-status.tool.spec.ts`

**Interfaces:**

- Consumes: `OrchestrationLane` union.
- Produces:
  - `OrchestrationLane` gains `"work_item_transition"`.
  - `LANE_CAPACITY: Record<OrchestrationLane, number>` and `DEFAULT_LANE_CAPACITY: number` exported from `lane-capacity.constants.ts`.
  - `resolveLaneCapacity(lane: string): number` returns `LANE_CAPACITY[lane] ?? DEFAULT_LANE_CAPACITY`.
  - `WorkItemTransitionStatusTool` emits `lane: "work_item_transition"`.

- [ ] **Step 1: Write the failing test (new lane has its own capacity)**

Add to `orchestration-decision-executor.service.spec.ts`. `resolveLaneCapacity` is private; assert it via the existing public path or export the constants and test those directly. Test the constants module:

Create `apps/kanban/src/orchestration/control-plane/lane-capacity.constants.spec.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  LANE_CAPACITY,
  DEFAULT_LANE_CAPACITY,
} from "./lane-capacity.constants";

describe("LANE_CAPACITY", () => {
  it("keeps the strategy lane serialized at one slot", () => {
    expect(LANE_CAPACITY.strategy).toBe(1);
  });

  it("gives work-item transitions real concurrency separate from strategy", () => {
    expect(LANE_CAPACITY.work_item_transition).toBeGreaterThan(1);
  });

  it("falls back to the default for unmapped lanes", () => {
    expect(DEFAULT_LANE_CAPACITY).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test --workspace=apps/kanban -- run lane-capacity.constants`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Add the lane to the union**

In `control-plane.types.ts`, extend `OrchestrationLane` (lines 1-12):

```typescript
export type OrchestrationLane =
  | "discovery"
  | "specification"
  | "work_item_generation"
  | "dispatch"
  | "implementation"
  | "review"
  | "merge"
  | "repair"
  | "upstream_analysis"
  | "strategy"
  | "work_item_transition"
  | "project_health";
```

- [ ] **Step 4: Create the capacity constants**

Create `apps/kanban/src/orchestration/control-plane/lane-capacity.constants.ts`:

```typescript
import type { OrchestrationLane } from "./control-plane.types";

/** Default lane capacity for lanes without an explicit limit. */
export const DEFAULT_LANE_CAPACITY = 2;

/**
 * Concurrency cap per orchestration lane. `strategy` stays at 1 to serialize
 * the project CEO cycle. `work_item_transition` carries mechanical single-item
 * status flips, which are already serialized per item by the unique work_item
 * conflict-key index, so it allows real concurrency and never contends with the
 * strategy/cycle lease.
 */
export const LANE_CAPACITY: Record<OrchestrationLane, number> = {
  discovery: DEFAULT_LANE_CAPACITY,
  specification: DEFAULT_LANE_CAPACITY,
  work_item_generation: DEFAULT_LANE_CAPACITY,
  dispatch: 4,
  implementation: 4,
  review: DEFAULT_LANE_CAPACITY,
  merge: DEFAULT_LANE_CAPACITY,
  repair: DEFAULT_LANE_CAPACITY,
  upstream_analysis: DEFAULT_LANE_CAPACITY,
  strategy: 1,
  work_item_transition: 4,
  project_health: DEFAULT_LANE_CAPACITY,
};
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test --workspace=apps/kanban -- run lane-capacity.constants`
Expected: PASS.

- [ ] **Step 6: Point `resolveLaneCapacity` at the constants**

In `orchestration-decision-executor.service.ts`, add the import near the top and replace `resolveLaneCapacity` (lines 144-148):

```typescript
import {
  DEFAULT_LANE_CAPACITY,
  LANE_CAPACITY,
} from "./lane-capacity.constants";
import type { OrchestrationLane } from "./control-plane.types";
```

```typescript
  private resolveLaneCapacity(lane: string): number {
    return (
      LANE_CAPACITY[lane as OrchestrationLane] ?? DEFAULT_LANE_CAPACITY
    );
  }
```

- [ ] **Step 7: Run the executor suite to confirm no regression**

Run: `npm run test --workspace=apps/kanban -- run orchestration-decision-executor.service`
Expected: PASS (existing strategy/dispatch capacity behaviour preserved).

- [ ] **Step 8: Write the failing test (transition tool uses the new lane)**

In `work-item-transition-status.tool.spec.ts`, assert the structured decision passed to the executor carries `lane: "work_item_transition"`. Capture the executor call:

```typescript
it("routes the status transition through the work_item_transition lane", async () => {
  // arrange the tool with a mocked decisionExecutor that captures its input
  const executeDirectMutationDecision = vi.fn().mockResolvedValue({ ok: true });
  // ...wire workItems/factSnapshot/kanbanSettings stubs as the existing tests do...

  await tool.execute(context, {
    project_id: "p1",
    workItemId: "a9a08b37",
    status: "ready-to-merge",
  });

  const decision =
    executeDirectMutationDecision.mock.calls[0][0].structuredDecision;
  expect(decision.lane).toBe("work_item_transition");
  expect(decision.action).toBe("transition_work_item_status");
});
```

(Reuse the existing spec's setup helpers — the file already constructs the tool with mocked `WorkItemService`, `OrchestrationFactSnapshotService`, and `KanbanSettingsService`. Mirror them and replace `decisionExecutor` with the capturing mock above.)

- [ ] **Step 9: Run to verify it fails**

Run: `npm run test --workspace=apps/kanban -- run work-item-transition-status.tool`
Expected: FAIL — `decision.lane` is `"strategy"`.

- [ ] **Step 10: Implement the lane change**

In `work-item-transition-status.tool.ts`, change the `structuredDecision.lane` (line 127) from `"strategy"` to `"work_item_transition"`:

```typescript
      structuredDecision: {
        action: "transition_work_item_status",
        lane: "work_item_transition",
        intent_type: "validate_project_health",
        reason: `Transition ${params.workItemId} to ${status}`,
        work_item_ids: [params.workItemId],
        target_status: status,
        evidence: [{ kind: "tool_result", id: "transition-status-input" }],
      },
```

- [ ] **Step 11: Run to verify it passes**

Run: `npm run test --workspace=apps/kanban -- run work-item-transition-status.tool`
Expected: PASS.

- [ ] **Step 12: Verify the structured-decision schema accepts the new lane**

If `structuredDecisionSchema` constrains `lane` to an enum, it derives from `OrchestrationLane`; confirm it parses. Run the broader control-plane suite:

Run: `npm run test --workspace=apps/kanban -- run control-plane`
Expected: PASS. If a Zod lane enum is hardcoded separately (search `z.enum` for lanes in `structured-decision.types.ts`), add `"work_item_transition"` there and re-run.

- [ ] **Step 13: Commit**

```bash
git add apps/kanban/src/orchestration/control-plane/control-plane.types.ts apps/kanban/src/orchestration/control-plane/lane-capacity.constants.ts apps/kanban/src/orchestration/control-plane/lane-capacity.constants.spec.ts apps/kanban/src/orchestration/control-plane/orchestration-decision-executor.service.ts apps/kanban/src/mcp/tools/mutation/work-item-transition-status.tool.ts apps/kanban/src/mcp/tools/mutation/work-item-transition-status.tool.spec.ts
git commit -m "fix(kanban): give work-item status transitions their own lane

Single-item transitions shared the capacity-1 strategy lane with the
long-lived CEO cycle lease, so a concurrent cycle blocked them for up to
the 10-min TTL. Per-item exclusivity is already guaranteed by the unique
work_item conflict-key index; route transitions to a dedicated lane with
real concurrency and centralize lane capacities in a named constant map."
```

---

### Task 4: Classify resource-contention failures distinctly (P4)

A lane-capacity / lease block currently classifies as `generic_failure` and retries with blind exponential backoff. Add a `resource_contention` reason code so the contention is named in retry telemetry and the event ledger, while keeping the standard bounded retry path.

**Files:**

- Modify: `apps/api/src/workflow/workflow-failure-classification.types.ts:1-15`
- Modify: `apps/api/src/workflow/workflow-failure-classification.helpers.ts:44-61`
- Test: `apps/api/src/workflow/workflow-failure-classification.helpers.spec.ts`

**Interfaces:**

- Consumes: `classifyWorkflowFailure(params: { reason: string; providerOverloadDelayMs: number; rateLimitResetBufferMs?: number }): WorkflowFailureClassification`.
- Produces: `WorkflowFailureClassification.retryCategory` gains `'resource_contention'`; reason `lane_capacity_exhausted` / `conflicting lease` → `{ reasonCode: 'resource_contention', retryCategory: 'resource_contention' }`.

- [ ] **Step 1: Write the failing test**

Add to `workflow-failure-classification.helpers.spec.ts`:

```typescript
it("classifies lane-capacity exhaustion as resource_contention", () => {
  const result = classifyWorkflowFailure({
    reason:
      'MCP HTTP request failed (-32000): lane_capacity_exhausted — lane "work_item_transition" is full',
    providerOverloadDelayMs: 1000,
  });
  expect(result.reasonCode).toBe("resource_contention");
  expect(result.retryCategory).toBe("resource_contention");
});

it("classifies a conflicting lease as resource_contention", () => {
  const result = classifyWorkflowFailure({
    reason: "Mutation blocked — conflicting lease(s) held: work_item:a9a08b37",
    providerOverloadDelayMs: 1000,
  });
  expect(result.reasonCode).toBe("resource_contention");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test --workspace=apps/api -- run workflow-failure-classification`
Expected: FAIL — returns `reasonCode: 'generic_failure'`.

- [ ] **Step 3: Widen the type**

In `workflow-failure-classification.types.ts`, extend `retryCategory` (lines 3-6):

```typescript
  retryCategory:
    | 'default'
    | 'provider_overload_529'
    | 'provider_rate_limit_429'
    | 'resource_contention';
```

- [ ] **Step 4: Implement the classification**

In `workflow-failure-classification.helpers.ts`, add a marker constant near the top and a branch before the `generic_failure` fallback (insert after line 49, before line 51):

```typescript
const RESOURCE_CONTENTION_PATTERN =
  /lane_capacity_exhausted|conflicting lease|Mutation blocked|lease capacity/i;
```

```typescript
if (RESOURCE_CONTENTION_PATTERN.test(params.reason)) {
  return {
    reasonCode: "resource_contention",
    retryCategory: "resource_contention",
  };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test --workspace=apps/api -- run workflow-failure-classification`
Expected: PASS.

- [ ] **Step 6: Confirm the retry decision maps it through**

`resolveWorkflowRetryDecision` (`workflow-provider-overload-retry.helpers.ts:70-72`) returns `{ reasonCode }` for any non-provider category, so `resource_contention` flows to `scheduleWorkflowAutoRetry` unchanged (bounded by `maxAttempts`). No change needed; verify with:

Run: `npm run test --workspace=apps/api -- run workflow-provider-overload-retry`
Expected: PASS (or no such suite — acceptable; the type widening is the only contract change).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/workflow/workflow-failure-classification.types.ts apps/api/src/workflow/workflow-failure-classification.helpers.ts apps/api/src/workflow/workflow-failure-classification.helpers.spec.ts
git commit -m "feat(api): classify lease/lane contention as resource_contention

Lane-capacity and lease conflicts were laundered into generic_failure.
Name them resource_contention so retry telemetry and the event ledger
surface the real cause."
```

---

### Task 5: Stop laundering scheduled retries as `outcome:success` (P4)

`workflow.retry_scheduled` is written with no `outcome`, defaulting to `success`, so a run burning retries on contention reads as green and the debug bundle reports "Failures: 0". A scheduled retry follows a failed attempt — record it as `in_progress` with `warn` severity.

**Files:**

- Modify: `apps/api/src/workflow/listeners/workflow-audit.listener.ts:125-133`
- Test: `apps/api/src/workflow/listeners/workflow-audit.listener.spec.ts`

**Interfaces:**

- Consumes: `EmitEventLedgerParams` (`event-ledger.service.types.ts`) — accepts optional `outcome` and `severity`.
- Produces: `onRetryScheduled` appends with `outcome: 'in_progress'`, `severity: 'warn'`.

- [ ] **Step 1: Write the failing test**

Add to `workflow-audit.listener.spec.ts` (mirror the existing append-assertion style; mock `eventLog.appendBestEffort`):

```typescript
it("records scheduled retries as in_progress, not success", async () => {
  const appendBestEffort = vi.fn().mockResolvedValue(undefined);
  const listener = makeListener({ appendBestEffort }); // existing helper / inline construct

  await listener.onRetryScheduled({
    workflowRunId: "run-1",
    workflowId: "wf-1",
    jobId: "apply_qa_decision",
    payload: { attempt: 1, reasonCode: "resource_contention" },
  });

  const arg = appendBestEffort.mock.calls[0][0];
  expect(arg.eventType).toBe("workflow.retry_scheduled");
  expect(arg.outcome).toBe("in_progress");
  expect(arg.severity).toBe("warn");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test --workspace=apps/api -- run workflow-audit.listener`
Expected: FAIL — `arg.outcome` is `undefined`.

- [ ] **Step 3: Implement the outcome/severity**

In `workflow-audit.listener.ts`, update `onRetryScheduled` (lines 125-133):

```typescript
  @OnEvent(WORKFLOW_RUN_RETRY_SCHEDULED_EVENT)
  async onRetryScheduled(event: WorkflowJobEvent): Promise<void> {
    await this.eventLog.appendBestEffort({
      workflowRunId: event.workflowRunId,
      eventType: 'workflow.retry_scheduled',
      jobId: event.jobId,
      payload: event.payload,
      outcome: 'in_progress',
      severity: 'warn',
    });
  }
```

(If `appendBestEffort`'s param type does not yet accept `outcome`/`severity`, thread them through `EmitEventLedgerParams` in `event-ledger.service.types.ts` — `outcome` is already optional there at line 32; add `severity?: EventLedger['severity']` if missing, and pass them in `appendBestEffort` to `buildLedgerEntry`, which already reads `params.severity` at `event-ledger.service.ts:130`.)

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test --workspace=apps/api -- run workflow-audit.listener`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/listeners/workflow-audit.listener.ts apps/api/src/workflow/listeners/workflow-audit.listener.spec.ts apps/api/src/observability/event-ledger.service.types.ts
git commit -m "fix(api): record scheduled retries as in_progress not success

retry_scheduled defaulted to outcome:success, so runs burning retries on
contention read as green and the debug bundle showed zero failures. Mark
them in_progress/warn so contention is visible."
```

---

### Task 6: Documentation

Update the orchestration lease/lane documentation to reflect the new lane and capacity model, and the honest contention error.

**Files:**

- Modify: the orchestration lease/control-plane guide doc. Find it: `grep -ril "orchestration" docs/guide` then the lease/lane section (e.g. a control-plane or dispatch doc). If none exists, add a short section to `docs/guide/README.md`'s orchestration area.

- [ ] **Step 1: Locate the doc**

Run: `grep -rl "lane\|lease\|control-plane\|cycle lease" docs/guide docs/architecture`
Pick the orchestration control-plane document (or `apps/kanban/README.md` if that is where lease semantics are documented).

- [ ] **Step 2: Update content**

Document:

- Lanes and their capacities, sourced from `LANE_CAPACITY` (`apps/kanban/src/orchestration/control-plane/lane-capacity.constants.ts`).
- That `strategy` is capacity 1 to serialize the project CEO cycle, and that single-work-item status transitions run in the separate `work_item_transition` lane (capacity 4) and are serialized per item by the unique `work_item` conflict-key index — they do not contend with the cycle lease.
- That lane-capacity exhaustion raises `lane_capacity_exhausted` naming the real holder (not a fabricated `work_item:<id>` conflict), and classifies as `resource_contention` in retry telemetry.
- Reference run `989e9bfc` as the motivating incident.

- [ ] **Step 3: Commit**

```bash
git add docs/
git commit -m "docs(orchestration): document lane capacities and contention handling"
```

---

### Final Verification

- [ ] **Step 1: Full kanban unit suite**

Run: `npm run test:kanban`
Expected: PASS.

- [ ] **Step 2: Full api unit suite**

Run: `npm run test:api`
Expected: PASS.

- [ ] **Step 3: Lint both workspaces**

Run: `npm run lint:kanban && npm run lint:api`
Expected: 0 errors.

- [ ] **Step 4: Build (TypeORM/Nest reflection intact)**

Run: `npm run build:kanban && npm run build:api`
Expected: success.

- [ ] **Step 5: Deploy + live re-verify**

Rebuild and redeploy the kanban and API services (`docker compose up -d --build`). Then re-trigger a `work-item-in-review-default` run while a CEO cycle is active on the same project and confirm `apply_qa_decision` acquires its lane slot without blocking. Confirm any genuine contention now appears in the debug bundle as `in_progress`/`warn` `workflow.retry_scheduled` rows with `reasonCode: resource_contention`, and that the error names the real holder.

---

## Self-Review

**Spec coverage:**

- P1 (strategy-lane contention) → Task 3 (dedicated lane + capacity map).
- P2 (misleading error) → Task 2 (real holders + `lane_capacity_exhausted` message).
- P3 (expired leases counted) → Task 1 (`expires_at > now`).
- P4 (laundered success + wrong retry class) → Task 4 (`resource_contention` classification) + Task 5 (`in_progress`/`warn` retry events).
- P5 (stranding on exhaustion) → addressed transitively: Task 3 removes the dominant block so exhaustion is far less likely; Task 5 makes any genuine terminal failure visible rather than green. No separate task — the existing terminal-failure path (`workflow-run-job-execution.service.ts:347-353`) already fails the run once retries exhaust; the gap was visibility, fixed by Tasks 4–5.

**Placeholder scan:** Test bodies that reuse existing spec setup (Tasks 3 Step 8, Task 5 Step 1) point at the concrete existing helpers in those spec files rather than inventing new harness code; all implementation steps show full code.

**Type consistency:** `work_item_transition` added to both `OrchestrationLane` (Task 3 Step 3) and `LANE_CAPACITY` (Step 4). `resource_contention` added to both `WorkflowFailureClassification.retryCategory` (Task 4 Step 3) and returned by `classifyWorkflowFailure` (Step 4). `listActiveByLane` defined in Task 2 Step 3 and consumed in Task 2 Step 7. `lane_capacity:<lane>` conflict-key prefix produced in Task 2 Step 7 and matched in Task 2 Step 11.
