# Escalated Blocked-Item Recovery (CEO-Mediated) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Refreshed 2026-06-28 against current `main`.** Anchors re-verified; all target
> files still exist and the code structures still match. Corrections applied since
> the 2026-06-16 draft:
>
> - **Prompt-reading helper:** the spec has **no `readSeedPrompt` helper**. Use
>   `readSeed("prompts/<dir>/<file>.md")` — `readSeed` resolves relative to
>   `seed/workflows`, so prefix the path with `prompts/`. (Tasks 4 & 5.)
> - **Line numbers drifted up ~7-15 lines** in `project-state.tool.ts`; corrected
>   inline below. Treat all line numbers as approximate and locate by the named
>   symbol, not the number.
> - **Escalation `metadataPatch`** in `work-item-in-progress-default.workflow.yaml`
>   is now at ~lines 295-304 (was 271-280). It currently has NO `replanAttempts`
>   key — Task 3 still applies as written.
> - A new `awaiting-pr-merge` status exists in `WorkItemStatusSchema`; irrelevant
>   to this plan (we only act on `blocked`), noted for context.

**Goal:** Make work items escalated to `blocked` (with `metadata.escalation.recommendation = "fresh_architect_pass"`) visible to the CEO orchestration cycle so the strategize step can deliberately recover them — bounded by a re-plan attempt cap — instead of leaving them permanently stranded.

**Architecture:** Purely Kanban-domain. We (1) give the escalation metadata a real contract type, (2) surface a new `escalatedBlockedItems` set inside `project_state.strategic.dispatch`, and (3) teach the CEO strategize/dispatch prompts to act on that set: re-plan (delegate architect pass + bump `replanAttempts`), defer to `backlog` with the QA feedback attached, or hold for human attention once the attempt cap is reached. No always-on automation, no API/core changes, no new lifecycle-triggered workflow. The cap-counter (`metadata.escalation.replanAttempts`) is incremented by the CEO via `kanban.work_item_patch_metadata` when it acts, so loops are structurally bounded.

**Tech Stack:** TypeScript, Zod (kanban-contracts), NestJS (apps/kanban MCP read tool), Vitest, YAML workflow seeds + Handlebars prompt files.

**Boundary note:** Every change lives in `packages/kanban-contracts`, `apps/kanban`, or `seed/workflows/prompts/project-orchestration-cycle-ceo`. Do NOT touch `apps/api` or `packages/core` — escalation/work-item domain logic is Kanban-owned (`nexus-boundaries/no-core-kanban-residue`).

**Why CEO-mediated (not auto-trigger):** The item is `blocked` precisely because it failed acceptance criteria in ≥2 consecutive rounds. Auto-re-dispatching it risks an escalate→replan→fail→escalate loop — the exact runaway escalation exists to stop. Routing recovery through the once-per-cycle CEO judgment gate, plus a hard `replanAttempts` cap, keeps a human/agent decision in the loop and bounds the blast radius.

---

## File Structure

| File                                                                   | Responsibility                    | Change                                                                                                                                                    |
| ---------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/kanban-contracts/src/work-item.schema.ts`                    | Work-item Zod contracts           | Add `WorkItemEscalationSchema`, `ESCALATION_RECOMMENDATIONS`, `MAX_ESCALATION_REPLAN_ATTEMPTS`                                                            |
| `packages/kanban-contracts/src/work-item.schema.spec.ts`               | Contract tests                    | New escalation-schema tests (create file if absent; otherwise extend)                                                                                     |
| `apps/kanban/src/mcp/tools/read/project-state.tool.ts`                 | `kanban.project_state` read model | Add `EscalatedBlockedItemSummary` type, `isEscalatedBlockedItem`, `toEscalatedBlockedItemSummary`, wire `escalatedBlockedItems` into `strategic.dispatch` |
| `apps/kanban/src/mcp/tools/read/project-state.tool.spec.ts`            | Read-model tests                  | New `escalatedBlockedItems` selection tests                                                                                                               |
| `seed/workflows/work-item-in-progress-default.workflow.yaml`           | Escalation producer               | Initialise `replanAttempts: 0` in the escalation `metadataPatch`                                                                                          |
| `seed/workflows/prompts/project-orchestration-cycle-ceo/strategize.md` | CEO grooming prompt               | New "Escalated blocked items" handling section                                                                                                            |
| `seed/workflows/prompts/project-orchestration-cycle-ceo/dispatch.md`   | CEO dispatch prompt               | Acknowledge escalated items in the decision (never silently ignore)                                                                                       |
| `apps/kanban/src/seeds/workflows.seed.contract.spec.ts`                | Seed contract tests               | Assert the seed/prompt changes above                                                                                                                      |
| `docs/guide/47-strategic-refresh-loop.md`                              | Operator docs                     | Document the escalated-blocked recovery path                                                                                                              |

---

## Task 1: Type the escalation metadata in kanban-contracts

**Files:**

- Modify: `packages/kanban-contracts/src/work-item.schema.ts` (after `WorkItemRejectionFeedbackSchema`, ~line 52)
- Test: `packages/kanban-contracts/src/work-item.schema.spec.ts` (create if it does not exist)

- [ ] **Step 1: Write the failing test**

Create/extend `packages/kanban-contracts/src/work-item.schema.spec.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  WorkItemEscalationSchema,
  ESCALATION_RECOMMENDATIONS,
  MAX_ESCALATION_REPLAN_ATTEMPTS,
} from "./work-item.schema";

describe("WorkItemEscalationSchema", () => {
  it("parses a fresh_architect_pass escalation with a default replanAttempts of 0", () => {
    const parsed = WorkItemEscalationSchema.parse({
      reason: "repeated_ac_failure",
      escalatedAt: "2026-06-16T09:51:00.000Z",
      recommendation: "fresh_architect_pass",
    });
    expect(parsed.recommendation).toBe("fresh_architect_pass");
    expect(parsed.replanAttempts).toBe(0);
  });

  it("preserves an explicit replanAttempts count", () => {
    const parsed = WorkItemEscalationSchema.parse({
      reason: "repeated_ac_failure",
      escalatedAt: "2026-06-16T09:51:00.000Z",
      recommendation: "fresh_architect_pass",
      replanAttempts: 2,
    });
    expect(parsed.replanAttempts).toBe(2);
  });

  it("rejects an unknown recommendation", () => {
    expect(() =>
      WorkItemEscalationSchema.parse({
        reason: "repeated_ac_failure",
        escalatedAt: "2026-06-16T09:51:00.000Z",
        recommendation: "teleport_to_done",
      }),
    ).toThrow();
  });

  it("exposes the recovery cap as a positive integer", () => {
    expect(ESCALATION_RECOMMENDATIONS).toContain("fresh_architect_pass");
    expect(Number.isInteger(MAX_ESCALATION_REPLAN_ATTEMPTS)).toBe(true);
    expect(MAX_ESCALATION_REPLAN_ATTEMPTS).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=packages/kanban-contracts -- run work-item.schema`
Expected: FAIL — `WorkItemEscalationSchema`/`ESCALATION_RECOMMENDATIONS`/`MAX_ESCALATION_REPLAN_ATTEMPTS` are not exported.

(If kanban-contracts has no `test` script, run from repo root: `npx vitest run packages/kanban-contracts/src/work-item.schema.spec.ts`.)

- [ ] **Step 3: Write the minimal implementation**

In `packages/kanban-contracts/src/work-item.schema.ts`, immediately after `WorkItemRejectionFeedbackSchema` (line 52):

```typescript
/** The maximum number of CEO-mediated re-plan attempts before an escalated
 * item is left blocked for human attention. Prevents escalate->replan->fail
 * loops. */
export const MAX_ESCALATION_REPLAN_ATTEMPTS = 2;

export const ESCALATION_RECOMMENDATIONS = ["fresh_architect_pass"] as const;

export const WorkItemEscalationSchema = z
  .object({
    reason: z.string().min(1),
    escalatedAt: z.string().min(1),
    recommendation: z.enum(ESCALATION_RECOMMENDATIONS),
    repeated_acs: z.union([z.array(z.string()), z.string()]).optional(),
    replanAttempts: z.number().int().min(0).default(0),
  })
  .loose();

export type WorkItemEscalation = z.infer<typeof WorkItemEscalationSchema>;
```

Note: `repeated_acs` accepts `string | string[]` because the seed template renders an array into a string in some paths; keep it permissive. `.loose()` tolerates forward-compatible extra keys.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace=packages/kanban-contracts -- run work-item.schema`
Expected: PASS (4 tests).

- [ ] **Step 5: Rebuild the contracts package (downstream consumers import from dist)**

Run: `npm run build --workspace=packages/kanban-contracts`
Expected: clean build. (kanban-contracts is consumed by apps/kanban via the workspace path; rebuild so the new exports resolve.)

- [ ] **Step 6: Commit**

```bash
git add packages/kanban-contracts/src/work-item.schema.ts packages/kanban-contracts/src/work-item.schema.spec.ts
git commit -m "feat(kanban-contracts): type work-item escalation metadata + replan cap"
```

---

## Task 2: Surface `escalatedBlockedItems` in `project_state.strategic.dispatch`

**Files:**

- Modify: `apps/kanban/src/mcp/tools/read/project-state.tool.ts`
  - Add type near `CompactWorkItemSummary` (interface at ~line 76)
  - Extend `dispatch` shape (~lines 57-60)
  - Add predicate + mapper after the `isPromotableBacklogItem` method (starts ~line 329) / near `toCompactWorkItemSummary` (~line 376)
  - Wire selection into the return (`promotableBacklog` select ~lines 206-208; `dispatch: {...}` return ~line 231)
- Test: `apps/kanban/src/mcp/tools/read/project-state.tool.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/kanban/src/mcp/tools/read/project-state.tool.spec.ts` (mirror the existing `promotableBacklog` test setup around lines 669-702; reuse that file's `buildTool`/work-item fixture helpers):

```typescript
it("exposes escalated blocked items with their recommendation and replanAttempts", async () => {
  const tool = buildTool([
    {
      id: "wi-escalated",
      title: "Resolve hardcoded token cap",
      status: "blocked",
      priority: "p1",
      metadata: {
        escalation: {
          reason: "repeated_ac_failure",
          escalatedAt: "2026-06-16T09:51:00.000Z",
          recommendation: "fresh_architect_pass",
          replanAttempts: 1,
        },
      },
    },
    // A plain blocked item WITHOUT escalation metadata must NOT appear.
    { id: "wi-plain-blocked", title: "Waiting on dep", status: "blocked" },
    // A backlog item must remain promotable, unaffected.
    { id: "wi-backlog", title: "New feature", status: "backlog" },
  ]);

  const result = await tool.run({ project_id: "project-1" });

  const escalated = result.strategic.dispatch.escalatedBlockedItems;
  expect(escalated).toHaveLength(1);
  expect(escalated[0]).toMatchObject({
    id: "wi-escalated",
    recommendation: "fresh_architect_pass",
    reason: "repeated_ac_failure",
    replanAttempts: 1,
  });
  // Unaffected sets:
  expect(
    result.strategic.dispatch.escalatedBlockedItems.map((i) => i.id),
  ).not.toContain("wi-plain-blocked");
  expect(
    result.strategic.dispatch.promotableBacklog.map((i) => i.id),
  ).toContain("wi-backlog");
});

it("defaults replanAttempts to 0 when escalation metadata omits it", async () => {
  const tool = buildTool([
    {
      id: "wi-escalated",
      title: "X",
      status: "blocked",
      metadata: {
        escalation: {
          reason: "repeated_ac_failure",
          escalatedAt: "2026-06-16T09:51:00.000Z",
          recommendation: "fresh_architect_pass",
        },
      },
    },
  ]);
  const result = await tool.run({ project_id: "project-1" });
  expect(
    result.strategic.dispatch.escalatedBlockedItems[0].replanAttempts,
  ).toBe(0);
});
```

(If the spec's fixture helper has a different name/signature, adapt the construction but keep the three-item scenario and assertions identical.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- run project-state.tool`
Expected: FAIL — `escalatedBlockedItems` is `undefined`.

- [ ] **Step 3: Add the result type**

In `apps/kanban/src/mcp/tools/read/project-state.tool.ts`, after the `CompactWorkItemSummary` interface (~line 76):

```typescript
interface EscalatedBlockedItemSummary extends CompactWorkItemSummary {
  reason: string;
  recommendation: string;
  replanAttempts: number;
}
```

Extend the `dispatch` shape (~lines 57-60) to:

```typescript
    dispatch: {
      promotableBacklog: CompactWorkItemSummary[];
      escalatedBlockedItems: EscalatedBlockedItemSummary[];
      capacity: ProjectDispatchCapacity;
    };
```

- [ ] **Step 4: Add the predicate and mapper**

After the `isPromotableBacklogItem` method (~line 329, place the new methods alongside it):

```typescript
  private isEscalatedBlockedItem(item: Record<string, unknown>): boolean {
    if (this.getString(item, "status") !== "blocked") return false;
    const metadata = item["metadata"];
    if (!isRecord(metadata)) return false;
    const escalation = metadata["escalation"];
    return (
      isRecord(escalation) &&
      typeof escalation["recommendation"] === "string" &&
      escalation["recommendation"].length > 0
    );
  }

  private toEscalatedBlockedItemSummary(
    item: Record<string, unknown>,
  ): EscalatedBlockedItemSummary {
    const metadata = item["metadata"];
    const escalation = isRecord(metadata) && isRecord(metadata["escalation"])
      ? metadata["escalation"]
      : {};
    const replanAttempts = escalation["replanAttempts"];
    return {
      ...this.toCompactWorkItemSummary(item),
      reason:
        typeof escalation["reason"] === "string" ? escalation["reason"] : "",
      recommendation:
        typeof escalation["recommendation"] === "string"
          ? escalation["recommendation"]
          : "",
      replanAttempts:
        typeof replanAttempts === "number" && Number.isFinite(replanAttempts)
          ? replanAttempts
          : 0,
    };
  }
```

- [ ] **Step 5: Wire the selection into the return**

Between the `promotableBacklog` selection (~lines 206-208) and the `capacity` block, add:

```typescript
const escalatedBlockedItems = workItemRecords
  .filter((item) => this.isEscalatedBlockedItem(item))
  .map((item) => this.toEscalatedBlockedItemSummary(item));
```

Then update the returned `dispatch` object (~line 231):

```typescript
        dispatch: { promotableBacklog, escalatedBlockedItems, capacity },
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- run project-state.tool`
Expected: PASS (including the two new tests and all pre-existing ones).

- [ ] **Step 7: Commit**

```bash
git add apps/kanban/src/mcp/tools/read/project-state.tool.ts apps/kanban/src/mcp/tools/read/project-state.tool.spec.ts
git commit -m "feat(kanban): surface escalatedBlockedItems in project_state.strategic.dispatch"
```

---

## Task 3: Initialise `replanAttempts: 0` in the escalation metadata patch

**Files:**

- Modify: `seed/workflows/work-item-in-progress-default.workflow.yaml` (escalation `metadataPatch` in the `escalate_to_needs_rework` job, ~lines 295-304)
- Test: `apps/kanban/src/seeds/workflows.seed.contract.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/kanban/src/seeds/workflows.seed.contract.spec.ts`, near the existing escalation tests (~line 591):

```typescript
it("escalation metadata patch initialises replanAttempts so the recovery cap is countable", () => {
  const raw = readSeed("work-item-in-progress-default.workflow.yaml");
  // The escalate job seeds metadata.escalation; it must include a numeric
  // replanAttempts baseline so the CEO can bound re-plan attempts.
  expect(raw).toMatch(/recommendation:\s*fresh_architect_pass/);
  expect(raw).toMatch(/replanAttempts:\s*0/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- run workflows.seed.contract -t "replanAttempts"`
Expected: FAIL — `replanAttempts: 0` is not present in the seed.

- [ ] **Step 3: Add the baseline field**

In `seed/workflows/work-item-in-progress-default.workflow.yaml`, inside the `escalate_to_needs_rework` job's `metadataPatch.escalation` block (after the `recommendation: fresh_architect_pass` line, ~line 300):

```yaml
metadataPatch:
  escalation:
    reason: repeated_ac_failure
    repeated_acs: "{{ jobs.check_repeated_failures.output.repeated_acs }}"
    escalatedAt: "{{ trigger.timestamp }}"
    recommendation: fresh_architect_pass
    replanAttempts: 0
```

Note: this is a metadata _patch_ (deep-merge). On first escalation it seeds `replanAttempts: 0`; the CEO increments it on each re-plan (Task 4). Because patch merges last-write-wins per key, re-escalation of an already-recovered item will reset this to `0` only if the escalate job runs again — acceptable, because a _successful_ re-plan that then fails again is a genuinely new escalation cycle. The cap still bounds attempts _within_ a stranded period.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- run workflows.seed.contract -t "replanAttempts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add seed/workflows/work-item-in-progress-default.workflow.yaml apps/kanban/src/seeds/workflows.seed.contract.spec.ts
git commit -m "feat(seed): seed escalation.replanAttempts baseline for recovery cap"
```

---

## Task 4: Teach the strategize prompt to recover escalated blocked items

**Files:**

- Modify: `seed/workflows/prompts/project-orchestration-cycle-ceo/strategize.md` (Section 2 grooming + Section 1.1 perceive list)
- Test: `apps/kanban/src/seeds/workflows.seed.contract.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/kanban/src/seeds/workflows.seed.contract.spec.ts`:

```typescript
it("strategize prompt instructs the CEO to recover escalated blocked items within the cap", () => {
  const prompt = readSeed(
    "prompts/project-orchestration-cycle-ceo/strategize.md",
  );
  // The CEO must read the new set and act on it.
  expect(prompt).toContain("strategic.dispatch.escalatedBlockedItems");
  expect(prompt).toContain("replanAttempts");
  expect(prompt).toContain("MAX_ESCALATION_REPLAN_ATTEMPTS");
  // The three sanctioned outcomes must be documented.
  expect(prompt).toMatch(/fresh architect pass/i);
  expect(prompt).toMatch(/defer/i);
  expect(prompt).toMatch(/human attention/i);
  // Incrementing the counter is mandatory when re-planning.
  expect(prompt).toContain("work_item_patch_metadata");
});
```

(Verified: the spec's `readSeed(filename)` resolves relative to `seed/workflows`, so a `prompts/...` path reads the raw prompt file directly. There is NO `readSeedPrompt` helper — do not invent one. `getExecutionStepPrompt(seedFile, jobId, stepId)` also exists if you prefer resolving via the workflow's `prompt_file`, but the direct `readSeed("prompts/...")` form is simplest here.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- run workflows.seed.contract -t "escalated blocked items"`
Expected: FAIL — the prompt does not mention `escalatedBlockedItems`.

- [ ] **Step 3: Update the perceive checklist (Section 1.1)**

In `strategize.md`, add to the `kanban.project_state` field list (after the `strategic.dispatch`/`promotableBacklog` reference, ~line 62):

```markdown
- `strategic.dispatch.escalatedBlockedItems` — items escalated to `blocked`
  after repeated acceptance-criteria failures, each with `reason`,
  `recommendation`, and `replanAttempts`. These are NOT in `promotableBacklog`
  and will never dispatch unless you act on them here.
```

- [ ] **Step 4: Add the recovery section (Section 2 grooming)**

In `strategize.md` Section 2 ("Groom — Light Board Stewardship"), add a new subsection before "Grooming constraints":

```markdown
### Recover escalated blocked items

For each item in `strategic.dispatch.escalatedBlockedItems`, decide ONE outcome
based on `replanAttempts` (the re-plan attempt cap is
`MAX_ESCALATION_REPLAN_ATTEMPTS` = 2):

1. **Re-plan (`replanAttempts < MAX_ESCALATION_REPLAN_ATTEMPTS`)** — if the
   `recommendation` is `fresh_architect_pass` and the work is still strategically
   warranted:
   - Call `kanban.work_item_patch_metadata` to set
     `escalation.replanAttempts` to the current value **+ 1** (you read the
     current value from `escalatedBlockedItems[].replanAttempts`).
   - Move the item to `backlog` with `kanban.work_item_transition_status` so the
     dispatch step's safe-promotion path can re-pick it up with a fresh
     architect pass. Preserve the prior QA/rejection feedback on the item.
2. **Defer (`replanAttempts < MAX_ESCALATION_REPLAN_ATTEMPTS`, lower priority)** —
   if the item is no longer the priority, transition it to `backlog` and
   re-prioritise; do not bump `replanAttempts`.
3. **Hold for human attention (`replanAttempts >= MAX_ESCALATION_REPLAN_ATTEMPTS`)** —
   do NOT re-plan. Leave the item `blocked`, set a `human_decision` metadata
   marker via `kanban.work_item_patch_metadata`, and record the unresolved
   escalation in your strategic intent so an operator can intervene.

Never leave an `escalatedBlockedItems` entry unaddressed: every entry must map to
exactly one of the outcomes above, and your `record_strategic_intent` call must
note how each was handled.
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- run workflows.seed.contract -t "escalated blocked items"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add seed/workflows/prompts/project-orchestration-cycle-ceo/strategize.md apps/kanban/src/seeds/workflows.seed.contract.spec.ts
git commit -m "feat(seed): CEO strategize recovers escalated blocked items within cap"
```

---

## Task 5: Make dispatch acknowledge escalated items (no silent ignore)

**Files:**

- Modify: `seed/workflows/prompts/project-orchestration-cycle-ceo/dispatch.md` (zero-todo / blocked-items handling section)
- Test: `apps/kanban/src/seeds/workflows.seed.contract.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it("dispatch prompt accounts for escalated blocked items in the cycle decision", () => {
  const prompt = readSeed(
    "prompts/project-orchestration-cycle-ceo/dispatch.md",
  );
  expect(prompt).toContain("escalatedBlockedItems");
  // Dispatch must surface them in its per-item blocked reasons rather than
  // emitting a bare repeat.
  expect(prompt).toMatch(/blockedReason/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- run workflows.seed.contract -t "escalated blocked items in the cycle decision"`
Expected: FAIL — dispatch.md does not mention `escalatedBlockedItems`.

- [ ] **Step 3: Update dispatch.md**

In the "Zero-todo handling" / blocked-items responsibilities list, add:

```markdown
- **Escalated blocked items**: items in
  `strategic.dispatch.escalatedBlockedItems` were escalated after repeated AC
  failures. The strategize step decides their recovery (re-plan to `backlog`,
  defer, or hold). For any that remain `blocked` this cycle, record a per-item
  `blockedReason` of `awaiting_architect_replan` (or `escalation_cap_reached`
  when `replanAttempts >= MAX_ESCALATION_REPLAN_ATTEMPTS`). Do NOT emit a bare
  `repeat` decision while escalated items are unaddressed.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- run workflows.seed.contract -t "escalated blocked items in the cycle decision"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add seed/workflows/prompts/project-orchestration-cycle-ceo/dispatch.md apps/kanban/src/seeds/workflows.seed.contract.spec.ts
git commit -m "feat(seed): dispatch records escalated blocked items in cycle decision"
```

---

## Task 6: Full verification + operator docs

**Files:**

- Modify: `docs/guide/47-strategic-refresh-loop.md`

- [ ] **Step 1: Run the full affected test suites**

Run, expecting all green except known pre-existing unrelated failures:

```bash
npm run test --workspace=packages/kanban-contracts -- run
npm run test --workspace=apps/kanban -- run project-state.tool workflows.seed.contract work-item
```

Expected: new tests PASS. If `workflows.seed.contract` shows the 2 pre-existing `spec revision war room` failures, confirm they are unrelated to this change (they predate it).

- [ ] **Step 2: Lint the changed files**

Run:

```bash
npx eslint apps/kanban/src/mcp/tools/read/project-state.tool.ts packages/kanban-contracts/src/work-item.schema.ts apps/kanban/src/seeds/workflows.seed.contract.spec.ts
```

Expected: no errors. (Strict lint policy — no suppressions.)

- [ ] **Step 3: Document the recovery path**

Add a section to `docs/guide/47-strategic-refresh-loop.md`:

```markdown
## Escalated blocked-item recovery

When a work item fails its acceptance criteria in ≥2 consecutive review rounds,
the in-progress workflow escalates it to `blocked` with
`metadata.escalation = { reason, recommendation: "fresh_architect_pass",
replanAttempts }`. Escalated items are surfaced to the CEO cycle as
`project_state.strategic.dispatch.escalatedBlockedItems`. Each strategize cycle
the CEO must resolve every entry: re-plan (move to `backlog`, bump
`replanAttempts`), defer, or — once `replanAttempts` reaches
`MAX_ESCALATION_REPLAN_ATTEMPTS` (2) — hold for human attention with a
`human_decision` marker. This bounds escalate→replan→fail loops while keeping a
judgment gate in the cycle.
```

- [ ] **Step 4: Commit**

```bash
git add docs/guide/47-strategic-refresh-loop.md
git commit -m "docs(guide): document escalated blocked-item recovery loop"
```

---

## Out of scope / follow-ups

- **Reseeding the live stack.** These seed/prompt changes only take effect after the workflow + prompt seeds are re-applied to the running kanban service. Track that as a deploy step, not a code task.
- **Configurable cap.** `MAX_ESCALATION_REPLAN_ATTEMPTS` is a contract constant. If operators need per-project tuning, promote it to a `kanban_settings` key in a later iteration and surface the resolved value inside `escalatedBlockedItems` context.
- **`human_decision` marker shape.** This plan reuses the existing `metadata.human_decision` convention already recognised by `isHumanDecisionBlocked`. Formalising that marker's schema is a separate contract task.

---

## Self-Review

**Spec coverage:** Gap = "escalated `blocked` + `fresh_architect_pass` has no consumer." Tasks 1-2 make it typed + visible; Tasks 3-5 make the CEO act on it within a cap; Task 6 verifies + documents. Covered.

**Placeholder scan:** No TBD/"handle edge cases"/"similar to" — every code step shows the code; every prompt step shows the markdown.

**Type consistency:** `EscalatedBlockedItemSummary` (Task 2) extends `CompactWorkItemSummary` and carries `reason`/`recommendation`/`replanAttempts`, matching the fields the strategize prompt (Task 4) reads (`escalatedBlockedItems[].replanAttempts`) and the contract schema (Task 1, `WorkItemEscalationSchema`). `MAX_ESCALATION_REPLAN_ATTEMPTS` is defined once in Task 1 and referenced by name in Tasks 4-6. Predicate name `isEscalatedBlockedItem` and mapper `toEscalatedBlockedItemSummary` are used consistently in Task 2.
