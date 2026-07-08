# Honor Orchestration Lifecycle `status` as an Auto-Wake Stop Signal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a project whose orchestration `status` is `completed` or `paused` from being auto-woken by automatic wake-up sources (e.g. a failed manual workflow), until it is explicitly resumed.

**Architecture:** Add a pure predicate `isStoppedLifecycleStatus(status)` to the existing stop-decision module and have the single suppression authority — `OrchestrationObservabilityService.getAutoWakeSuppressionState` — return `suppressed: true` when the persisted `status` is a stopped state, in addition to the existing `cycle_decision` check. The `requestWakeup` guard (`suppressionState.suppressed && isAutomaticWakeup(input)`) is unchanged, so automatic sources are suppressed while manual (operator) wake-ups still pass.

**Tech Stack:** TypeScript, NestJS, Vitest (kanban app: `apps/kanban`).

## Global Constraints

- Strict lint policy: never suppress lint (`eslint-disable`, `@ts-ignore`, `@ts-nocheck`, rule downgrades). Fix in code.
- Strong typing; shared contracts live in `@nexus/core` / `kanban-contracts` — do not redefine locally.
- This is a kanban-app change only. Do NOT touch `apps/api` or `packages/core`. No DB schema/migration. No change to `complete()`/`pause()` write paths or to the `requestWakeup` guard structure.
- Stopped lifecycle statuses are exactly `"completed"` and `"paused"`. Active statuses are `"initializing"` and `"orchestrating"` (`OrchestrationStatusSchema`, `packages/kanban-contracts/src/orchestration.schema.ts`).
- The contested working tree from the design session may still be settling. Confirm a clean tree and that you are on branch `fix/orchestration-autowake-honor-stopped-status` before committing.

**Reference spec:** `docs/superpowers/specs/2026-06-20-orchestration-autowake-honor-stopped-status-design.md`

---

### Task 1: Pure predicate `isStoppedLifecycleStatus`

**Files:**

- Modify: `apps/kanban/src/orchestration/orchestration-stop-decisions.ts`
- Test: `apps/kanban/src/orchestration/orchestration-stop-decisions.spec.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces: `export function isStoppedLifecycleStatus(status: string): boolean` — returns `true` for `"completed"` and `"paused"`, `false` otherwise.

- [ ] **Step 1: Write the failing test**

Append to `apps/kanban/src/orchestration/orchestration-stop-decisions.spec.ts`. First add `isStoppedLifecycleStatus` to the existing top-of-file import:

```ts
import {
  isStoppedLifecycleStatus,
  resolveNonAutoWakeDecision,
} from "./orchestration-stop-decisions";
```

Then add a new `describe` block at the end of the file:

```ts
describe("isStoppedLifecycleStatus", () => {
  it.each(["completed", "paused"])(
    "treats %s as a stopped lifecycle status",
    (status) => {
      expect(isStoppedLifecycleStatus(status)).toBe(true);
    },
  );

  it.each(["orchestrating", "initializing", ""])(
    "treats %s as an active lifecycle status",
    (status) => {
      expect(isStoppedLifecycleStatus(status)).toBe(false);
    },
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- orchestration-stop-decisions`
Expected: FAIL — `isStoppedLifecycleStatus is not a function` (or a TS/import error).

- [ ] **Step 3: Write minimal implementation**

In `apps/kanban/src/orchestration/orchestration-stop-decisions.ts`, add the constant near the existing `NON_AUTO_WAKE_DECISIONS` / `CYCLE_DECISIONS` sets, and export the predicate:

```ts
const STOPPED_LIFECYCLE_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "paused",
]);

export function isStoppedLifecycleStatus(status: string): boolean {
  return STOPPED_LIFECYCLE_STATUSES.has(status);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- orchestration-stop-decisions`
Expected: PASS (all cases in both describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add apps/kanban/src/orchestration/orchestration-stop-decisions.ts apps/kanban/src/orchestration/orchestration-stop-decisions.spec.ts
git commit -m "feat(kanban): add isStoppedLifecycleStatus predicate for auto-wake gating"
```

---

### Task 2: Suppress auto-wake on stopped `status`

**Files:**

- Modify: `apps/kanban/src/orchestration/orchestration-observability.service.ts`
- Test (create): `apps/kanban/src/orchestration/orchestration-observability.service.spec.ts`

**Interfaces:**

- Consumes: `isStoppedLifecycleStatus(status: string): boolean` (Task 1); `OrchestrationPersistenceRecord` (`./orchestration-internal.types`).
- Produces: unchanged public signature `getAutoWakeSuppressionState(state: OrchestrationPersistenceRecord | null): { suppressed: boolean; decision?: StopCycleDecision }`. New behavior: `suppressed` is `true` when the existing decision check matches **or** `state.status` is a stopped lifecycle status. `decision` is still only set when a decision-based suppression matched.

- [ ] **Step 1: Write the failing test**

Create `apps/kanban/src/orchestration/orchestration-observability.service.spec.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { OrchestrationObservabilityService } from "./orchestration-observability.service";
import type { OrchestrationPersistenceRecord } from "./orchestration-internal.types";

describe("OrchestrationObservabilityService.getAutoWakeSuppressionState", () => {
  const buildService = () =>
    new OrchestrationObservabilityService({
      findWorkItemsByProjectId: vi.fn().mockResolvedValue([]),
    });

  const buildState = (
    overrides: Partial<OrchestrationPersistenceRecord>,
  ): OrchestrationPersistenceRecord => ({
    project_id: "p1",
    goals: "",
    mode: "autonomous",
    status: "orchestrating",
    linked_run_id: null,
    decision_log: [],
    action_requests: [],
    metadata: {},
    created_at: new Date(0),
    updated_at: new Date(0),
    ...overrides,
  });

  it("suppresses when status is completed even though the last decision is repeat", () => {
    // Reproduces run 7a8be0c5: status completed + cycle_decision repeat.
    const state = buildState({
      status: "completed",
      metadata: { cycle_decision: "repeat" },
    });

    expect(buildService().getAutoWakeSuppressionState(state)).toEqual({
      suppressed: true,
    });
  });

  it("suppresses when status is paused", () => {
    const state = buildState({ status: "paused" });

    expect(buildService().getAutoWakeSuppressionState(state)).toEqual({
      suppressed: true,
    });
  });

  it("does not suppress the normal autonomous loop (orchestrating + repeat)", () => {
    const state = buildState({
      status: "orchestrating",
      metadata: { cycle_decision: "repeat" },
    });

    expect(buildService().getAutoWakeSuppressionState(state)).toEqual({
      suppressed: false,
    });
  });

  it("still surfaces an explicit stop decision while orchestrating", () => {
    const state = buildState({
      status: "orchestrating",
      metadata: { cycle_decision: "pause" },
    });

    expect(buildService().getAutoWakeSuppressionState(state)).toEqual({
      suppressed: true,
      decision: "pause",
    });
  });

  it("returns not-suppressed for a null state", () => {
    expect(buildService().getAutoWakeSuppressionState(null)).toEqual({
      suppressed: false,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- orchestration-observability.service`
Expected: FAIL — the `completed` and `paused` cases return `{ suppressed: false }` (current code reads only the cycle decision).

- [ ] **Step 3: Write minimal implementation**

In `apps/kanban/src/orchestration/orchestration-observability.service.ts`, extend the existing import on line 6:

```ts
import {
  isStoppedLifecycleStatus,
  resolveNonAutoWakeDecision,
} from "./orchestration-stop-decisions";
```

Then update `getAutoWakeSuppressionState` (currently lines 196–206) to:

```ts
  getAutoWakeSuppressionState(state: OrchestrationPersistenceRecord | null): {
    suppressed: boolean;
    decision?: StopCycleDecision;
  } {
    const decision = state ? resolveNonAutoWakeDecision(state) : undefined;
    const statusStopped = state
      ? isStoppedLifecycleStatus(state.status)
      : false;

    return {
      suppressed: decision !== undefined || statusStopped,
      ...(decision !== undefined ? { decision } : {}),
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- orchestration-observability.service`
Expected: PASS (all five cases green).

- [ ] **Step 5: Run the neighboring suites to confirm no regression**

Run: `npm run test --workspace=apps/kanban -- project-orchestration-wakeup.service orchestration-stop-decisions`
Expected: PASS — the existing wake-up guard tests still pass (the guard is unchanged; it consumes `suppressed`).

- [ ] **Step 6: Commit**

```bash
git add apps/kanban/src/orchestration/orchestration-observability.service.ts apps/kanban/src/orchestration/orchestration-observability.service.spec.ts
git commit -m "fix(kanban): suppress auto-wake when orchestration status is completed/paused

A project marked completed/paused kept cycle_decision=repeat, so the
auto-wake suppression (which read only the cycle decision) left it armed
and a failed manual workflow re-woke the CEO loop (run 7a8be0c5). Honor
the lifecycle status as a stop signal in the single suppression authority."
```

---

### Task 3: Document the status-based gate and its deliberate consequence

**Files:**

- Modify: `docs/guide/23-kanban-orchestration.md:243`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Update Wake-Up Gate #2**

In `docs/guide/23-kanban-orchestration.md`, replace the gate #2 line (currently line 243):

```markdown
2. **Auto-wake suppression**: If the CEO previously made a `pause` or `complete` cycle decision, automatic wake-ups are suppressed.
```

with:

```markdown
2. **Auto-wake suppression**: Automatic wake-ups are suppressed when the project is in a stopped state — either the CEO previously made a `pause`/`complete`/`blocked` cycle decision, **or** the orchestration lifecycle `status` is `completed` or `paused` (set by the `complete_orchestration` tool or the operator UI). A stopped project stays asleep for **all** automatic sources (lifecycle stream, continuation reconciler, revision-complete) — including the failure of a manually-triggered workflow in its scope — until it is explicitly resumed (`resume`/`start`, which sets `status` back to `orchestrating`). Manual (operator-initiated) wake-ups always bypass this gate.
```

- [ ] **Step 2: Verify the doc reads correctly**

Run: `npm run lint:summary` (or visually confirm the gate list still numbers 1–5 and renders).
Expected: gate list intact; no markdown lint regressions introduced by this edit.

- [ ] **Step 3: Commit**

```bash
git add docs/guide/23-kanban-orchestration.md
git commit -m "docs(guide): document status-based auto-wake suppression gate"
```

---

## Final Verification

- [ ] Run the full kanban unit suite: `npm run test:kanban` — Expected: PASS.
- [ ] Run kanban lint: `npm run lint:kanban` — Expected: no errors.
- [ ] Live re-verify after kanban rebuild/redeploy (manual, per spec): mark a project `completed`; fail a manual workflow in its scope; confirm **no** `ProjectOrchestrationCycleRequestedEvent` / CEO cycle is dispatched; then `resume` the project and confirm auto-wake re-arms on the next terminal event.

## Notes for the implementer

- The `requestWakeup` guard in `apps/kanban/src/orchestration/project-orchestration-wakeup.service.ts` is intentionally **not** modified — it already does `if (suppressionState.suppressed && this.isAutomaticWakeup(input)) return { emitted: false, reason: "orchestration_auto_wake_suppressed" }`. All new behavior flows through `getAutoWakeSuppressionState`.
- Do not also write a `cycle_decision` inside `complete()`/`pause()` — single source of truth is the `status` column (see spec "Why honor `status`"). Adding that would be redundant and is out of scope.
- `getAutoWakeSuppressionState` uses no constructor dependencies, so the test instantiates the service with a stub `findWorkItemsByProjectId` only.
