# Strategic Refresh Loop — Detailed Design

**Date:** 2026-06-12
**Epic:** EPIC-208 (`docs/epics/EPIC-208-ceo-driven-strategic-refresh-loop.md`)
**Status:** Draft for review

This is the implementation-level companion to EPIC-208. The epic holds the _why_ and the
phase map; this doc holds the data model, tool contracts, prompt structure, event wiring,
and per-phase test plan.

---

## 0. Problem recap (one paragraph)

The orchestration cycle executes a known backlog well but never _replenishes strategy_.
Discovery is one-time (no cron, guarded against re-run), ideation is an empty-board rescue
that emits 1–3 items and dedups against a stale capability map, and the charter is injected
into **zero** runtime prompts. There is no planning altitude between flat `goals` and flat
`work_items`, and no durable thread of the CEO's own forward-looking intent. The fix is a
**two-phase CEO cycle** — a guaranteed _Strategize_ beat before the existing _Dispatch_ beat —
fed by **staleness awareness**, backed by a structured **initiative** layer, and kept turning
by a **merge heartbeat**.

---

## 1. Architecture overview

```
WorkItemMergeCompletedEvent ──┐
human "review now" trigger  ──┤
specs-ready / generation done ┴──▶ ProjectOrchestrationCycleRequestedEvent
                                          │  (max_runs:1, scope, on_conflict:skip)
                                          ▼
                        ┌──────────────────────────────────────────┐
                        │  project-orchestration-cycle-ceo  (job)   │
                        │                                           │
                        │  Step 1: strategize  ──┐                  │
                        │    • load staleness + charter +           │
                        │      initiatives + prior intent + timeline│
                        │    • delegate specialist passes (await) ──┼──▶ delegate_rediscovery
                        │    • light grooming (reprioritise/defer/   │   delegate_roadmap_planning
                        │      split/link work↔initiative)          │   delegate_charter_refinement
                        │    • adjust initiatives & charter         │   delegate_goal_backlog_planning
                        │    • record_strategic_intent              │
                        │                        ▼                  │
                        │  Step 2: dispatch  (existing decide.md)   │
                        │    • promote backlog→todo, lifecycle-start │
                        │    • complete_orchestration_cycle_decision │
                        └──────────────────────────────────────────┘
```

Same `ceo-agent`, same job, two steps sharing one agent session. Step 1's `set_job_output`
hands a groomed-board summary to Step 2.

---

## 2. Data model (kanban-side)

All new persistence is **project-domain** and lives in `apps/kanban` with contracts in
`packages/kanban-contracts`. Follow the `adding-entity-migration` skill (domain-local
entity + repository + DatabaseModule registration + migration).

### 2.1 `kanban_initiatives`

| Column                      | Type                                           | Notes                              |
| --------------------------- | ---------------------------------------------- | ---------------------------------- |
| `id`                        | uuid PK                                        |                                    |
| `scope_id`                  | text, indexed                                  | project scope                      |
| `title`                     | text                                           |                                    |
| `description`               | text nullable                                  |                                    |
| `horizon`                   | enum `now\|next\|later`                        | the roadmap bucket                 |
| `priority`                  | int, default 0                                 | within-horizon ordering            |
| `status`                    | enum `proposed\|active\|paused\|done\|dropped` |                                    |
| `last_reviewed_at`          | timestamptz nullable                           | set by roadmap-planning / grooming |
| `created_at` / `updated_at` | timestamptz                                    |                                    |

### 2.2 `kanban_initiative_goals` (join, many-to-many)

`initiative_id` (FK → `kanban_initiatives`), `goal_id` (FK → `kanban_project_goals`),
composite PK. **Decision:** join table over a `goal_ids` array — an initiative can advance
several goals and a goal spans initiatives; the join keeps queries (and goal-deletion
integrity) clean.

### 2.3 `work_items.initiative_id`

Nullable FK → `kanban_initiatives`. A work item belongs to **at most one** initiative.
`ON DELETE SET NULL` so dropping an initiative doesn't cascade-delete delivered work.

### 2.4 Strategic intent (continuity)

**Decision:** reuse the **orchestration timeline** rather than a new table — `decide.md`
already states it is "the source of truth for persistent session state," and the Strategize
step already loads it. Add a timeline entry kind `strategic_intent` with payload:

```jsonc
{
  "kind": "strategic_intent",
  "focus_initiative_id": "…", // the "now" initiative this cycle bet on
  "rationale": "…", // why this is the focus
  "planned_next_steps": ["…", "…"], // what the CEO intends next cycle
  "staleness_actions": ["delegated rediscovery: 14 merges since scan"],
  "created_at": "…",
}
```

The latest `strategic_intent` is surfaced in `project_state` (see §3) so Step 1 reads "what
was I planning" without scanning the full timeline.

---

## 3. `kanban.project_state` — strategic block

Extend the existing read tool (do **not** add a parallel `strategic_state` tool — keep one
state read). New top-level `strategic` object:

```jsonc
{
  // …existing fields (todo_count, backlog_count, dispatchableTodoCount, …)…
  "strategic": {
    "staleness": {
      "lastDiscoveryAt": "…",
      "mergesSinceDiscovery": 14,
      "commitsSinceDiscovery": 122,
      "lastCharterUpdateAt": "…",
      "lastInitiativeReviewAt": "…",
      "lastWorkItemCreatedAt": "…",
      "backlogDepth": 6,
      "recentBurnRatePerCycle": 2.3, // completed items / recent cycles
      "starvationForecastCycles": 2.6, // backlogDepth / burnRate
    },
    "latestStrategicIntent": {
      /* §2.4 payload or null */
    },
    "initiatives": [
      {
        "id": "…",
        "title": "…",
        "horizon": "now",
        "priority": 0,
        "status": "active",
        "goalIds": ["…"],
        "openWorkItemCount": 3,
        "lastReviewedAt": "…",
      },
    ],
  },
}
```

**`lastDiscoveryAt` source:** discovery completion must stamp it. Add a small project
orchestration-state field (or reuse an existing project metadata row) written when
`project-codebase-deep-investigation` finalizes. `mergesSinceDiscovery` is a count of
`WorkItemMergeCompletedEvent` (or merge-status transitions) with timestamp `> lastDiscoveryAt`.

---

## 4. Kanban MCP tools (new)

Mirror the existing mutation-tool pattern in `apps/kanban/src/mcp/tools/mutation/`.
Single-responsibility per tool; Zod-validated; **no root `z.union` schema** (DeepSeek 400 —
see memory `manage_todo_list_union_schema_deepseek`). Each mutation enqueues nothing heavy;
roadmap/grooming writes set `last_reviewed_at`.

| Tool                                          | Purpose                                                             |
| --------------------------------------------- | ------------------------------------------------------------------- |
| `kanban.initiative_create`                    | create an initiative (title, horizon, priority, status, goal links) |
| `kanban.initiative_update`                    | patch title/description/horizon/priority                            |
| `kanban.initiative_update_status`             | proposed→active→paused/done/dropped                                 |
| `kanban.initiative_set_priority`              | reorder within horizon (grooming)                                   |
| `kanban.initiative_link_goal` / `unlink_goal` | maintain `kanban_initiative_goals`                                  |
| `kanban.initiative_link_work_item`            | set `work_items.initiative_id` (or extend `work_item_update`)       |
| `kanban.record_strategic_intent`              | append `strategic_intent` timeline entry                            |

**Decision:** `initiative_link_work_item` is a thin dedicated tool rather than overloading
`work_item_update`, to keep the grooming verbs explicit in prompts and traces.

---

## 5. Projected delegation tools (api-side, neutral)

These launch workflows and **durably await** (existing pattern). They must remain
Kanban-neutral — `scope_id`/`scopeId` only, no work-item/initiative domain identifiers in
api/core. Avoid the fire-and-forget pitfall recorded in memory
`ceo_delegate_tools_bypass_await`: each projection MUST route through the durable-await path,
**not** hard-code `invokeAgentWorkflow`, or the parent CEO never awaits the child and the next
cycle runs blind.

| Tool                             | Target workflow                                        | New?                           |
| -------------------------------- | ------------------------------------------------------ | ------------------------------ |
| `delegate_rediscovery`           | `project-codebase-deep-investigation` (mode `refresh`) | new tool, generalized workflow |
| `delegate_roadmap_planning`      | `project-roadmap-planning`                             | new tool + new workflow        |
| `delegate_charter_refinement`    | `project-charter-ceo` (refine mode)                    | new tool, existing workflow    |
| `delegate_goal_backlog_planning` | `project-goal-backlog-planning`                        | exists; prompt updated         |

---

## 6. Prompts

### 6.1 `strategize.md` (new — Step 1)

Structure:

1. **Perceive** — read `project_state.strategic` (staleness + initiatives + latest intent) and
   recent `orchestration_timeline`. Load **charter** (vision / non-goals / success-criteria /
   preferences) via `read docs/project-context/CHARTER.md` + `query_memory`.
2. **Re-think** (the user's sentence, made explicit) — _Did the last few turns move us toward
   the active "now" initiative? What were my prior planned next steps and did they happen?
   Does the current backlog support the "now" horizon? Which signals are stale?_
3. **Decide refresh** — from staleness thresholds, delegate **only what's warranted**:
   - `mergesSinceDiscovery` over threshold → `delegate_rediscovery`
   - charter drift (reality vs. charter) → `delegate_charter_refinement`
   - horizons stale / goals lacking initiatives → `delegate_roadmap_planning`
   - `starvationForecastCycles` below threshold → `delegate_goal_backlog_planning`
     Await each; synthesize results.
4. **Groom directly** — re-prioritise, defer, split, link work↔initiative (no research).
5. **Record** — `record_strategic_intent` with focus, rationale, planned next steps.
6. **Hand off** — `set_job_output` summarising the groomed board for Dispatch.

Thresholds are constants in the prompt (named, not magic) and tunable; start conservative
to control token cost.

### 6.2 `decide.md` (Step 2 — slimmed)

Keep the proven **zero-todo promotion mandate** and lifecycle-start logic. Remove any
implicit "should I ideate?" branching that now lives in Strategize; Dispatch trusts the
groomed board. The "idle board is orchestration failure" invariant stays.

### 6.3 `project-roadmap-planning` prompt (new)

Strategist (reuse `product-manager` or a new `product-strategist` profile) that:
reads goals + charter + capability map + existing initiatives → proposes/updates initiatives
with horizons & priorities, links them to goals → sets `last_reviewed_at`. **Does not**
create work items (that's ideation's job — keeps SRP and lets the roadmap be reworked without
backlog churn).

### 6.4 `research-and-ideate.md` (ideation — updated)

Add initiative-awareness: ideate work items **under the active "now" initiative**, set
`initiative_id` on created items, and dedup against the **fresh** capability map (post
re-discovery). Keep the 1–3-item batch contract but allow the CEO to call it repeatedly until
`starvationForecastCycles` recovers.

### 6.5 `ceo-agent/PROMPT.md` (updated)

Add the new delegation tools, the initiative grooming tools, and a short "strategic
responsibilities" section: perceive staleness, maintain the roadmap, keep the backlog ahead of
burn, record intent each cycle. Reaffirm read-only-on-code.

---

## 7. Event wiring — the heartbeat

`WorkItemMergeCompletedEvent → ProjectOrchestrationCycleRequestedEvent`. Research confirmed
this link is **missing** today (the cycle can go quiet after a merge). Add a subscription so
every merge gives the CEO a fresh strategic turn. `max_runs:1` / `on_conflict:skip` on the
cycle already coalesces bursts; verify under rapid-merge load. Plus: human "review now"
trigger (on-demand) and the existing specs-ready / generation-done emitters.

When nothing is in flight and the board is healthy, Dispatch records a `pause`; new work or a
human trigger re-arms the loop. **No cron** — consistent with "entirely CEO-driven."

---

## 8. Phase breakdown & test plan (TDD)

| Phase                          | Deliverables                                                                                                                 | Key tests (red first)                                                                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — Initiative layer**       | entity + join + `initiative_id` FK + migration; kanban tools §4 (minus intent); `project_state.strategic.initiatives`        | entity/repo unit; each tool unit (create/update/status/priority/link); `project_state` returns initiatives                                                              |
| **2 — Staleness + continuity** | `strategic.staleness` computation; `lastDiscoveryAt` stamping; `record_strategic_intent` + `latestStrategicIntent` surfacing | staleness math (merges/commits since, burn rate, starvation forecast); intent round-trips via timeline + project_state                                                  |
| **3 — Two-phase cycle**        | `strategize.md`; slim `decide.md`; cycle workflow gains 2 steps; charter-in-context; merge→cycle wiring                      | workflow-contract: Strategize emits intent + groom job-output; Dispatch behaviour preserved (existing decide tests green); event handler emits cycle-requested on merge |
| **4 — Re-discovery refresh**   | `refresh` mode on investigation workflow (delta-probe scopes changed since `lastDiscoveryAt`); `delegate_rediscovery`        | mode-select routing; delta scope selection; `delegate_rediscovery` resolves + durably awaits (not fire-and-forget)                                                      |
| **5 — Roadmap + ideation**     | `project-roadmap-planning` workflow + prompt + `delegate_roadmap_planning`; initiative-aware ideation                        | roadmap pass creates/updates initiatives & sets `last_reviewed_at`; ideation sets `initiative_id` & dedups vs fresh map                                                 |
| **6 — Charter refinement**     | `delegate_charter_refinement`; drift signals into `strategize.md`                                                            | delegate resolves to refine mode + awaits; drift threshold triggers delegation in a stale-charter fixture                                                               |

**E2E (after Phase 5):** a deterministic kanban e2e seeding a stale board (thin backlog,
`mergesSinceDiscovery` over threshold, no "now" initiative) and asserting one cycle delegates
re-discovery → roadmap planning → ideation, grooms, records intent, then dispatches a promoted
item. Extend the existing deterministic kanban e2e harness.

---

## 9. Boundary checklist (must hold)

- [ ] No `kanban`/work-item/initiative identifiers in `apps/api/src` or `packages/core/src`
      (lint `nexus-boundaries/no-core-kanban-residue`).
- [ ] Delegation tools use neutral `scope_id`/`context_id` only.
- [ ] Initiative entity/tools/intent storage entirely kanban-side.
- [ ] No `eslint-disable` / `@ts-ignore`; no root `z.union` tool schemas.
- [ ] Delegation projections route through durable-await, never `invokeAgentWorkflow`.

---

## 10. Open decisions for review

1. **Strategist profile:** reuse `product-manager` for roadmap planning, or add a distinct
   `product-strategist`? (Default: reuse, to minimise new seed surface.)
2. **Staleness thresholds:** starting values for `mergesSinceDiscovery` and
   `starvationForecastCycles` that trigger delegation. (Default: conservative — discovery at
   ≥10 merges, ideation at <2 cycles of runway.)
3. **Grooming scope per cycle:** cap how many items the CEO re-prioritises/splits per
   Strategize beat to bound token cost? (Default: soft cap in prompt, e.g. top 10 by priority.)
