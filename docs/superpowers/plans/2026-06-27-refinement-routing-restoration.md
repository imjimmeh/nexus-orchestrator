# Refinement Routing Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a working producer that routes work items into the `refinement` status — both a deterministic engine gate (driven by the existing, currently-dead `work_item_preflight_*` settings) and explicit CEO discretion (including backward moves `todo→backlog` and `todo→refinement`).

**Architecture:** The refinement _consumer_ pipeline (`work_item_refinement_default`, `work_item_split_default`, triage/gated-transition tools) is fully intact but starved — nothing has entered `refinement` since 2026-06-11. We add two deterministic, opt-in producers plus prompt-level CEO discretion: (1) a **promotion reroute** in `kanban.work_item_transition_status` that turns a genuine `backlog→todo` promotion into `backlog→refinement` when `work_item_preflight_pipeline_enabled` is on and the item hasn't yet cleared refinement; (2) a **dispatch safety-net gate** in the dispatch core that, when `work_item_preflight_required` is on, reroutes a `todo` candidate that never cleared refinement into `refinement` instead of dispatching it to `in-progress`; and (3) CEO prompt updates that permit promoting to `refinement` and moving items backward. Large-scope split falls out for free: a `large`, unsplit item placed into `refinement` triggers `work_item_split_default`.

**Tech Stack:** TypeScript, NestJS (apps/kanban), Vitest, Handlebars-templated seed workflow YAML + Markdown prompts.

## Global Constraints

- **Kanban-neutral boundary does NOT apply here** — this is all inside `apps/kanban`, which owns the Kanban domain. Do not add kanban identifiers to `apps/api`/`packages/core`.
- **Strict lint policy:** no `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, or rule downgrades. Fix findings in code.
- **TDD mandatory:** Red → Green → Refactor for every task. Write the failing test first and run it to confirm failure before implementing.
- **Pure helpers + injectable services:** follow the existing `work-item-triage.helper.ts` / `work-item-triage.types.ts` pattern — pure decision logic in helpers with isolated unit tests; side effects in services/tools.
- **Settings are opt-in:** both `work_item_preflight_pipeline_enabled` and `work_item_preflight_required` keep their seeded default of `false`. Behaviour only changes when an operator enables them. (Defaulting decision is Task 7.)
- **Status value:** the literal is `"refinement"` (string), already a member of `SUPPORTED_WORK_ITEM_STATUSES` (`apps/kanban/src/work-item/work-item.service.helpers.ts:35`) and `WorkItemStatusSchema` (`@nexus/kanban-contracts`).
- **Test command (single file):** `npm run test --workspace=apps/kanban -- run <relative-path-from-apps/kanban>`
- **Lint command:** `npm run lint:kanban`

---

## Background / Root Cause (read once before starting)

- Only 9 items have _ever_ entered `refinement` (event ledger starts 2026-04-03); the last was 2026-06-11. Since then ~486 `todo` and ~479 `in-progress` transitions, zero `refinement`.
- The original producer (EPIC-118 "refinement-first dispatch / reroute gating") lived in `apps/api/src/project/` and was deleted during the kanban ownership cutover (commits `c8e454fdf`, `2dcdb3b52`). It was never re-implemented in `apps/kanban`'s dispatch service, which only handles `todo` (`dispatch-work-items.core.ts:165` → `if (item.status !== "todo")`).
- The CEO cycle's deterministic `promote_safe_backlog` job hard-codes `status: todo` (`seed/workflows/project-orchestration-cycle-ceo.workflow.yaml:234-252`).
- `work_item_preflight_pipeline_enabled` / `work_item_preflight_required` are defined in `apps/kanban/src/settings/kanban-settings.constants.ts:57-70` and the web settings UI but **read by no code path** — dead config.
- The refinement workflow's loop-guard metadata: on exit to `todo` it sets `metadata.refinement.hasClearedRefinementOnce = true` and `retroactiveRefinementRequired = false` (`seed/workflows/work-item-refinement-default.workflow.yaml:559-563`). Re-entry from `todo` after clearing is suppressed by the trigger condition at line 8.

---

## File Structure

**New files:**

- `apps/kanban/src/work-item/work-item-preflight-routing.types.ts` — input/decision types for the pure routing helpers.
- `apps/kanban/src/work-item/work-item-preflight-routing.helper.ts` — pure functions: `readRefinementRoutingMeta`, `resolvePromotionReroute`, `shouldGateDispatchToRefinement`.
- `apps/kanban/src/work-item/work-item-preflight-routing.helper.spec.ts` — unit tests for the helper.

**Modified files:**

- `apps/kanban/src/mcp/tools/mutation/work-item-transition-status.tool.ts` — apply `resolvePromotionReroute` before executing the transition.
- `apps/kanban/src/mcp/tools/mutation/work-item-transition-status.tool.spec.ts` (create if missing) — tool-level reroute tests.
- `apps/kanban/src/dispatch/dispatch-core.types.ts` — add preflight flags to `DispatchCoreOptions`.
- `apps/kanban/src/dispatch/dispatch.service.ts` — resolve the two settings and pass them into the core options.
- `apps/kanban/src/dispatch/dispatch-work-items.core.ts` — apply the required-gate reroute in `processCandidate`/`runPreFlight`.
- `apps/kanban/src/dispatch/dispatch-work-items.core.spec.ts` (or the nearest existing dispatch-core spec) — gate tests.
- `seed/workflows/prompts/project-orchestration-cycle-ceo/strategize.md` — permit refinement promotion + backward moves.
- `seed/workflows/prompts/project-orchestration-cycle-ceo/dispatch.md` — permit refinement promotion + backward moves.
- `apps/kanban/src/seeds/workflows.seed.contract.spec.ts` — adjust only if an assertion conflicts (verify first).
- `docs/guide/` + `.claude/skills/kanban-work-item-lifecycle/SKILL.md` + new ADR — documentation.

---

### Task 1: Pure preflight-routing helper

**Files:**

- Create: `apps/kanban/src/work-item/work-item-preflight-routing.types.ts`
- Create: `apps/kanban/src/work-item/work-item-preflight-routing.helper.ts`
- Test: `apps/kanban/src/work-item/work-item-preflight-routing.helper.spec.ts`

**Interfaces:**

- Consumes: `WorkItemStatus` from `@nexus/kanban-contracts`.
- Produces:
  - `readRefinementRoutingMeta(metadata: unknown): RefinementRoutingMeta`
  - `resolvePromotionReroute(input: PromotionRerouteInput): PromotionRerouteDecision`
  - `shouldGateDispatchToRefinement(input: DispatchGateInput): boolean`
  - Types: `RefinementRoutingMeta`, `PromotionRerouteInput`, `PromotionRerouteDecision`, `DispatchGateInput`.

- [ ] **Step 1: Write the types file**

```ts
// apps/kanban/src/work-item/work-item-preflight-routing.types.ts
import type { WorkItemStatus } from "@nexus/kanban-contracts";

export interface RefinementRoutingMeta {
  hasClearedRefinementOnce: boolean;
  retroactiveRefinementRequired: boolean;
  isSplitChild: boolean;
}

export interface PromotionRerouteInput {
  currentStatus: WorkItemStatus;
  requestedStatus: WorkItemStatus;
  hasClearedRefinementOnce: boolean;
  preflightEnabled: boolean;
}

export interface PromotionRerouteDecision {
  effectiveStatus: WorkItemStatus;
  rerouted: boolean;
  reason: "promotion_preflight" | null;
}

export interface DispatchGateInput {
  hasClearedRefinementOnce: boolean;
  preflightRequired: boolean;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// apps/kanban/src/work-item/work-item-preflight-routing.helper.spec.ts
import { describe, expect, it } from "vitest";
import {
  readRefinementRoutingMeta,
  resolvePromotionReroute,
  shouldGateDispatchToRefinement,
} from "./work-item-preflight-routing.helper";

describe("readRefinementRoutingMeta", () => {
  it("returns all-false defaults for null/undefined/garbage metadata", () => {
    for (const input of [null, undefined, 42, "x", {}]) {
      expect(readRefinementRoutingMeta(input)).toEqual({
        hasClearedRefinementOnce: false,
        retroactiveRefinementRequired: false,
        isSplitChild: false,
      });
    }
  });

  it("reads nested refinement + split flags", () => {
    const meta = {
      refinement: {
        hasClearedRefinementOnce: true,
        retroactiveRefinementRequired: true,
      },
      split: { parentId: "parent-1" },
    };
    expect(readRefinementRoutingMeta(meta)).toEqual({
      hasClearedRefinementOnce: true,
      retroactiveRefinementRequired: true,
      isSplitChild: true,
    });
  });
});

describe("resolvePromotionReroute", () => {
  const base = {
    currentStatus: "backlog" as const,
    requestedStatus: "todo" as const,
    hasClearedRefinementOnce: false,
    preflightEnabled: true,
  };

  it("reroutes a genuine backlog→todo promotion to refinement when enabled and not yet cleared", () => {
    expect(resolvePromotionReroute(base)).toEqual({
      effectiveStatus: "refinement",
      rerouted: true,
      reason: "promotion_preflight",
    });
  });

  it("passes through when preflight disabled", () => {
    expect(
      resolvePromotionReroute({ ...base, preflightEnabled: false }),
    ).toEqual({
      effectiveStatus: "todo",
      rerouted: false,
      reason: null,
    });
  });

  it("passes through when the item already cleared refinement", () => {
    expect(
      resolvePromotionReroute({ ...base, hasClearedRefinementOnce: true }),
    ).toEqual({
      effectiveStatus: "todo",
      rerouted: false,
      reason: null,
    });
  });

  it("passes through when not a backlog→todo promotion (e.g. recovery in-progress→todo)", () => {
    expect(
      resolvePromotionReroute({ ...base, currentStatus: "in-progress" }),
    ).toEqual({ effectiveStatus: "todo", rerouted: false, reason: null });
  });

  it("passes through when requested target is not todo", () => {
    expect(
      resolvePromotionReroute({ ...base, requestedStatus: "blocked" }),
    ).toEqual({ effectiveStatus: "blocked", rerouted: false, reason: null });
  });
});

describe("shouldGateDispatchToRefinement", () => {
  it("gates a never-refined todo item when required", () => {
    expect(
      shouldGateDispatchToRefinement({
        hasClearedRefinementOnce: false,
        preflightRequired: true,
      }),
    ).toBe(true);
  });

  it("does not gate when not required", () => {
    expect(
      shouldGateDispatchToRefinement({
        hasClearedRefinementOnce: false,
        preflightRequired: false,
      }),
    ).toBe(false);
  });

  it("does not gate an already-refined item", () => {
    expect(
      shouldGateDispatchToRefinement({
        hasClearedRefinementOnce: true,
        preflightRequired: true,
      }),
    ).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- run src/work-item/work-item-preflight-routing.helper.spec.ts`
Expected: FAIL — cannot resolve `./work-item-preflight-routing.helper`.

- [ ] **Step 4: Write the helper implementation**

```ts
// apps/kanban/src/work-item/work-item-preflight-routing.helper.ts
import type {
  DispatchGateInput,
  PromotionRerouteDecision,
  PromotionRerouteInput,
  RefinementRoutingMeta,
} from "./work-item-preflight-routing.types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readRefinementRoutingMeta(
  metadata: unknown,
): RefinementRoutingMeta {
  const root = isRecord(metadata) ? metadata : {};
  const refinement = isRecord(root.refinement) ? root.refinement : {};
  const split = isRecord(root.split) ? root.split : {};
  return {
    hasClearedRefinementOnce: refinement.hasClearedRefinementOnce === true,
    retroactiveRefinementRequired:
      refinement.retroactiveRefinementRequired === true,
    isSplitChild:
      typeof split.parentId === "string" && split.parentId.length > 0,
  };
}

export function resolvePromotionReroute(
  input: PromotionRerouteInput,
): PromotionRerouteDecision {
  const passthrough: PromotionRerouteDecision = {
    effectiveStatus: input.requestedStatus,
    rerouted: false,
    reason: null,
  };

  if (!input.preflightEnabled) return passthrough;
  if (input.requestedStatus !== "todo") return passthrough;
  if (input.currentStatus !== "backlog") return passthrough;
  if (input.hasClearedRefinementOnce) return passthrough;

  return {
    effectiveStatus: "refinement",
    rerouted: true,
    reason: "promotion_preflight",
  };
}

export function shouldGateDispatchToRefinement(
  input: DispatchGateInput,
): boolean {
  return input.preflightRequired && !input.hasClearedRefinementOnce;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- run src/work-item/work-item-preflight-routing.helper.spec.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Lint + commit**

```bash
npm run lint:kanban
git add apps/kanban/src/work-item/work-item-preflight-routing.types.ts apps/kanban/src/work-item/work-item-preflight-routing.helper.ts apps/kanban/src/work-item/work-item-preflight-routing.helper.spec.ts
git commit -m "feat(kanban): add pure preflight refinement-routing helper"
```

---

### Task 2: Promotion reroute in the transition tool (`work_item_preflight_pipeline_enabled`)

**Files:**

- Modify: `apps/kanban/src/mcp/tools/mutation/work-item-transition-status.tool.ts`
- Test: `apps/kanban/src/mcp/tools/mutation/work-item-transition-status.tool.spec.ts` (create if absent)

**Interfaces:**

- Consumes: `resolvePromotionReroute`, `readRefinementRoutingMeta` (Task 1); `KanbanSettingsService.getBoolean` (`apps/kanban/src/settings/kanban-settings.service.ts:43`); `currentItem` from the existing preflight read (`work-item-transition-status.tool.ts:79-87`).
- Produces: the tool now transitions to the **effective** status (possibly `refinement`) for genuine backlog→todo promotions.

- [ ] **Step 1: Write the failing test**

Build the test around the tool's collaborators. Mock `WorkItemService` (`listWorkItems`, `updateStatus`), `OrchestrationDecisionExecutorService.executeDirectMutationDecision` (invoke the passed `execute` and return its result), `OrchestrationFactSnapshotService.publishWorkItemState`, and `KanbanSettingsService.getBoolean`.

```ts
// apps/kanban/src/mcp/tools/mutation/work-item-transition-status.tool.spec.ts
import { describe, expect, it, vi } from "vitest";
import { WorkItemTransitionStatusTool } from "./work-item-transition-status.tool";

function buildTool(overrides: {
  currentStatus: string;
  metadata?: unknown;
  preflightEnabled: boolean;
}) {
  const item = {
    id: "wi-1",
    project_id: "proj-1",
    status: overrides.currentStatus,
    scope: "standard",
    metadata: overrides.metadata ?? {},
  };
  const updateStatus = vi.fn(async (_p, _id, status) => ({
    id: "wi-1",
    status,
  }));
  const workItems = {
    listWorkItems: vi.fn(async () => [item]),
    updateStatus,
  } as unknown as ConstructorParameters<typeof WorkItemTransitionStatusTool>[0];
  const decisionExecutor = {
    executeDirectMutationDecision: vi.fn(
      async (args: { execute: () => Promise<unknown> }) => args.execute(),
    ),
  } as unknown as ConstructorParameters<typeof WorkItemTransitionStatusTool>[1];
  const factSnapshot = {
    publishWorkItemState: vi.fn(async () => undefined),
  } as unknown as ConstructorParameters<typeof WorkItemTransitionStatusTool>[2];
  const kanbanSettings = {
    getBoolean: vi.fn(async (key: string) =>
      key === "work_item_preflight_pipeline_enabled"
        ? overrides.preflightEnabled
        : false,
    ),
    getNumber: vi.fn(async () => 50),
  } as unknown as ConstructorParameters<typeof WorkItemTransitionStatusTool>[3];

  const tool = new WorkItemTransitionStatusTool(
    workItems,
    decisionExecutor,
    factSnapshot,
    kanbanSettings,
  );
  return { tool, updateStatus };
}

const ctx = { scopeId: "proj-1" } as never;

describe("WorkItemTransitionStatusTool preflight reroute", () => {
  it("reroutes backlog→todo to refinement when preflight enabled and not cleared", async () => {
    const { tool, updateStatus } = buildTool({
      currentStatus: "backlog",
      preflightEnabled: true,
    });
    await tool["run"](ctx, {
      project_id: "proj-1",
      workItemId: "wi-1",
      status: "todo",
    });
    expect(updateStatus).toHaveBeenCalledWith("proj-1", "wi-1", "refinement");
  });

  it("keeps backlog→todo as todo when preflight disabled", async () => {
    const { tool, updateStatus } = buildTool({
      currentStatus: "backlog",
      preflightEnabled: false,
    });
    await tool["run"](ctx, {
      project_id: "proj-1",
      workItemId: "wi-1",
      status: "todo",
    });
    expect(updateStatus).toHaveBeenCalledWith("proj-1", "wi-1", "todo");
  });

  it("does not reroute when item already cleared refinement", async () => {
    const { tool, updateStatus } = buildTool({
      currentStatus: "backlog",
      preflightEnabled: true,
      metadata: { refinement: { hasClearedRefinementOnce: true } },
    });
    await tool["run"](ctx, {
      project_id: "proj-1",
      workItemId: "wi-1",
      status: "todo",
    });
    expect(updateStatus).toHaveBeenCalledWith("proj-1", "wi-1", "todo");
  });

  it("does not reroute an explicit CEO backward move todo→backlog", async () => {
    const { tool, updateStatus } = buildTool({
      currentStatus: "todo",
      preflightEnabled: true,
    });
    await tool["run"](ctx, {
      project_id: "proj-1",
      workItemId: "wi-1",
      status: "backlog",
    });
    expect(updateStatus).toHaveBeenCalledWith("proj-1", "wi-1", "backlog");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- run src/mcp/tools/mutation/work-item-transition-status.tool.spec.ts`
Expected: FAIL — the first test sees `updateStatus` called with `"todo"`, not `"refinement"`.

- [ ] **Step 3: Implement the reroute in the tool**

In `work-item-transition-status.tool.ts`, add imports:

```ts
import {
  readRefinementRoutingMeta,
  resolvePromotionReroute,
} from "../../../work-item/work-item-preflight-routing.helper";
```

Then, after `currentItem` is resolved and before computing `capacitySnapshot` (i.e. after line 92), insert:

```ts
const preflightEnabled = await this.kanbanSettings.getBoolean(
  "work_item_preflight_pipeline_enabled",
);
const refinementMeta = readRefinementRoutingMeta(
  (currentItem as { metadata?: unknown }).metadata,
);
const reroute = resolvePromotionReroute({
  currentStatus: currentItem.status,
  requestedStatus: status,
  hasClearedRefinementOnce: refinementMeta.hasClearedRefinementOnce,
  preflightEnabled,
});
const effectiveStatus = reroute.effectiveStatus;
```

Replace every subsequent use of `status` in capacity resolution, failure metadata, structured decision, and the `execute` call with `effectiveStatus`. Specifically:

- `resolveCapacitySnapshotIfNeeded(projectWorkItems, currentItem, effectiveStatus)`
- `failureMetadata.status: effectiveStatus`
- `reason: \`Transition ${params.workItemId} to ${effectiveStatus}\``
- `target_status: effectiveStatus`
- `execute: () => this.workItems.updateStatus(projectId, params.workItemId, effectiveStatus)`

> Note: `refinement` is not in `PROJECT_DISPATCH_ACTIVE_STATUSES`, so the WIP-capacity branch is correctly skipped for rerouted promotions.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- run src/mcp/tools/mutation/work-item-transition-status.tool.spec.ts`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

```bash
npm run lint:kanban
git add apps/kanban/src/mcp/tools/mutation/work-item-transition-status.tool.ts apps/kanban/src/mcp/tools/mutation/work-item-transition-status.tool.spec.ts
git commit -m "feat(kanban): route backlog promotions through refinement when preflight enabled"
```

---

### Task 3: Dispatch safety-net gate (`work_item_preflight_required`)

**Files:**

- Modify: `apps/kanban/src/dispatch/dispatch-core.types.ts`
- Modify: `apps/kanban/src/dispatch/dispatch.service.ts`
- Modify: `apps/kanban/src/dispatch/dispatch-work-items.core.ts`
- Test: `apps/kanban/src/dispatch/dispatch-work-items.core.spec.ts` (use the existing dispatch-core spec; create alongside if none matches)

**Interfaces:**

- Consumes: `shouldGateDispatchToRefinement`, `readRefinementRoutingMeta` (Task 1); `DispatchCoreDeps.workItemService.updateStatus` (`dispatch-core.types.ts:13`, already used by reconciliation at `dispatch-work-items-reconciliation.ts:163`).
- Produces: `DispatchCoreOptions.preflightRequired: boolean`; a new dispatch skip reason `refinement_required`; a side-effecting `todo→refinement` transition for un-refined candidates.

- [ ] **Step 1: Add `preflightRequired` to options + a skip reason (no test yet)**

In `dispatch-core.types.ts`, add to `DispatchCoreOptions`:

```ts
  /** When true, todo candidates that never cleared refinement are rerouted to refinement instead of dispatched. */
  preflightRequired?: boolean;
```

In `dispatch-work-items.core.ts`, extend the `PreFlightSkip.reason` union (around line 247) with `"refinement_required"`.

- [ ] **Step 2: Write the failing test**

Add to the dispatch-core spec. Construct `deps`/`options` the way the existing dispatch-core tests do (copy the nearest existing setup helper in that spec). The new case: a single `todo` candidate with empty metadata, `preflightRequired: true`, capacity available. Assert `deps.workItemService.updateStatus` was called with `(project_id, id, "refinement")` and the item appears in `result.skipped` with reason `"refinement_required"` and is **not** dispatched (no run request built).

```ts
it("reroutes an un-refined todo candidate to refinement when preflightRequired", async () => {
  const { deps, options, updateStatus, buildRunRequestSpy } =
    setupSingleTodoCandidate({
      metadata: {},
      preflightRequired: true,
    });
  const result = await dispatchWorkItems(deps, options);
  expect(updateStatus).toHaveBeenCalledWith("proj-1", "wi-1", "refinement");
  expect(buildRunRequestSpy).not.toHaveBeenCalled();
  expect(result.skipped).toContainEqual(
    expect.objectContaining({
      workItemId: "wi-1",
      reason: "refinement_required",
    }),
  );
});

it("dispatches a todo candidate that already cleared refinement even when preflightRequired", async () => {
  const { deps, options, updateStatus } = setupSingleTodoCandidate({
    metadata: { refinement: { hasClearedRefinementOnce: true } },
    preflightRequired: true,
  });
  await dispatchWorkItems(deps, options);
  expect(updateStatus).not.toHaveBeenCalledWith("proj-1", "wi-1", "refinement");
});
```

> Adapt `setupSingleTodoCandidate` to the spec's existing fixture conventions (it must wire `deps.workItemService.updateStatus` as a `vi.fn()` and expose the `buildRunRequest` spy, or assert non-dispatch via `result.launched`/`result.accepted` being empty if `buildRunRequest` isn't directly spyable).

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- run src/dispatch/dispatch-work-items.core.spec.ts`
Expected: FAIL — candidate is dispatched, `updateStatus(..., "refinement")` never called.

- [ ] **Step 4: Implement the gate in `processCandidate`**

In `dispatch-work-items.core.ts`, import the helpers:

```ts
import {
  readRefinementRoutingMeta,
  shouldGateDispatchToRefinement,
} from "../work-item/work-item-preflight-routing.helper";
```

Inside `processCandidate`, after the item is loaded and confirmed `status === "todo"` (line ~165) but **before** `runPreFlight`/claim, insert the gate. Use the resolved item record (`ctx.itemById.get(workItemId)` or the local `item`):

```ts
if (ctx.options.preflightRequired && ctx.deps.workItemService) {
  const meta = readRefinementRoutingMeta(
    (item as { metadata?: unknown }).metadata,
  );
  if (
    shouldGateDispatchToRefinement({
      hasClearedRefinementOnce: meta.hasClearedRefinementOnce,
      preflightRequired: true,
    })
  ) {
    await ctx.deps.workItemService.updateStatus(
      item.project_id,
      item.id,
      "refinement",
    );
    ctx.result.skipped.push({
      workItemId: item.id,
      reason: "refinement_required",
    });
    return;
  }
}
```

> Place this so it runs only for genuine `todo` candidates and returns before any dispatch-slot claim, mirroring how `runPreFlight` skips push to `ctx.result.skipped` and return.

- [ ] **Step 5: Resolve and pass the setting in `dispatch.service.ts`**

Where `dispatch.service.ts` builds `DispatchCoreOptions` for both ready-mode and selected-mode calls, resolve and pass the flag (mirror how `work_item_dispatch_max_active_per_project` is already resolved there):

```ts
    const preflightRequired = await this.kanbanSettings.getBoolean(
      "work_item_preflight_required",
    );
    // ...add to the options object(s):
    preflightRequired,
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test --workspace=apps/kanban -- run src/dispatch/dispatch-work-items.core.spec.ts`
Expected: PASS.

- [ ] **Step 7: Lint + commit**

```bash
npm run lint:kanban
git add apps/kanban/src/dispatch/dispatch-core.types.ts apps/kanban/src/dispatch/dispatch.service.ts apps/kanban/src/dispatch/dispatch-work-items.core.ts apps/kanban/src/dispatch/dispatch-work-items.core.spec.ts
git commit -m "feat(kanban): gate dispatch of un-refined items into refinement when preflight required"
```

---

### Task 4: CEO discretion — promote to refinement + backward moves (prompts)

**Files:**

- Modify: `seed/workflows/prompts/project-orchestration-cycle-ceo/strategize.md`
- Modify: `seed/workflows/prompts/project-orchestration-cycle-ceo/dispatch.md`

**Interfaces:**

- Consumes: the CEO already holds `kanban.work_item_transition_status` (workflow grant `project-orchestration-cycle-ceo.workflow.yaml:50`); `WorkItemService.updateStatus` allows any known→any known status (`work-item.service.helpers.ts:35`), so backward and refinement moves need **no** engine change — only prompt permission/guidance.
- Produces: prompt language that (a) names `refinement` as a valid target for large/complex/unready items, and (b) explicitly authorizes `todo→backlog` and `todo→refinement` corrective moves with per-item reasons.

- [ ] **Step 1: Read both prompts fully** to find the existing "permitted grooming operations" / decision-vocabulary sections (in `strategize.md` look for the grooming/defer language; in `dispatch.md` look for the transition vocabulary and the `delegate_orchestration_refinement` note).

- [ ] **Step 2: Add a "Refinement routing" subsection to `strategize.md`**

Insert, in the grooming-operations area, verbatim:

```markdown
### Refinement routing (work-item readiness)

You may move work items into `refinement` when they are not yet ready to implement:

- **Large-scope items** (`scope: large`) that have not been split — moving them to
  `refinement` triggers automatic decomposition into child items.
- **Complex or ambiguous items** that lack clear acceptance criteria or an
  implementation plan — `refinement` runs the PM/architect preflight before any code.

You may also move items **backward** when the board state warrants it:

- `todo → backlog` — when a promoted item is not actually ready or higher-priority
  work should take its slot. Always include a per-item reason.
- `todo → refinement` — when a promoted item needs PM/architect clarification before
  implementation. Always include a per-item reason.

Use `kanban.work_item_transition_status` with the target `status` for these moves.
Do not move an item back into `refinement` if its metadata shows
`refinement.hasClearedRefinementOnce: true` unless its requirements have genuinely
changed (this avoids refinement loops).
```

- [ ] **Step 3: Add the same authorization to `dispatch.md`**

In `dispatch.md`, near the transition vocabulary, add verbatim:

```markdown
**Refinement & backward moves are permitted.** Besides promoting `backlog → todo`,
you may transition an item to `refinement` (for large-scope split or PM/architect
preflight) or move it backward (`todo → backlog`, `todo → refinement`) when board
readiness requires it. Provide a per-item reason for every backward move. Respect
`refinement.hasClearedRefinementOnce` to avoid refinement loops.
```

- [ ] **Step 4: Verify no seed contract test forbids these strings**

Run: `npm run test --workspace=apps/kanban -- run src/seeds/workflows.seed.contract.spec.ts`
Expected: PASS. If a prompt-content assertion fails, update that assertion to match the new permitted vocabulary (do not weaken unrelated checks).

- [ ] **Step 5: Commit**

```bash
git add seed/workflows/prompts/project-orchestration-cycle-ceo/strategize.md seed/workflows/prompts/project-orchestration-cycle-ceo/dispatch.md
git commit -m "feat(seed): authorize CEO refinement routing and backward work-item moves"
```

---

### Task 5: Seed contract — promotion candidates may target refinement (verify-then-adjust)

**Files:**

- Inspect/Modify: `apps/kanban/src/seeds/workflows.seed.contract.spec.ts`
- Inspect: `seed/workflows/project-orchestration-cycle-ceo.workflow.yaml:234-252` (the deterministic `promote_safe_backlog` job)

**Rationale:** The deterministic `promote_safe_backlog` job still calls `kanban.work_item_transition_status` with `status: todo`; Task 2's tool-level reroute converts that to `refinement` when the setting is on. This keeps the YAML honest (it always _requests_ `todo`; the engine decides routing). Confirm no contract test asserts the promotion can _only_ ever result in `todo`.

- [ ] **Step 1: Search the contract spec** for assertions on `promote_safe_backlog` / `status: todo` and for any assertion that the CEO cycle never references `refinement`.

Run: `npm run test --workspace=apps/kanban -- run src/seeds/workflows.seed.contract.spec.ts`
Expected: PASS as-is in most cases. Only if a test asserts "promotion target is always todo" or "CEO prompts never mention refinement", update it to reflect the new behaviour (the _requested_ status stays `todo`; refinement routing is engine-driven; CEO prompts now _may_ mention refinement).

- [ ] **Step 2: Commit only if changed**

```bash
git add apps/kanban/src/seeds/workflows.seed.contract.spec.ts
git commit -m "test(kanban): allow engine-driven refinement routing in CEO promotion contract"
```

---

### Task 6: Documentation + ADR

**Files:**

- Modify: `.claude/skills/kanban-work-item-lifecycle/SKILL.md` (the in-repo copy; if the canonical copy lives at `.agents/skills/...`, update that path instead — verify which exists)
- Modify: a relevant page under `docs/guide/` (work-item lifecycle / orchestration section)
- Create: `docs/architecture/decisions/ADR-20260627-refinement-routing-restoration.md`

- [ ] **Step 1: Update the lifecycle skill** — add a "Producers of `refinement`" section documenting: (a) the promotion reroute gated by `work_item_preflight_pipeline_enabled`, (b) the dispatch safety-net gated by `work_item_preflight_required`, (c) CEO discretionary moves, and (d) the `hasClearedRefinementOnce` loop-guard.

- [ ] **Step 2: Update `docs/guide/`** with the same producer/consumer summary and how to enable the feature (set the two kanban settings).

- [ ] **Step 3: Write the ADR** — Context (refinement producer lost in the kanban cutover; consumer pipeline intact but starved since 2026-06-11), Decision (two deterministic opt-in gates + CEO discretion), Consequences (opt-in default-off; one-time bounce of legacy un-refined `todo` items if `required` is enabled; large items now auto-split via refinement).

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/kanban-work-item-lifecycle/SKILL.md docs/guide docs/architecture/decisions/ADR-20260627-refinement-routing-restoration.md
git commit -m "docs: document restored refinement routing (producers + ADR)"
```

---

### Task 7: Enablement decision + full verification

**Files:**

- Possibly modify: `apps/kanban/src/settings/kanban-settings.constants.ts:57-63` (default for `work_item_preflight_pipeline_enabled`)

- [ ] **Step 1: Decide the default for `work_item_preflight_pipeline_enabled`.** Two choices — confirm with the user before changing:
  - **Keep `false`** (safe; operator opts in per environment via the settings UI). Recommended for first rollout.
  - **Default `true`** (refinement-first becomes the global default; large items auto-split out of the box). Bigger behaviour change.
    Leave `work_item_preflight_required` default `false` regardless (it is the hard gate and will bounce every legacy un-refined `todo` item once).

- [ ] **Step 2: Run the full kanban suite**

Run: `npm run test:kanban`
Expected: PASS (all).

- [ ] **Step 3: Lint**

Run: `npm run lint:kanban`
Expected: clean.

- [ ] **Step 4: Build**

Run: `npm run build --workspace=packages/core && npm run build:kanban`
Expected: success.

- [ ] **Step 5: Live smoke (after redeploy/reseed)** — enable `work_item_preflight_pipeline_enabled` for a test project, promote a `large` backlog item, and confirm via the event ledger that it transitions `backlog → refinement` and that `work_item_split_default` fires:

```bash
docker exec nexus-postgres psql -U nexus -d nexus_orchestrator -c "SELECT occurred_at, payload->'payload'->>'previousStatus' AS prev, payload->'payload'->>'status' AS status FROM event_ledger WHERE event_name LIKE '%status_changed%' AND payload->'payload'->>'status'='refinement' ORDER BY occurred_at DESC LIMIT 5;"
```

Expected: a fresh `backlog → refinement` row dated today.

- [ ] **Step 6: Commit any default change**

```bash
git add apps/kanban/src/settings/kanban-settings.constants.ts
git commit -m "chore(kanban): set refinement preflight default per rollout decision"
```

---

## Self-Review Notes

- **Spec coverage:** Part 1 (deterministic engine gate) = Tasks 2 (enabled/promotion) + 3 (required/dispatch). Part 2 (CEO discretion incl. backward moves) = Task 4. Dead-config wiring = Tasks 2, 3, 7. Large-split = emergent from routing a `large` item into `refinement` (consumer `work_item_split_default` already handles it).
- **Loop safety:** promotion reroute only fires `backlog→todo`; dispatch gate respects `hasClearedRefinementOnce`; refinement workflow exits via `kanban.work_item_gated_transition` (calls `updateStatus` directly, bypassing the tool reroute) and sets `hasClearedRefinementOnce: true`. No cycle.
- **Recovery safety:** reconciliation resets failed `in-progress → todo` via `updateStatus` directly (not the tool), so the promotion reroute never fires on recovery. Those items typically have `hasClearedRefinementOnce: true` already; the `required` gate would re-refine a never-cleared recovered item once, which is acceptable.
- **Type consistency:** helper names (`resolvePromotionReroute`, `readRefinementRoutingMeta`, `shouldGateDispatchToRefinement`) and types are identical across Tasks 1–3. Skip reason `refinement_required` matches between Task 3 implementation and tests.
