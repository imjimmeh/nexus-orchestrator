# CEO Orchestration Cycle — Deterministic Gates & Promotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the mechanical parts of the CEO orchestration cycle — the three staleness gates in `strategize` and the zero-todo backlog promotion in `dispatch` — out of LLM prose and into deterministic, engine-evaluated workflow jobs, while leaving genuine product judgement (grooming, strategic intent, blocked-item reasoning) to the agent and retaining an agent override path for the gates.

**Architecture:** Extend the workflow condition engine with numeric comparison helpers (`gt`, `gte`, `lt`, `lte`) so thresholds can be expressed directly in workflow `condition:` expressions. Expose the raw staleness signals from kanban `project_state` (`mergesSinceDiscovery`, `recentBurnRatePerCycle`, `starvationForecastCycles` already exist; add `activeNowInitiativeCount`) plus a promotable-backlog snapshot. Restructure `project-orchestration-cycle-ceo.workflow.yaml` so a deterministic `mcp_tool_call` job loads state, three `condition`-gated `invoke_workflow` jobs fire the specialist passes by default using the new helpers (proven gating pattern from `project-discovery-ceo.workflow.yaml`), and a deterministic, `for_each` promotion job handles the zero-todo mandate. Slim both prompts to remove the threshold arithmetic and the MANDATE/FORBIDDEN walls; keep `delegate_*` tools on the strategize agent for judgement-based overrides.

**Threshold-location tradeoff (decided):** with numeric helpers, the gate thresholds (`10`, `2`) live inline in the workflow `condition:` expressions rather than only in `@nexus/kanban-contracts`. The contract constants `REDISCOVERY_MERGE_THRESHOLD` / `IDEATION_STARVATION_THRESHOLD_CYCLES` are retained (referenced from a YAML comment + the strategize doc) as the documented canonical values, accepting that the workflow now carries a duplicated literal. This keeps the gate decision visible and operator-tunable in the seed YAML, which is the intent of choosing the numeric-helper approach.

**Tech Stack:** TypeScript, NestJS (apps/kanban, apps/api), Zod (`@nexus/kanban-contracts`), Vitest, Handlebars-based workflow conditions, YAML seed workflows.

---

## Background & Key Facts (read before starting)

- **Thresholds** live in `packages/kanban-contracts/src/strategic.schema.ts`: `REDISCOVERY_MERGE_THRESHOLD = 10`, `IDEATION_STARVATION_THRESHOLD_CYCLES = 2`. These remain the single source of truth.
- **Condition engine helper instances** — job-level `condition:` is rendered by `StateManagerService.substituteTemplate` (the `hbs` instance at `apps/api/src/workflow/state-manager.service.ts:6-24`); the seed dry-run validator uses a SEPARATE instance at `apps/api/src/workflow/workflow-dry-run.utils.ts:11-29`; workflow `trigger.condition` uses a third at `apps/api/src/workflow/workflow-trigger-condition.helpers.ts:3-16`. All three currently register only `eq`, `and`, `or`, `not` (+ `json`/`length` in the first two). Phase 1 adds `gt`/`gte`/`lt`/`lte` to all three (job conditions need the first; the dry-run spec needs the second or `gte` renders as a missing-helper error).
- **Binary helper arity**: Handlebars passes its `options` object as the trailing argument, so a `(a, b)` helper receives `(a, b, options)` and naturally ignores `options`. Numeric helpers return `false` for non-numeric/null/NaN operands (safe default — a gate does not fire on missing data).
- **`invoke_workflow` is a job type** that awaits its child and composes with `condition` + `depends_on`; downstream jobs still run when a gated job is skipped (`condition` false). Proven in `seed/workflows/project-discovery-ceo.workflow.yaml:99-150`.
- **`mcp_tool_call` job output** is exposed as `jobs.<id>.output.result` (the raw tool return) plus `jobs.<id>.output.ok` — see `apps/api/src/workflow/workflow-special-steps/step-mcp-tool-call-special-step.handler.ts:141-158`. `for_each` and `continue_on_error` are handled by the job-execution layer (see `seed/workflows/project-goal-backlog-planning.workflow.yaml:106-152`), not the special-step handler.
- **Conditions can reference prior job outputs** — `seed/workflows/work-item-ready-to-merge-default.workflow.yaml:60` uses `jobs.attempt_merge.output.merge_outcome == 'succeeded'`.
- **Child-workflow trigger inputs**: `project_codebase_deep_investigation` (`mode: full|refresh`, `trigger.scopeId`), `project_roadmap_planning` (`scopeId` required, `goals`, `reason`), `project_goal_backlog_planning` (`scopeId` required, `orchestrationId`, `goals`, `reason`).
- **Dispatch capacity**: WIP limit setting `work_item_dispatch_max_active_per_project` (default 3), helpers in `apps/kanban/src/dispatch/project-dispatch-capacity.ts`. `PROJECT_DISPATCH_ACTIVE_STATUSES = {in-progress, in-review, ready-to-merge}`.
- **Boundary rule**: never put kanban/work-item identifiers in `apps/api/src` or `packages/core`. All gate-signal and promotion logic is kanban-side. The workflow YAML and prompts are seed data (allowed to name kanban tools).

## File Map

| File                                                                              | Phase | Responsibility                                                               |
| --------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------- |
| `apps/api/src/workflow/workflow-comparison-helpers.ts`                            | 1     | New: `registerComparisonHelpers(hbs)` adding `gt`/`gte`/`lt`/`lte`           |
| `apps/api/src/workflow/workflow-comparison-helpers.spec.ts`                       | 1     | Tests for the numeric helpers                                                |
| `apps/api/src/workflow/state-manager.service.ts`                                  | 1     | Register comparison helpers on the job-condition `hbs`                       |
| `apps/api/src/workflow/workflow-dry-run.utils.ts`                                 | 1     | Register comparison helpers on the dry-run `hbs`                             |
| `apps/api/src/workflow/workflow-trigger-condition.helpers.ts`                     | 1     | Register comparison helpers on the trigger `hbs`                             |
| `packages/kanban-contracts/src/strategic.schema.ts`                               | 1     | Add `activeNowInitiativeCount` to `StrategicStalenessSchema`                 |
| `apps/kanban/src/orchestration/strategic/project-strategic-state.types.ts`        | 1     | Add `activeNowInitiativeCount` to `StrategicStaleness` type                  |
| `apps/kanban/src/orchestration/strategic/project-strategic-state.service.ts`      | 1     | Compute `activeNowInitiativeCount` (merges/burn/starvation already computed) |
| `apps/kanban/src/orchestration/strategic/project-strategic-state.service.spec.ts` | 1     | Test for `activeNowInitiativeCount`                                          |
| `seed/workflows/project-orchestration-cycle-ceo.workflow.yaml`                    | 2,5   | Restructure into deterministic gate + promotion DAG                          |
| `apps/kanban/src/seeds/project-orchestration-cycle-ceo.seed-contract.spec.ts`     | 2,3,5 | Update contract assertions                                                   |
| `seed/workflows/prompts/project-orchestration-cycle-ceo/strategize.md`            | 3     | Slim threshold prose; add override note                                      |
| `apps/kanban/src/mcp/tools/read/project-state.tool.ts`                            | 4     | Compute `promotableBacklog` candidates + capacity snapshot                   |
| `apps/kanban/src/mcp/tools/read/project-state.tool.spec.ts` (or existing)         | 4     | Tests for promotable computation                                             |
| `seed/workflows/prompts/project-orchestration-cycle-ceo/dispatch.md`              | 5     | Slim MANDATE/FORBIDDEN walls; reference deterministic promotion              |
| `docs/guide/47-strategic-refresh-loop.md`                                         | 3,5   | Document the deterministic gates + promotion                                 |

**Phases 1–3 (strategize gates) ship independently of phases 4–5 (dispatch promotion).** Each phase ends green and committed.

---

## PHASE 1 — Numeric condition helpers + raw initiative signal

Add `gt`/`gte`/`lt`/`lte` to the workflow condition engine, and expose the one raw signal the gates need that isn't already present (`activeNowInitiativeCount`). The gate _decisions_ are then expressed in the workflow YAML (Phase 2), not in kanban code.

**Gate expressions (final), using raw signals already on `strategic.staleness` plus the new count:**

- rediscovery: `mergesSinceDiscovery >= 10` → `(gte mergesSinceDiscovery 10)`
- ideation: `recentBurnRatePerCycle == 0 OR starvationForecastCycles <= 2` → `(or (eq recentBurnRatePerCycle 0) (lte starvationForecastCycles 2))` — the burn-rate-zero branch covers the "new / stalled / null forecast" case without relying on a `null` Handlebars literal (guide §4.2, §9.2).
- roadmap: `activeNowInitiativeCount == 0` → `(eq activeNowInitiativeCount 0)` — subsumes the empty-initiatives case. The fuzzier "horizons stale by time" / "active goal lacks initiative" sub-conditions are intentionally left to the agent override path (Phase 3): they need a wall-clock threshold and goal-link data the service does not currently carry.

### Task 1.1: Add the numeric comparison helpers (TDD)

**Files:**

- Create: `apps/api/src/workflow/workflow-comparison-helpers.ts`
- Test: `apps/api/src/workflow/workflow-comparison-helpers.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/workflow/workflow-comparison-helpers.spec.ts`:

```typescript
import { describe, it, expect } from "vitest";
import Handlebars from "handlebars";
import { registerComparisonHelpers } from "./workflow-comparison-helpers";

function render(template: string, context: Record<string, unknown>): string {
  const hbs = Handlebars.create();
  registerComparisonHelpers(hbs);
  return hbs.compile(template, { noEscape: true })(context).trim();
}

describe("registerComparisonHelpers", () => {
  it("gte is true when left >= right", () => {
    expect(
      render("{{#if (gte a 10)}}true{{else}}false{{/if}}", { a: 10 }),
    ).toBe("true");
    expect(render("{{#if (gte a 10)}}true{{else}}false{{/if}}", { a: 9 })).toBe(
      "false",
    );
  });

  it("lte is true when left <= right", () => {
    expect(render("{{#if (lte a 2)}}true{{else}}false{{/if}}", { a: 2 })).toBe(
      "true",
    );
    expect(render("{{#if (lte a 2)}}true{{else}}false{{/if}}", { a: 3 })).toBe(
      "false",
    );
  });

  it("gt and lt are strict", () => {
    expect(render("{{#if (gt a 10)}}true{{else}}false{{/if}}", { a: 10 })).toBe(
      "false",
    );
    expect(render("{{#if (lt a 2)}}true{{else}}false{{/if}}", { a: 1 })).toBe(
      "true",
    );
  });

  it("returns false for null / non-numeric operands", () => {
    expect(
      render("{{#if (lte a 2)}}true{{else}}false{{/if}}", { a: null }),
    ).toBe("false");
    expect(
      render("{{#if (gte a 10)}}true{{else}}false{{/if}}", { a: "x" }),
    ).toBe("false");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- run src/workflow/workflow-comparison-helpers.spec.ts`
Expected: FAIL — module does not exist / `gte` is a missing helper.

- [ ] **Step 3: Implement the helpers**

Create `apps/api/src/workflow/workflow-comparison-helpers.ts`:

```typescript
import type Handlebars from "handlebars";

type HelperHost = Pick<typeof Handlebars, "registerHelper">;

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function compare(
  a: unknown,
  b: unknown,
  op: (x: number, y: number) => boolean,
): boolean {
  const x = toFiniteNumber(a);
  const y = toFiniteNumber(b);
  return x !== null && y !== null && op(x, y);
}

/**
 * Registers numeric comparison helpers on a Handlebars instance.
 *
 * Handlebars passes its `options` object as the trailing argument, so the
 * binary `(a, b)` signatures ignore it naturally. Non-numeric, null, undefined
 * or NaN operands yield `false` so a workflow gate never fires on missing data.
 */
export function registerComparisonHelpers(hbs: HelperHost): void {
  hbs.registerHelper("gt", (a: unknown, b: unknown) =>
    compare(a, b, (x, y) => x > y),
  );
  hbs.registerHelper("gte", (a: unknown, b: unknown) =>
    compare(a, b, (x, y) => x >= y),
  );
  hbs.registerHelper("lt", (a: unknown, b: unknown) =>
    compare(a, b, (x, y) => x < y),
  );
  hbs.registerHelper("lte", (a: unknown, b: unknown) =>
    compare(a, b, (x, y) => x <= y),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- run src/workflow/workflow-comparison-helpers.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-comparison-helpers.ts apps/api/src/workflow/workflow-comparison-helpers.spec.ts
git commit -m "feat(workflow): add gt/gte/lt/lte handlebars comparison helpers"
```

### Task 1.2: Register the helpers on all three condition engines

**Files:**

- Modify: `apps/api/src/workflow/state-manager.service.ts:6-24` (job-condition instance)
- Modify: `apps/api/src/workflow/workflow-dry-run.utils.ts:11-29` (dry-run instance)
- Modify: `apps/api/src/workflow/workflow-trigger-condition.helpers.ts:3-16` (trigger instance)

- [ ] **Step 1: Write a failing integration test for the job-condition path**

Append to `apps/api/src/workflow/state-manager.service.spec.ts` a test that renders a gate-style condition through the same `substituteTemplate` path the engine uses:

```typescript
it("supports numeric comparison helpers in templates", () => {
  // buildService() / service per the spec's existing harness
  const { service } = buildStateManager();
  const out = service.substituteTemplate(
    "{{#if (gte a 10)}}true{{else}}false{{/if}}",
    { a: 12 },
  );
  expect(out).toBe("true");
});
```

> Use the spec's existing constructor/harness name. If `substituteTemplate` is private, assert via the nearest public method the spec already exercises for templating.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test --workspace=apps/api -- run src/workflow/state-manager.service.spec.ts`
Expected: FAIL — `gte` is a missing helper (throws, or renders empty → not `"true"`).

- [ ] **Step 3: Register on each instance**

In `state-manager.service.ts`, after the existing `hbs.registerHelper('length', ...)` block (line 24):

```typescript
import { registerComparisonHelpers } from "./workflow-comparison-helpers";
// ...after the existing registerHelper calls:
registerComparisonHelpers(hbs);
```

In `workflow-dry-run.utils.ts`, after its `length` helper (line 29):

```typescript
import { registerComparisonHelpers } from "./workflow-comparison-helpers";
// ...after the existing registerHelper calls:
registerComparisonHelpers(dryRunHandlebars);
```

In `workflow-trigger-condition.helpers.ts`, after the `not` helper (line 16):

```typescript
import { registerComparisonHelpers } from "./workflow-comparison-helpers";
// ...after the existing registerHelper calls:
registerComparisonHelpers(hbs);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test --workspace=apps/api -- run src/workflow/state-manager.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run build:api`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workflow/state-manager.service.ts apps/api/src/workflow/workflow-dry-run.utils.ts apps/api/src/workflow/workflow-trigger-condition.helpers.ts apps/api/src/workflow/state-manager.service.spec.ts
git commit -m "feat(workflow): register comparison helpers on job/dry-run/trigger condition engines"
```

### Task 1.3: Expose `activeNowInitiativeCount` in the contract schema

**Files:**

- Modify: `packages/kanban-contracts/src/strategic.schema.ts:6-18`
- Test: `packages/kanban-contracts/src/strategic.schema.spec.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create/append `packages/kanban-contracts/src/strategic.schema.spec.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { StrategicStalenessSchema } from "./strategic.schema";

const base = {
  lastDiscoveryAt: null,
  mergesSinceDiscovery: 0,
  commitsSinceDiscovery: null,
  lastCharterUpdateAt: null,
  lastInitiativeReviewAt: null,
  lastWorkItemCreatedAt: null,
  backlogDepth: 0,
  recentBurnRatePerCycle: 0,
  starvationForecastCycles: 0,
};

describe("StrategicStalenessSchema activeNowInitiativeCount", () => {
  it("requires activeNowInitiativeCount", () => {
    expect(() => StrategicStalenessSchema.parse(base)).toThrow();
  });

  it("accepts the full object", () => {
    const parsed = StrategicStalenessSchema.parse({
      ...base,
      activeNowInitiativeCount: 1,
    });
    expect(parsed.activeNowInitiativeCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test --workspace=packages/kanban-contracts -- run src/strategic.schema.spec.ts`
Expected: FAIL — `.strict()` rejects the unknown key in the second test.

- [ ] **Step 3: Add the field**

In `packages/kanban-contracts/src/strategic.schema.ts`, add inside the object before `.strict()`:

```typescript
    starvationForecastCycles: z.number(),
    activeNowInitiativeCount: z.number().int(),
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test --workspace=packages/kanban-contracts -- run src/strategic.schema.spec.ts`
Expected: PASS.

- [ ] **Step 5: Build the contracts package**

Run: `npm run build --workspace=packages/kanban-contracts`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/kanban-contracts/src/strategic.schema.ts packages/kanban-contracts/src/strategic.schema.spec.ts
git commit -m "feat(kanban-contracts): expose activeNowInitiativeCount on strategic staleness"
```

### Task 1.4: Compute `activeNowInitiativeCount` in the service (TDD)

**Files:**

- Modify: `apps/kanban/src/orchestration/strategic/project-strategic-state.types.ts:3-13` (add `activeNowInitiativeCount: number`)
- Modify: `apps/kanban/src/orchestration/strategic/project-strategic-state.service.ts` (assembly at lines 78-88; add helper)
- Test: `apps/kanban/src/orchestration/strategic/project-strategic-state.service.spec.ts`

- [ ] **Step 1: Add the field to the kanban type**

In `project-strategic-state.types.ts`, add to `StrategicStaleness`:

```typescript
starvationForecastCycles: number | null;
activeNowInitiativeCount: number;
```

- [ ] **Step 2: Write the failing tests**

Append to `project-strategic-state.service.spec.ts` (reuse `buildService`/`buildOrchestration`/`buildWorkItem`/`buildInitiative`):

```typescript
describe("activeNowInitiativeCount", () => {
  it("counts active now-horizon initiatives", async () => {
    const { service, orchestrationRepo, workItemRepo } = buildService();
    orchestrationRepo.findByProjectId.mockResolvedValue(buildOrchestration({}));
    workItemRepo.findByProjectId.mockResolvedValue([]);

    const state = await service.buildStrategicState("p1", [
      buildInitiative({ horizon: "now", status: "active" }),
      buildInitiative({ horizon: "now", status: "proposed" }),
      buildInitiative({ horizon: "next", status: "active" }),
    ]);
    expect(state.staleness.activeNowInitiativeCount).toBe(1);
  });

  it("is zero when no initiatives exist", async () => {
    const { service, orchestrationRepo, workItemRepo } = buildService();
    orchestrationRepo.findByProjectId.mockResolvedValue(buildOrchestration({}));
    workItemRepo.findByProjectId.mockResolvedValue([]);

    const state = await service.buildStrategicState("p1", []);
    expect(state.staleness.activeNowInitiativeCount).toBe(0);
  });
});
```

> If `buildInitiative` does not accept `horizon`/`status` overrides, extend it minimally to spread overrides (`{ ...defaults, ...overrides }`).

- [ ] **Step 3: Run to verify they fail**

Run: `npm run test --workspace=apps/kanban -- run src/orchestration/strategic/project-strategic-state.service.spec.ts`
Expected: FAIL — `activeNowInitiativeCount` is `undefined`.

- [ ] **Step 4: Implement the computation**

Add a private helper near `maxInitiativeReview`:

```typescript
private countActiveNowInitiatives(
  initiatives: ReadonlyArray<{ horizon: string; status: string }>,
): number {
  return initiatives.filter(
    (initiative) =>
      initiative.horizon === "now" && initiative.status === "active",
  ).length;
}
```

Add to the staleness assembly (lines 78-88):

```typescript
  starvationForecastCycles: starvationForecastCycles ?? null,
  activeNowInitiativeCount: this.countActiveNowInitiatives(initiatives),
```

Add `activeNowInitiativeCount: 0` to the `EMPTY_STALENESS` constant.

> If the initiative records expose `horizon`/`status` under different property names, adjust to match the `Initiative` record shape (`apps/kanban/src/initiatives/initiatives.service.ts:114-129`).

- [ ] **Step 5: Run to verify they pass**

Run: `npm run test --workspace=apps/kanban -- run src/orchestration/strategic/project-strategic-state.service.spec.ts`
Expected: PASS (including pre-existing tests).

- [ ] **Step 6: Typecheck**

Run: `npm run build:kanban`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/kanban/src/orchestration/strategic/project-strategic-state.types.ts apps/kanban/src/orchestration/strategic/project-strategic-state.service.ts apps/kanban/src/orchestration/strategic/project-strategic-state.service.spec.ts
git commit -m "feat(kanban): compute activeNowInitiativeCount in strategic state"
```

> No change is needed in `project-state.tool.ts` — it already returns `strategic.staleness` wholesale (lines 197-201), so `activeNowInitiativeCount` flows through automatically (and `mergesSinceDiscovery`/`recentBurnRatePerCycle`/`starvationForecastCycles` were already present). Verify in Task 2.1's manual check.

---

## PHASE 2 — Deterministic gate jobs in the cycle workflow

Restructure `project-orchestration-cycle-ceo.workflow.yaml` so the engine loads state once and fires the three specialist passes by `condition`, before the strategize agent step.

### Task 2.1: Add the deterministic gate jobs to the workflow

**Files:**

- Modify: `seed/workflows/project-orchestration-cycle-ceo.workflow.yaml` (the `jobs:` array, currently lines 135-176)

- [ ] **Step 1: Add `load_state`, three gate jobs, and rewire `strategize` dependency**

Insert these jobs at the START of the `jobs:` array (before the current `strategize` job), and add `depends_on` to `strategize`:

```yaml
jobs:
  - id: load_state
    type: mcp_tool_call
    tier: light
    inputs:
      server_id: kanban-mcp
      tool_name: kanban.project_state
      params:
        project_id: "{{ trigger.scopeId }}"
      policy:
        allowed_servers:
          - kanban-mcp
        allowed_tools:
          - kanban.project_state

  # Threshold 10 mirrors REDISCOVERY_MERGE_THRESHOLD (@nexus/kanban-contracts).
  - id: rediscovery_gate
    type: invoke_workflow
    tier: heavy
    depends_on: [load_state]
    condition: "{{#if (gte jobs.load_state.output.result.strategic.staleness.mergesSinceDiscovery 10)}}true{{else}}false{{/if}}"
    workflow_id: project_codebase_deep_investigation
    inputs:
      scopeId: "{{ trigger.scopeId }}"
      mode: refresh

  - id: roadmap_planning_gate
    type: invoke_workflow
    tier: heavy
    depends_on: [rediscovery_gate]
    condition: "{{#if (eq jobs.load_state.output.result.strategic.staleness.activeNowInitiativeCount 0)}}true{{else}}false{{/if}}"
    workflow_id: project_roadmap_planning
    inputs:
      scopeId: "{{ trigger.scopeId }}"
      reason: "Deterministic gate: no active now-horizon initiative."

  # Threshold 2 mirrors IDEATION_STARVATION_THRESHOLD_CYCLES (@nexus/kanban-contracts).
  # Burn-rate-zero branch covers the new/stalled (null forecast) case.
  - id: ideation_gate
    type: invoke_workflow
    tier: heavy
    depends_on: [roadmap_planning_gate]
    condition: "{{#if (or (eq jobs.load_state.output.result.strategic.staleness.recentBurnRatePerCycle 0) (lte jobs.load_state.output.result.strategic.staleness.starvationForecastCycles 2))}}true{{else}}false{{/if}}"
    workflow_id: project_goal_backlog_planning
    inputs:
      scopeId: "{{ trigger.scopeId }}"
      reason: "Deterministic gate: backlog starvation forecast at/under threshold."

  - id: strategize
    type: execution
    tier: heavy
    workspace: true
    depends_on: [ideation_gate]
    max_retries: 2
    max_step_loops: 10
    # ... rest of the existing strategize job unchanged ...
```

Keep the existing `strategize` job body (inputs, steps, output_contract) exactly as-is apart from adding `depends_on: [ideation_gate]`. Keep the `dispatch` job unchanged (`depends_on: [strategize]`, reads `jobs.strategize.output.groomed_board_summary`).

> Ordering rationale: rediscovery → roadmap → ideation chained via `depends_on` so the fresh capability map informs roadmap planning, which informs ideation (guide §3.3). A skipped (`condition` false) gate still satisfies its dependents — same pattern as `project-discovery-ceo.workflow.yaml:99-150`.

- [ ] **Step 2: Verify the seed workflow still parses/validates (dry-run)**

Run: `npm run test --workspace=apps/api -- run src/workflow/testing/seed-workflows.dry-run.spec.ts`
Expected: PASS — the seed parses, all job types (`mcp_tool_call`, `invoke_workflow`, `execution`) and conditions validate.

- [ ] **Step 3: Manually confirm the boolean path resolves**

Run: `npm run test --workspace=apps/kanban -- run src/mcp/tools/read/project-state.tool.spec.ts`
Expected: PASS, and confirm the returned `strategic.staleness` includes `mergesSinceDiscovery`, `recentBurnRatePerCycle`, `starvationForecastCycles`, and the new `activeNowInitiativeCount` (add a one-line assertion to an existing project-state test if none covers it). This proves the condition paths `jobs.load_state.output.result.strategic.staleness.<signal>` are real.

### Task 2.2: Update the seed contract spec for the new structure

**Files:**

- Modify: `apps/kanban/src/seeds/project-orchestration-cycle-ceo.seed-contract.spec.ts`

- [ ] **Step 1: Write/adjust assertions for the deterministic gates**

Add a `describe` block asserting the new DAG (use the spec's existing `readSeed` / YAML-load helpers):

```typescript
describe("EPIC-208 deterministic gates", () => {
  it("loads project_state via a deterministic mcp_tool_call job", () => {
    const workflow = readSeed("project-orchestration-cycle-ceo.workflow.yaml");
    expect(workflow).toContain("id: load_state");
    expect(workflow).toContain("type: mcp_tool_call");
    expect(workflow).toContain("tool_name: kanban.project_state");
  });

  it("fires the three specialist passes as condition-gated invoke_workflow jobs", () => {
    const workflow = readSeed("project-orchestration-cycle-ceo.workflow.yaml");
    expect(workflow).toContain("id: rediscovery_gate");
    expect(workflow).toContain(
      "workflow_id: project_codebase_deep_investigation",
    );
    expect(workflow).toContain(
      "(gte jobs.load_state.output.result.strategic.staleness.mergesSinceDiscovery 10)",
    );
    expect(workflow).toContain("id: roadmap_planning_gate");
    expect(workflow).toContain("workflow_id: project_roadmap_planning");
    expect(workflow).toContain(
      "(eq jobs.load_state.output.result.strategic.staleness.activeNowInitiativeCount 0)",
    );
    expect(workflow).toContain("id: ideation_gate");
    expect(workflow).toContain("workflow_id: project_goal_backlog_planning");
    expect(workflow).toContain(
      "(lte jobs.load_state.output.result.strategic.staleness.starvationForecastCycles 2)",
    );
  });

  it("runs strategize after the gates", () => {
    const workflow = readSeed("project-orchestration-cycle-ceo.workflow.yaml");
    expect(workflow).toContain("depends_on: [ideation_gate]");
  });
});
```

- [ ] **Step 2: Run the contract spec**

Run: `npm run test --workspace=apps/kanban -- run src/seeds/project-orchestration-cycle-ceo.seed-contract.spec.ts`
Expected: PASS. If any pre-existing assertion about strategize being the FIRST job fails, update it to reflect that `load_state` is now first and strategize depends on `ideation_gate`.

- [ ] **Step 3: Commit**

```bash
git add seed/workflows/project-orchestration-cycle-ceo.workflow.yaml apps/kanban/src/seeds/project-orchestration-cycle-ceo.seed-contract.spec.ts
git commit -m "feat(orchestration): deterministic condition-gated specialist passes in CEO cycle"
```

---

## PHASE 3 — Slim the strategize prompt (retain agent override)

The engine now fires gates deterministically. Remove the threshold-arithmetic instructions; tell the agent the gates already ran and it may additionally delegate on judgement.

### Task 3.1: Rewrite the gating sections of `strategize.md`

**Files:**

- Modify: `seed/workflows/prompts/project-orchestration-cycle-ceo/strategize.md` (sections at lines 18-51)

- [ ] **Step 1: Replace the two gating sections**

Replace the "Keep have vs. want fresh — gated re-discovery" and "Strategic refresh gating (roadmap + ideation)" sections (lines 18-51) with:

```markdown
## Specialist passes already evaluated by the engine

Before this step ran, the orchestration engine deterministically evaluated three
staleness gates from `kanban.project_state.strategic.staleness` and fired the
warranted specialist passes (re-discovery, roadmap planning, ideation), awaiting
each. You are reading a board that already reflects their results. The gates the
engine evaluates are:

- **re-discovery** — `mergesSinceDiscovery >= 10` (capability map drift)
- **roadmap planning** — `activeNowInitiativeCount == 0` (no active `now`-horizon initiative)
- **ideation** — `recentBurnRatePerCycle == 0` or `starvationForecastCycles <= 2`

**You do not need to evaluate these thresholds.** The engine evaluated them from
the raw `strategic.staleness` signals before this step ran.

### Judgement-based override (optional)

The deterministic gates are conservative. If your judgement — informed by the
charter, the timeline, and the latest strategic intent — says a pass is warranted
even though its gate did not fire (e.g. a risky subsystem changed in only 8
merges, or an active goal still has no initiative), you may call the matching
`delegate_*` tool yourself; it durably awaits. Use this sparingly and record the
rationale in your strategic intent. Do NOT re-fire a pass the engine already ran
this cycle.
```

- [ ] **Step 2: Verify the strategize prompt content assertions still hold**

Run: `npm run test --workspace=apps/kanban -- run src/seeds/project-orchestration-cycle-ceo.seed-contract.spec.ts`
Expected: FAIL on any assertion requiring the old threshold prose (e.g. assertions referencing `REDISCOVERY_MERGE_THRESHOLD` or "mergesSinceDiscovery >= " in the prompt).

- [ ] **Step 3: Update the now-stale prompt-content assertions**

In the spec, replace assertions that required the threshold arithmetic prose with assertions for the new shape, e.g.:

```typescript
it("strategize prompt defers gate evaluation to the engine and allows override", () => {
  const prompt = readSeed(
    "prompts/project-orchestration-cycle-ceo/strategize.md",
  );
  expect(prompt).toContain("already evaluated by the engine");
  expect(prompt).toContain("Judgement-based override");
  // The threshold arithmetic instructions are gone from the prompt (now in YAML conditions).
  expect(prompt).not.toContain("REDISCOVERY_MERGE_THRESHOLD = 10");
  expect(prompt).not.toContain(
    "mergesSinceDiscovery >= REDISCOVERY_MERGE_THRESHOLD",
  );
});
```

Keep assertions that still hold (loads charter/initiatives/intent, records strategic intent, hands off `groomed_board_summary`, retains `delegate_*` tools in the allowlist — the workflow `permissions` are unchanged, so the override tools remain available).

- [ ] **Step 4: Run the spec**

Run: `npm run test --workspace=apps/kanban -- run src/seeds/project-orchestration-cycle-ceo.seed-contract.spec.ts`
Expected: PASS.

- [ ] **Step 5: Update the guide**

In `docs/guide/47-strategic-refresh-loop.md` §3.3 ("Staleness checks (between Perceive and Groom)") and §5, note that gating is now deterministic — engine-evaluated `condition`-gated `invoke_workflow` jobs using the new `gte`/`lte` helpers over raw `strategic.staleness` signals (`mergesSinceDiscovery`, `recentBurnRatePerCycle`, `starvationForecastCycles`, `activeNowInitiativeCount`), with the agent retaining a judgement override via the `delegate_*` tools. State the three gate expressions from Phase 1 and note the thresholds are inline in the seed YAML (mirroring the `@nexus/kanban-contracts` constants).

- [ ] **Step 6: Commit**

```bash
git add seed/workflows/prompts/project-orchestration-cycle-ceo/strategize.md apps/kanban/src/seeds/project-orchestration-cycle-ceo.seed-contract.spec.ts docs/guide/47-strategic-refresh-loop.md
git commit -m "refactor(orchestration): slim strategize prompt to engine-driven gates with agent override"
```

**Checkpoint: Phases 1–3 are independently shippable. Run `npm run test:kanban` and `npm run test:api` before proceeding.**

---

## PHASE 4 — Kanban promotable-backlog + capacity computation

Expose a deterministic, computable "safe to promote" backlog set and a capacity snapshot in `project-state`, so Phase 5 can promote without LLM prose. "Safe" here is the **mechanically determinable** subset: status `backlog`, dependencies all `done`, not status `blocked`, and not flagged by a `human_decision` probe finding. (Execution-config validity remains agent/patch territory — those items simply won't appear as promotable and the agent can still patch+promote them.)

### Task 4.1: Compute `promotableBacklog` and `capacity` in the project-state tool (TDD)

**Files:**

- Modify: `apps/kanban/src/mcp/tools/read/project-state.tool.ts` (summary computation ~lines 230-349; result assembly ~lines 197-201)
- Test: `apps/kanban/src/mcp/tools/read/project-state.tool.spec.ts`

- [ ] **Step 1: Write the failing tests**

Append to the project-state tool spec (reuse its existing work-item builder/mocks):

```typescript
describe("promotable backlog", () => {
  it("includes backlog items with all dependencies done and no human_decision flag", async () => {
    // Arrange a project with: one promotable backlog item, one backlog item
    // blocked by an unmet dependency, one backlog item with a human_decision flag.
    // (Use the spec's existing harness to stub work items + initiatives.)
    const result = await runProjectState({
      workItems: [
        wi({ id: "ok", status: "backlog" }),
        wi({ id: "dep", status: "backlog", dependsOn: ["pending"] }),
        wi({ id: "pending", status: "todo" }),
        wi({
          id: "human",
          status: "backlog",
          metadata: { human_decision: { blocked: true } },
        }),
      ],
    });

    const ids = result.strategic.dispatch.promotableBacklog.map((c) => c.id);
    expect(ids).toEqual(["ok"]);
  });

  it("reports capacity available slots from the WIP setting", async () => {
    const result = await runProjectState({
      maxActive: 3,
      workItems: [wi({ id: "a", status: "in-progress" })],
    });
    expect(result.strategic.dispatch.capacity.availableSlots).toBe(2);
    expect(result.strategic.dispatch.capacity.canLaunchNewWork).toBe(true);
  });
});
```

> Adapt `runProjectState`/`wi` to the spec's actual helper names. If the spec has no settings mock for `work_item_dispatch_max_active_per_project`, stub `kanbanSettings.getNumber` to return the test's `maxActive`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=apps/kanban -- run src/mcp/tools/read/project-state.tool.spec.ts`
Expected: FAIL — `strategic.dispatch` is undefined.

- [ ] **Step 3: Implement promotable computation + capacity**

Add a private predicate alongside `isDispatchableTodoItem` (lines 292-326):

```typescript
private isHumanDecisionBlocked(item: Record<string, unknown>): boolean {
  const metadata = asRecord(item["metadata"]);
  return Boolean(metadata && asRecord(metadata["human_decision"]));
}

private isPromotableBacklogItem(
  item: Record<string, unknown>,
  itemById: Map<string, Record<string, unknown>>,
): boolean {
  return (
    this.getString(item, "status") === "backlog" &&
    !this.isHumanDecisionBlocked(item) &&
    this.dependenciesReady(item, itemById)
  );
}
```

Build the candidate list and capacity in the summary computation, and expose under `strategic.dispatch`. Import the capacity helpers:

```typescript
import {
  countActiveProjectDispatches,
  resolveProjectDispatchCapacityFromActiveCount,
} from "../../../dispatch/project-dispatch-capacity";
```

Compute (within the existing summary build, where `workItems`/`itemById` are in scope):

```typescript
const promotableBacklog = workItems
  .filter((item) => this.isPromotableBacklogItem(item, itemById))
  .map((item) => this.toCompactWorkItemSummary(item)); // reuse existing compactor

const maxActive = await this.kanbanSettings.getNumber(
  "work_item_dispatch_max_active_per_project",
);
const capacity = resolveProjectDispatchCapacityFromActiveCount(
  countActiveProjectDispatches(workItems as WorkItemRecord[]),
  maxActive,
);
```

Add to the returned `strategic` block (lines 197-201):

```typescript
strategic: {
  staleness: strategic.staleness,
  latestStrategicIntent: strategic.latestStrategicIntent,
  initiatives: this.toStrategicInitiativeViews(initiatives, workItems),
  dispatch: { promotableBacklog, capacity },
},
```

Update the tool's result interface (the `strategic` block type near lines 47-52) to include `dispatch: { promotableBacklog: CompactWorkItemSummary[]; capacity: ProjectDispatchCapacity }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=apps/kanban -- run src/mcp/tools/read/project-state.tool.spec.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run build:kanban`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/kanban/src/mcp/tools/read/project-state.tool.ts apps/kanban/src/mcp/tools/read/project-state.tool.spec.ts
git commit -m "feat(kanban): expose deterministic promotable-backlog and capacity in project_state"
```

---

## PHASE 5 — Deterministic zero-todo promotion + slim dispatch

Add a deterministic promotion job that runs before the dispatch agent and promotes safe backlog when the board is zero-todo, removing the prose MANDATE's load-bearing role. The agent then handles only the genuine residue (blocked-item reasoning, patch-and-promote, capacity narrative, final decision).

### Task 5.1: Add the deterministic promotion job to the workflow

**Files:**

- Modify: `seed/workflows/project-orchestration-cycle-ceo.workflow.yaml`

- [ ] **Step 1: Insert a `promote_safe_backlog` job between `strategize` and `dispatch`**

```yaml
- id: promote_safe_backlog
  type: mcp_tool_call
  tier: light
  depends_on: [strategize]
  condition: "{{#if (and (eq jobs.strategize.output.groomed_board_summary.todo_count 0) (eq jobs.strategize.output.groomed_board_summary.autonomous_mode true))}}true{{else}}false{{/if}}"
  for_each: "{{ jobs.strategize.output.groomed_board_summary.promotion_candidates }}"
  continue_on_error: true
  inputs:
    server_id: kanban-mcp
    tool_name: kanban.work_item_transition_status
    params:
      project_id: "{{ trigger.scopeId }}"
      workItemId: "{{ item.workItemId }}"
      status: todo
    policy:
      allowed_servers:
        - kanban-mcp
      allowed_tools:
        - kanban.work_item_transition_status
```

Then change the `dispatch` job's dependency to `depends_on: [promote_safe_backlog]` (it still reads `{{ jobs.strategize.output.groomed_board_summary }}`).

> This makes the "promote safe unblocked backlog when zero-todo" path structural, not prose-enforced. `promotion_candidates` is already produced by strategize (the ranked unblocked-backlog list, `strategize.md` Section 4); Phase 4's `promotableBacklog` is the authoritative source the strategize step should populate it from (note that in Task 5.3). `continue_on_error: true` means a WIP-limit rejection on one item does not abort the others.

- [ ] **Step 2: Dry-run validate**

Run: `npm run test --workspace=apps/api -- run src/workflow/testing/seed-workflows.dry-run.spec.ts`
Expected: PASS.

### Task 5.2: Slim the dispatch prompt

**Files:**

- Modify: `seed/workflows/prompts/project-orchestration-cycle-ceo/dispatch.md`

- [ ] **Step 1: Replace the MANDATE/FORBIDDEN/DECISION-TREE walls**

Remove the large prose blocks (the "ZERO-TODO BACKLOG PROMOTION MANDATE" table, "AUTONOMOUS ZERO-TODO BOARD RULE", "FORBIDDEN PATTERNS", "DECISION TREE LOGIC") and replace with a concise statement:

```markdown
## Zero-todo handling (engine-assisted)

When the board is zero-todo and autonomous, the engine has already promoted the
safe, dependency-ready, non-human-decision backlog candidates to `todo` before
this step (the `promote_safe_backlog` job). Re-read `kanban.project_state` to see
the post-promotion board.

Your remaining responsibilities:

- **Lifecycle-start** dispatchable `todo` work via `kanban.work_item_transition_status`
  (`status: in-progress`) while capacity (`strategic.dispatch.capacity.availableSlots`) allows.
- **Patch-and-promote** any backlog item the engine could not auto-promote because
  of a fixable execution-config blocker (`kanban.work_item_patch_execution_config`,
  then transition to `todo`).
- **Restart** stale executions (in an automation status with no linked run) via
  `kanban.work_item_restart_execution`.
- For items that remain genuinely blocked, record per-item `blockedReason` in your
  decision `reason` (the `blockedItems` array shape below).
- Record the final decision via `kanban.complete_orchestration_cycle_decision`, then `step_complete`.
```

Keep: the `blockedItems` array shape, the `complete_orchestration_cycle_decision` → `step_complete` ordering, the circuit-broken-delegation rule, the restart rules, and the WIP/capacity confirmation rules. Delete the redundant FORBIDDEN-pattern catalogue (the structural promotion + the output_contract `forbidden` clause now enforce it).

- [ ] **Step 2: Keep the output_contract forbidden clause as a backstop**

Leave the `dispatch` job's `output_contract.forbidden` bare-repeat rule in the workflow YAML unchanged — it remains a cheap deterministic backstop.

### Task 5.3: Note the promotion_candidates source in strategize

**Files:**

- Modify: `seed/workflows/prompts/project-orchestration-cycle-ceo/strategize.md` (Section 4 handoff)

- [ ] **Step 1: Point promotion_candidates at the authoritative computed set**

In Section 4, change the `promotion_candidates` guidance to instruct the agent to copy `strategic.dispatch.promotableBacklog` (from `kanban.project_state`) verbatim into the summary, ranked by priority/initiative alignment, rather than re-deriving "unblocked" by hand:

```markdown
The `promotion_candidates` array MUST be drawn from
`kanban.project_state.strategic.dispatch.promotableBacklog` (the engine's
authoritative safe-to-promote set). Rank them by priority and active-`now`
initiative alignment. Do not invent candidates not present in that set.
```

### Task 5.4: Update the dispatch contract spec

**Files:**

- Modify: `apps/kanban/src/seeds/project-orchestration-cycle-ceo.seed-contract.spec.ts`

- [ ] **Step 1: Run the spec to see what breaks**

Run: `npm run test --workspace=apps/kanban -- run src/seeds/project-orchestration-cycle-ceo.seed-contract.spec.ts`
Expected: FAIL on assertions that require the deleted prose: the "Autonomous Zero-Todo Board Mandate" section header (spec ~line 297) and the "(a)..(d) required paths" regexes (spec ~lines 305-327).

- [ ] **Step 2: Replace those assertions with the new structural guarantees**

```typescript
it("promotes safe backlog deterministically when zero-todo (engine job)", () => {
  const workflow = readSeed("project-orchestration-cycle-ceo.workflow.yaml");
  expect(workflow).toContain("id: promote_safe_backlog");
  expect(workflow).toContain("tool_name: kanban.work_item_transition_status");
  expect(workflow).toContain("groomed_board_summary.todo_count");
  expect(workflow).toContain("for_each:");
});

it("dispatch still backstops bare repeat via output_contract.forbidden", () => {
  const outputContract = loadWorkflowOutputContract();
  const bareRepeat = outputContract?.forbidden?.find((e) =>
    e.condition?.includes("decision == 'repeat'"),
  );
  expect(bareRepeat?.condition).toContain("todo_count == 0");
  expect(bareRepeat?.condition).toContain("backlog_count > 0");
});

it("dispatch prompt references engine-assisted promotion and the capacity signal", () => {
  const prompt = readSeed(
    "prompts/project-orchestration-cycle-ceo/dispatch.md",
  );
  expect(prompt).toContain("engine has already promoted");
  expect(prompt).toContain("strategic.dispatch.capacity.availableSlots");
});
```

Keep the still-valid assertions (composite decision before step_complete; tool allowlist includes `work_item_transition_status`, `work_item_patch_execution_config`, `dispatch_selected_work_items`, `delegate_work_item_generation`).

- [ ] **Step 3: Run the spec**

Run: `npm run test --workspace=apps/kanban -- run src/seeds/project-orchestration-cycle-ceo.seed-contract.spec.ts`
Expected: PASS.

- [ ] **Step 4: Update the guide**

In `docs/guide/47-strategic-refresh-loop.md` §3.4, document the `promote_safe_backlog` job and that the zero-todo mandate is now structurally enforced (deterministic promotion + `output_contract.forbidden` backstop) rather than prose-enforced. Update the worked example (§11 Step 8) to reflect the engine pre-promoting.

- [ ] **Step 5: Commit**

```bash
git add seed/workflows/project-orchestration-cycle-ceo.workflow.yaml seed/workflows/prompts/project-orchestration-cycle-ceo/dispatch.md seed/workflows/prompts/project-orchestration-cycle-ceo/strategize.md apps/kanban/src/seeds/project-orchestration-cycle-ceo.seed-contract.spec.ts docs/guide/47-strategic-refresh-loop.md
git commit -m "feat(orchestration): deterministic zero-todo promotion job; slim dispatch prompt"
```

---

## Final Verification

- [ ] **Step 1: Full kanban + api unit suites**

Run: `npm run test:kanban`
Expected: PASS.

Run: `npm run test:api`
Expected: PASS (includes the seed-workflows dry-run).

- [ ] **Step 2: Builds**

Run: `npm run build --workspace=packages/kanban-contracts && npm run build:kanban && npm run build:api`
Expected: all exit 0.

- [ ] **Step 3: Lint**

Run: `npm run lint:kanban` and `npm run lint:api`
Expected: PASS, no suppressions added.

- [ ] **Step 4: Validate seed data**

Run: `npm run validate:seed-data`
Expected: PASS.

- [ ] **Step 5: Live-stack smoke (manual, post-merge)**

The deterministic gates and promotion only exercise fully against a live stack with a seeded project. After deploy, trigger an orchestration cycle on a zero-todo autonomous board with unblocked backlog and confirm via `retrieve-workflow-events` that `load_state` → gated jobs → `promote_safe_backlog` → `dispatch` fired with the expected skips, and the board promoted without the agent being relied on for the mandate. (This step is verification, not a code change — see the live re-verify pattern in prior orchestration memories.)

---

## Self-Review Notes

- **Spec coverage:** numeric helpers (Phase 1.1–1.2), raw signal exposure (1.3–1.4), deterministic gates (Phase 2), prompt slimming + override retained (Phase 3), dispatch promotion (Phases 4–5) all covered.
- **Type consistency:** `activeNowInitiativeCount` named identically across contract schema (1.3), kanban type/service (1.4), workflow condition (2.1), and spec (2.2). Gate conditions reference only signals that exist on `strategic.staleness`: `mergesSinceDiscovery`, `recentBurnRatePerCycle`, `starvationForecastCycles` (pre-existing) and `activeNowInitiativeCount` (added 1.3–1.4). `registerComparisonHelpers` named identically across the helper module (1.1) and all three registration sites (1.2). `strategic.dispatch.{promotableBacklog,capacity}` named identically across tool (4.1), workflow promotion job + dispatch prompt (5.1/5.2), and spec (5.4).
- **Known scoping decisions (intentional, documented in-plan):** thresholds `10`/`2` are inline in the seed YAML conditions (the chosen numeric-helper tradeoff — see header), with the kanban-contracts constants retained as documented canonical values. The roadmap gate covers only "no active now-initiative" deterministically; time-based horizon staleness and "active goal lacks initiative" are left to the agent override. The ideation gate uses a burn-rate-zero branch instead of a `null` Handlebars literal. Execution-config-blocked backlog is excluded from `promotableBacklog` and handled by the agent's patch-and-promote path.
- **Helper-registration risk:** comparison helpers are added to all three Handlebars instances (job/dry-run/trigger). Existing `eq`/`and`/`or`/`not` are untouched, so no behavior change to current conditions; the new helpers are purely additive. `build:api` + the full `test:api` suite (Final Verification) guard against regressions.
- **Risk:** Restructuring `depends_on` could change run-graph read models / UI; the dry-run spec (2.1 Step 2) and full `test:api` (Final Step 1) guard parsing/validation, but the live smoke (Final Step 5) is required before trusting production behaviour.
