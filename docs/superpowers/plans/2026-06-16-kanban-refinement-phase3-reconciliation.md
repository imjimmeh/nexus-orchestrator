# Kanban Refinement Phase 3 — Cross-Item Plan Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Prerequisite:** Phases 1–2 merged (uses `executionConfig.implementationPlan` shape — unchanged by this phase).

**Goal:** Stop two work items whose implementation plans target the same files from being dispatched concurrently. When a `todo` candidate's plan `target_files` overlap an already in-flight item's plan, skip dispatch with a `target_files_contention_detected` reason so the items run sequentially instead of colliding at merge time.

**Architecture:** A pure helper extracts the `target_files` set from a work item's `executionConfig.implementationPlan`. `DispatchService.dispatchCandidate` gains one new skip condition — between the dependency check and the agent-capacity check — that flags overlap against items currently in flight (`linked_run_id` set / active status). Keeping the overlap logic in a pure helper makes thresholds and edge cases unit-testable without the dispatch harness.

**Tech Stack:** NestJS, TypeScript, Vitest. All in `apps/kanban/src/dispatch`.

---

## File Structure

**Create:**

- `apps/kanban/src/dispatch/plan-contention.helper.ts` — pure overlap detection (+ `.spec.ts`)

**Modify:**

- `apps/kanban/src/dispatch/dispatch.service.ts` — call the helper as a new skip condition in `dispatchCandidate`
- `apps/kanban/src/dispatch/dispatch.service.spec.ts` — add contention dispatch tests

---

## Part 1 — Pure contention helper

### Task 1: Helper — failing test

**Files:**

- Create: `apps/kanban/src/dispatch/plan-contention.helper.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import {
  extractTargetFiles,
  findTargetFileContention,
} from "./plan-contention.helper";

const planWith = (...files: string[]) => ({
  milestones: [{ name: "M1", tasks: [{ id: "1.1", target_files: files }] }],
});

describe("extractTargetFiles", () => {
  it("flattens target_files across milestones and tasks", () => {
    const files = extractTargetFiles({
      milestones: [
        { name: "M1", tasks: [{ id: "1.1", target_files: ["a.ts", "b.ts"] }] },
        { name: "M2", tasks: [{ id: "2.1", target_files: ["b.ts", "c.ts"] }] },
      ],
    });
    expect([...files].sort()).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("returns an empty set for a missing or malformed plan", () => {
    expect(extractTargetFiles(undefined).size).toBe(0);
    expect(extractTargetFiles({}).size).toBe(0);
    expect(extractTargetFiles({ milestones: "nope" }).size).toBe(0);
  });
});

describe("findTargetFileContention", () => {
  const candidate = {
    id: "cand",
    execution_config: { implementationPlan: planWith("apps/api/foo.ts") },
  };

  it("returns the conflicting in-flight item id when files overlap", () => {
    const inFlight = [
      {
        id: "active-1",
        linked_run_id: "run-1",
        execution_config: { implementationPlan: planWith("apps/api/foo.ts") },
      },
    ];
    expect(findTargetFileContention(candidate, inFlight)).toBe("active-1");
  });

  it("returns null when no files overlap", () => {
    const inFlight = [
      {
        id: "active-1",
        linked_run_id: "run-1",
        execution_config: { implementationPlan: planWith("apps/web/bar.ts") },
      },
    ];
    expect(findTargetFileContention(candidate, inFlight)).toBeNull();
  });

  it("ignores the candidate itself", () => {
    expect(findTargetFileContention(candidate, [candidate])).toBeNull();
  });

  it("ignores items without a plan", () => {
    const inFlight = [
      { id: "active-1", linked_run_id: "run-1", execution_config: null },
    ];
    expect(findTargetFileContention(candidate, inFlight)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`npm run test --workspace=apps/kanban -- plan-contention.helper.spec.ts`).

### Task 2: Helper — implementation

**Files:**

- Create: `apps/kanban/src/dispatch/plan-contention.helper.ts`

- [ ] **Step 3: Write minimal implementation**

```typescript
interface PlanCarrier {
  id: string;
  execution_config?: Record<string, unknown> | null;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

export function extractTargetFiles(plan: unknown): Set<string> {
  const files = new Set<string>();
  const milestones = asRecord(plan)?.["milestones"];
  if (!Array.isArray(milestones)) return files;
  for (const milestone of milestones) {
    const tasks = asRecord(milestone)?.["tasks"];
    if (!Array.isArray(tasks)) continue;
    for (const task of tasks) {
      const targets = asRecord(task)?.["target_files"];
      if (!Array.isArray(targets)) continue;
      for (const file of targets) {
        if (typeof file === "string" && file.length > 0) files.add(file);
      }
    }
  }
  return files;
}

function planOf(item: PlanCarrier): unknown {
  return asRecord(item.execution_config)?.["implementationPlan"];
}

/**
 * Returns the id of the first in-flight item whose plan target_files overlap the
 * candidate's, or null when there is no contention.
 */
export function findTargetFileContention(
  candidate: PlanCarrier,
  inFlight: PlanCarrier[],
): string | null {
  const candidateFiles = extractTargetFiles(planOf(candidate));
  if (candidateFiles.size === 0) return null;

  for (const other of inFlight) {
    if (other.id === candidate.id) continue;
    const otherFiles = extractTargetFiles(planOf(other));
    for (const file of candidateFiles) {
      if (otherFiles.has(file)) return other.id;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run it — expect PASS**, then commit:

```bash
git add apps/kanban/src/dispatch/plan-contention.helper.ts apps/kanban/src/dispatch/plan-contention.helper.spec.ts
git commit -m "feat(kanban): add pure plan target_files contention helper"
```

---

## Part 2 — Wire into dispatch

### Task 3: Dispatch contention skip — failing test

**Files:**

- Modify: `apps/kanban/src/dispatch/dispatch.service.spec.ts`

- [ ] **Step 5: Add tests to the existing suite**

Add these `it` blocks inside the existing `describe("DispatchService")`. They reuse the fixture/mocks already in that file (`items`, `repository.findByproject_id`, `service.dispatchReadyWorkItems`). Adjust the fixture object shape to match the file's existing `WorkItemFixture` (add `execution_config` if not already present):

```typescript
const planFixture = (file: string) => ({
  implementationPlan: {
    milestones: [{ name: "M1", tasks: [{ id: "1.1", target_files: [file] }] }],
  },
});

it("skips a todo item whose target_files overlap an in-flight item", async () => {
  items = [
    makeItem({
      id: "active",
      status: "in-progress",
      linked_run_id: "run-active",
      execution_config: planFixture("apps/api/src/foo.service.ts"),
    }),
    makeItem({
      id: "candidate",
      status: "todo",
      linked_run_id: null,
      execution_config: planFixture("apps/api/src/foo.service.ts"),
    }),
  ];

  const result = await service.dispatchReadyWorkItems({
    project_id: "project-1",
    workflowId: "implement-work-item",
  });

  expect(result.skipped).toContainEqual(
    expect.objectContaining({
      workItemId: "candidate",
      reason: "target_files_contention_detected",
    }),
  );
});

it("dispatches a todo item when target_files do not overlap", async () => {
  items = [
    makeItem({
      id: "active",
      status: "in-progress",
      linked_run_id: "run-active",
      execution_config: planFixture("apps/api/src/foo.service.ts"),
    }),
    makeItem({
      id: "candidate",
      status: "todo",
      linked_run_id: null,
      execution_config: planFixture("apps/web/src/bar.component.tsx"),
    }),
  ];

  const result = await service.dispatchReadyWorkItems({
    project_id: "project-1",
    workflowId: "implement-work-item",
  });

  expect(result.dispatched).toContainEqual(
    expect.objectContaining({ workItemId: "candidate" }),
  );
});
```

> If the existing spec builds fixtures inline rather than via a `makeItem` factory, replace `makeItem({...})` with the file's actual fixture-construction pattern (copy an existing fixture literal and set `execution_config`/`status`/`linked_run_id`).

- [ ] **Step 6: Run it — expect FAIL** (the contention skip doesn't exist yet):

Run: `npm run test --workspace=apps/kanban -- dispatch.service.spec.ts`
Expected: the overlap test fails — `candidate` is dispatched instead of skipped.

### Task 4: Add the skip condition

**Files:**

- Modify: `apps/kanban/src/dispatch/dispatch.service.ts`

- [ ] **Step 7: Import the helper**

At the top of `dispatch.service.ts`:

```typescript
import { findTargetFileContention } from "./plan-contention.helper";
```

- [ ] **Step 8: Collect the in-flight set once per dispatch pass**

In `dispatchReadyWorkItems`, where the candidate context is assembled (alongside `claimedTargetBranches` / `itemById`), compute the in-flight items (those owning a run):

```typescript
const inFlightItems = projectItems.filter(
  (candidate) =>
    candidate.linked_run_id != null ||
    candidate.status === "in-progress" ||
    candidate.status === "in-review",
);
```

Pass `inFlightItems` through the same `context` object that already carries `claimedTargetBranches`, `itemById`, etc. (add a field to the context type used by `dispatchCandidate`).

- [ ] **Step 9: Add the skip check in `dispatchCandidate`**

Insert immediately **after** the `dependenciesReady` skip and **before** the `agentCapacityReached` skip (matching the surrounding `context.result.skipped.push(...) ; return false;` style):

```typescript
const contendingId = findTargetFileContention(item, context.inFlightItems);
if (contendingId) {
  context.result.skipped.push({
    workItemId: item.id,
    reason: "target_files_contention_detected",
    detail: `Overlaps in-flight item ${contendingId}`,
  });
  return false;
}
```

- [ ] **Step 10: Run it — expect PASS**

Run: `npm run test --workspace=apps/kanban -- dispatch.service.spec.ts`
Expected: both new tests pass; all pre-existing dispatch tests still pass.

- [ ] **Step 11: Commit**

```bash
git add apps/kanban/src/dispatch/dispatch.service.ts apps/kanban/src/dispatch/dispatch.service.spec.ts
git commit -m "feat(kanban): skip dispatch on cross-item target_files contention"
```

### Task 5: Surface contention to the CEO (visibility)

The CEO sequences work; a silent skip is invisible. Make the skip reason observable.

- [ ] **Step 12: Confirm skip reasons reach project_state / dispatch results**

Run: `git grep -n "skipped\|skip_reason\|not_dispatchable" -- apps/kanban/src/mcp/tools/read/project-state.tool.ts apps/kanban/src/dispatch`
Determine whether dispatch `skipped[]` reasons are already surfaced in `kanban.project_state` or the dispatch tool result the CEO sees.

- [ ] **Step 13: Expose if missing**

If `target_files_contention_detected` is not visible to the CEO, add the contended pairs to the dispatch result/summary the CEO reads (follow the existing shape used for `target_branch_already_dispatched`). Add/extend a unit test asserting the reason appears in the surfaced result. Then commit:

```bash
git add apps/kanban/src
git commit -m "feat(kanban): surface target_files contention to orchestration"
```

> No silent caps (project convention): contention skips must be observable, not hidden.

---

## Phase 3 Verification

- [ ] **Step 14: Full kanban test + lint + build**

Run: `npm run test:kanban && npm run lint:kanban && npm run build:kanban`
Expected: all green.

- [ ] **Step 15: Live smoke (post-deploy)**

Refine two items whose plans both target the same service file. Confirm only one dispatches; the other is skipped with `target_files_contention_detected` and dispatches after the first reaches `done`.

## Notes / follow-ups

- v1 uses exact-path matching. Directory-prefix overlap (two items editing different files in the same tightly-coupled module) is deferred; revisit if merge conflicts persist despite exact-path reconciliation.
- This complements, and does not replace, the existing `target_branch_already_dispatched` claim — branch contention and file contention are distinct skip reasons.
