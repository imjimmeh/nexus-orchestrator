# 47 — CEO-Driven Strategic Refresh Loop (EPIC-208)

This guide is the single operational reference for the CEO-driven strategic refresh loop introduced by EPIC-208. It covers the full end-to-end system: the initiative planning layer, staleness signals, the two-phase CEO cycle, the specialist delegation passes, the merge heartbeat, and how every piece fits together.

For the design spec (data models, ADRs, test plan) see `docs/superpowers/specs/2026-06-12-strategic-refresh-loop-design.md`. For the initiative data model summary and Phase 2 staleness signals already included in the kanban overview, see `docs/guide/README.md` lines 107–241.

---

## 1. Problem and Solution

### 1.1 What the loop solves

Before EPIC-208 the orchestration cycle was a pure execution engine: it dispatched known backlog items well but had no mechanism to replenish strategy. Concretely:

- **Discovery was one-and-done.** There was no trigger to re-investigate the codebase after merges accumulated, so the capability map grew stale.
- **Ideation was reactive.** Backlog planning fired only when the board was empty, and it deduplicated against an old capability map.
- **The charter was never in context.** No runtime prompt loaded the charter, so the CEO operated without its own north-star documentation.
- **No planning altitude.** Goals captured the _why_ and work items captured the _how_, but there was nothing in between to express _what_ to build and _when_ — initiatives as a structured concept did not exist.
- **No durable strategic recall.** Each CEO cycle started cold. There was no record of what the prior cycle intended to do next.

### 1.2 The solution

EPIC-208 adds a continuous two-phase CEO cycle — **Strategize then Dispatch** — that:

1. Loads staleness signals, the charter, initiatives, and the previous strategic intent record before touching the board.
2. Delegates specialist passes (re-discovery, roadmap planning, ideation) only when gating conditions are met, and durably awaits each.
3. Grooms the board (reprioritise, defer, link work to initiatives) during the Strategize step.
4. Records a structured strategic intent so the next cycle can recall what was planned.
5. Hands a groomed-board summary to the Dispatch step so dispatch stays purely tactical.
6. Is kept turning by a merge heartbeat: every merged work item fires a `WorkItemMergeCompletedEvent` that re-requests the cycle.

### 1.3 Full loop diagram

```
WorkItemMergeCompletedEvent ──────────────────────────────────────────┐
human "review now" trigger  ──────────────────────────────────────────┤
specs-ready / generation-done ────────────────────────────────────────┴──▶ ProjectOrchestrationCycleRequestedEvent
                                                                                │  (max_runs:1, scope, on_conflict:skip)
                                                                                ▼
                                              ┌─────────────────────────────────────────────────────────────────┐
                                              │  project-orchestration-cycle-ceo  (workflow)                     │
                                              │                                                                  │
                                              │  Engine gate jobs (condition-gated, run before strategize):      │
                                              │    • load_state        mcp_tool_call → kanban.project_state      │
                                              │    • rediscovery_gate  if mergesSinceDiscovery >= 10             │──▶ specialist workflows
                                              │    • roadmap_planning_gate  if activeNowInitiativeCount == 0     │
                                              │    • ideation_gate     if recentBurnRatePerCycle == 0 or         │
                                              │                           starvationForecastCycles <= 2          │
                                              │                                                                  │
                                              │  Job: strategize ────────────────────────────────────────────┐  │
                                              │    1. Perceive: load project_state.strategic                   │  │
                                              │       (staleness + initiatives + latestStrategicIntent)        │  │
                                              │       + charter + orchestration timeline                       │  │
                                              │    2. Light grooming: reprioritise, defer, split, link         │  │
                                              │       (specialist passes already ran before this step)         │  │
                                              │    3. record_strategic_intent                                  │  │
                                              │    4. set_job_output (groomed_board_summary)                   │  │
                                              │                                       ▼                        │  │
                                              │  Job: promote_safe_backlog (engine, mcp_tool_call)             │  │
                                              │    • Fires while todo_count < target_todo_depth and auto mode  │  │
                                              │    • for_each promotion_candidate → work_item_transition_status│  │
                                              │      to todo (structural guarantee, no agent judgement needed) │  │
                                              │                                       ▼                        │  │
                                              │  Job: dispatch ──────────────────────────────────────────────┘  │
                                              │    • Re-read project_state (post-promotion board)                │
                                              │    • Lifecycle-start dispatchable todo items                     │
                                              │    • Patch-and-promote fixable blockers; record blocked items    │
                                              │    • complete_orchestration_cycle_decision                       │
                                              └─────────────────────────────────────────────────────────────────┘
                                                                                │
                                                              item merges ──────┘  (heartbeat loops back)
```

| Phase   | Component                                    | Purpose                                        |
| ------- | -------------------------------------------- | ---------------------------------------------- |
| Phase 1 | Initiative layer                             | Planning altitude between goals and work items |
| Phase 2 | Staleness signals + strategic intent         | CEO world-model freshness + cross-cycle recall |
| Phase 3 | Two-phase cycle + merge heartbeat            | Structurally unskippable Strategize beat       |
| Phase 4 | Rediscovery refresh mode                     | Delta-aware capability map refresh             |
| Phase 5 | Roadmap planning + initiative-aware ideation | Initiative creation and backlog scoping        |

---

## 2. The Initiative Layer (Phase 1)

### 2.1 Planning altitude

Initiatives are the planning altitude that sits between goals and work items:

| Level     | Entity                             | Answers                                       |
| --------- | ---------------------------------- | --------------------------------------------- |
| Strategic | Goals (`kanban_project_goals`)     | _Why_ — the outcome we want                   |
| Tactical  | Initiatives (`kanban_initiatives`) | _What_ and _when_ — the coherent body of work |
| Execution | Work items (`kanban_work_items`)   | _How_ — the individual deliverables           |

Without initiatives, the CEO can only see atomic work items and abstract goals — no medium-term container to express "we are building the authentication system this sprint, then the billing system next." The initiative layer makes that explicit and machine-readable.

### 2.2 Data model

**`kanban_initiatives`**

| Column                      | Type                                           | Notes                                             |
| --------------------------- | ---------------------------------------------- | ------------------------------------------------- |
| `id`                        | uuid PK                                        |                                                   |
| `scope_id`                  | text, indexed                                  | Project scope                                     |
| `title`                     | text                                           |                                                   |
| `description`               | text nullable                                  |                                                   |
| `horizon`                   | enum `now\|next\|later`                        | Roadmap time-bucket                               |
| `priority`                  | int, default 0                                 | Within-horizon ordering (lower = higher priority) |
| `status`                    | enum `proposed\|active\|paused\|done\|dropped` |                                                   |
| `last_reviewed_at`          | timestamptz nullable                           | Stamped by roadmap planning and grooming          |
| `created_at` / `updated_at` | timestamptz                                    |                                                   |

**`kanban_initiative_goals`** (join table, many-to-many)

`initiative_id` (FK → `kanban_initiatives`) and `goal_id` (FK → `kanban_project_goals`), composite PK. A join table rather than an array column keeps goal-deletion integrity clean and allows an initiative to advance multiple goals and a goal to span multiple initiatives.

**`kanban_work_items.initiative_id`**

Nullable FK → `kanban_initiatives`. A work item belongs to at most one initiative. `ON DELETE SET NULL` ensures that dropping an initiative does not cascade-delete delivered work.

### 2.3 Horizon semantics

| Horizon | Meaning                                                     |
| ------- | ----------------------------------------------------------- |
| `now`   | Active sprint focus — what the team is building this period |
| `next`  | Planned for the next sprint or planning cycle               |
| `later` | Future backlog — valuable but not yet scheduled             |

The CEO's grooming and ideation logic is horizon-aware: ideation scopes to the active `now` initiative, and roadmap planning is triggered when no `now`-horizon initiative is active or when horizons are stale.

### 2.4 Status lifecycle

```
proposed ──▶ active ──▶ paused ──▶ done
                  └──────────────▶ dropped
```

- `proposed`: Created but not yet committed to a horizon.
- `active`: Actively being worked; the `now` initiative should be `active`.
- `paused`: Temporarily suspended (waiting on dependency, deprioritised mid-cycle).
- `done`: All constituent work items delivered.
- `dropped`: Abandoned; no longer relevant.

### 2.5 MCP tools

All initiative tools live in `apps/kanban/src/mcp/tools/mutation/` and are exposed via the kanban MCP server. No root `z.union` schema (see memory note on DeepSeek 400 errors).

| Tool                                          | Purpose                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `kanban.initiative_create`                    | Create a new initiative with title, horizon, priority, status, and optional goal links                  |
| `kanban.initiative_update`                    | Patch title, description, horizon, or priority                                                          |
| `kanban.initiative_update_status`             | Transition status through the allowed lifecycle                                                         |
| `kanban.initiative_set_priority`              | Re-order within horizon; stamps `last_reviewed_at`                                                      |
| `kanban.initiative_link_goal` / `unlink_goal` | Maintain the `kanban_initiative_goals` join                                                             |
| `kanban.initiative_link_work_item`            | Set or clear `work_items.initiative_id` (a thin dedicated verb, not overloaded onto `work_item_update`) |

### 2.6 How initiatives surface in project state

Initiatives appear in `kanban.project_state` under `strategic.initiatives`:

```jsonc
{
  "strategic": {
    "initiatives": [
      {
        "id": "init-abc123",
        "title": "Authentication System",
        "horizon": "now",
        "priority": 0,
        "status": "active",
        "goalIds": ["goal-xyz"],
        "openWorkItemCount": 3,
        "lastReviewedAt": "2026-06-13T01:00:00.000Z",
      },
    ],
  },
}
```

The CEO reads this during the Perceive section of every Strategize step to understand what the current plan is and how stale it is.

---

## 3. Two-Phase CEO Cycle: Strategize → Dispatch (Phase 3)

### 3.1 Why the split exists

Before Phase 3, the CEO cycle had a single job (`decide.md`) that was supposed to handle both strategic reflection and tactical dispatch. In practice, the strategic beat was skippable — the CEO could go straight from reading board state to dispatching work without checking staleness, updating initiatives, or recording intent. The split makes the strategic beat structurally mandatory: Dispatch is a separate job that `depends_on: [strategize]` and receives the groomed board from Job 1's output. Dispatch cannot start until Strategize completes and writes `groomed_board_summary`.

### 3.2 Workflow structure

`seed/workflows/project-orchestration-cycle-ceo.workflow.yaml` defines two jobs in one workflow:

```yaml
jobs:
  - id: strategize
    type: execution
    tier: heavy
    output_contract:
      required: [groomed_board_summary]
    steps:
      - id: strategize
        prompt_file: prompts/project-orchestration-cycle-ceo/strategize.md

  - id: dispatch
    type: execution
    tier: heavy
    depends_on: [strategize]
    inputs:
      groomed_board_summary: "{{ jobs.strategize.output.groomed_board_summary }}"
    steps:
      - id: dispatch
        prompt_file: prompts/project-orchestration-cycle-ceo/dispatch.md
```

Both jobs share the same `ceo-agent` profile and the same workflow execution scope. The `output_contract` on the strategize job enforces that `groomed_board_summary` is written before the job terminates — a missing output is a contract violation that surfaces as a failed job, not a silent skip.

### 3.3 The Strategize step (Job 1)

Prompt file: `seed/workflows/prompts/project-orchestration-cycle-ceo/strategize.md`

The Strategize step runs in four sections:

**Section 1 — Perceive**

Load all context before making any decisions:

1. Call `kanban.project_state` and read the full `strategic` block (staleness + initiatives + latest intent), plus board counts (`todo_count`, `backlog_count`, `dispatchableTodoCount`, `linkedRunCount`, `autonomous_mode`).
2. Read `docs/project-context/CHARTER.md` via the `read` tool with `missing_ok: true`. If present, it informs all grooming decisions and initiative alignment.
3. Call `query_memory` for relevant strategic notes, past blockers, and escalation history.
4. Call `kanban.orchestration_timeline` for deep cycle history, outstanding blockers, and `dispatch_capacity` (defaults to the most-recent ~20 decisions, full count in `diagnostics.decisionCount`; pass `limit`/`offset` to page deeper). For a routine "what happened recently" check, prefer the lightweight `kanban.orchestration_activity` feed (`{ totalActionCount, recent[] }`, `limit` default 5/max 50) instead.

**Staleness checks (engine-evaluated, before Perceive)**

The three specialist gates are now evaluated **deterministically by the workflow engine** as `condition`-gated `invoke_workflow` jobs that run before the Strategize step. The engine uses the new `gte`/`lte` Handlebars helpers over raw `strategic.staleness` signals read via a preceding `mcp_tool_call` job (`load_state`). The three gate expressions are:

- **re-discovery** — `mergesSinceDiscovery >= 10` (maps to `REDISCOVERY_MERGE_THRESHOLD` in `@nexus/kanban-contracts`)
- **roadmap planning** — `activeNowInitiativeCount == 0` (no active `now`-horizon initiative)
- **ideation** — `recentBurnRatePerCycle == 0` OR `starvationForecastCycles <= 2` (maps to `IDEATION_STARVATION_THRESHOLD_CYCLES` in `@nexus/kanban-contracts`)

Each gate fires its specialist workflow and durably awaits it before the Strategize step starts. Order is fixed by `depends_on` in the YAML: rediscovery → roadmap planning → ideation → strategize. By the time the Strategize step's agent turn begins, the board already reflects the results of every warranted pass.

The Strategize agent does **not** re-evaluate these thresholds. If the agent's judgement — informed by the charter, the timeline, and the latest strategic intent — indicates a pass is warranted even though its gate did not fire, it may call the matching `delegate_*` tool itself; it durably awaits. This override should be used sparingly with rationale recorded in the strategic intent.

**Section 2 — Groom**

With strategic context loaded (and any delegations complete), perform light board stewardship. The CEO must NOT lifecycle-start work items in this step — that is reserved for Dispatch.

Permitted operations:

- **Re-prioritise** work items via `kanban.work_item_update` when priorities are misaligned with charter goals or active initiatives.
- **Defer** blocked, out-of-scope, or superseded items via `kanban.work_item_transition_status` (move to `backlog`).
- **Split** oversized items into smaller deliverables.
- **Link** work items to initiatives via `kanban.initiative_link_work_item`.

Grooming constraints: do not create new work items, do not start or dispatch work items, keep changes minimal (re-groom only when staleness warrants it, soft cap around top 10 items by priority).

**Section 3 — Record strategic intent**

Call `kanban.record_strategic_intent` exactly once after grooming. The record must capture:

- The board's current strategic direction relative to the charter.
- Grooming changes made and the rationale.
- Priority ordering of initiatives for Dispatch to act on.
- Any systemic blockers or escalation notes.

This call is mandatory on every cycle, even when no grooming was performed. The intent record is the durable handoff artifact to Dispatch and to future cycles.

**Section 4 — Hand off**

Call `set_job_output` with the `groomed_board_summary` object:

```json
{
  "groomed_board_summary": {
    "todo_count": 0,
    "backlog_count": 5,
    "linkedRunCount": 1,
    "dispatchableTodoCount": 0,
    "autonomous_mode": true,
    "promotion_candidates": [
      {
        "workItemId": "<uuid>",
        "title": "Implement login endpoint",
        "priority": 1,
        "initiativeId": "init-abc123"
      }
    ],
    "strategic_intent": "Focus on authentication initiative; 3 items linked, 1 awaiting promotion.",
    "groomed_changes": [
      {
        "workItemId": "<uuid>",
        "change": "Linked to authentication initiative (init-abc123); priority adjusted to 1."
      }
    ]
  }
}
```

Then call `step_complete` to hand control to Job 2.

### 3.4 The Dispatch step (Job 2)

Prompt file: `seed/workflows/prompts/project-orchestration-cycle-ceo/dispatch.md`

Between Strategize and Dispatch, the engine runs a deterministic `promote_safe_backlog` job (Phase 5). This job iterates over `groomed_board_summary.promotion_candidates` (drawn from `kanban.project_state.strategic.dispatch.promotableBacklog`) and calls `kanban.work_item_transition_status` to `todo` for each candidate. It fires whenever `todo_count < vars.backlog.target_todo_depth` (default 3) and `autonomous_mode == true` — so the engine keeps a shallow ready buffer of todo work groomed rather than only back-filling once the queue hits exactly zero. Strategize sizes `promotion_candidates` to top the queue back up to the target depth. The promotion is structural and happens before the Dispatch agent turn begins.

A backstop remains in the workflow's `output_contract.forbidden`: a bare `repeat` when `todo_count == 0` and `backlog_count > 0` and `blockedItems == null` is still a contract violation. This catches the edge case where the engine job skipped (condition false) and the agent also failed to act.

Dispatch reads `{{ inputs.groomed_board_summary }}` (passed from `jobs.strategize.output.groomed_board_summary`) and operates purely tactically. It re-reads `kanban.project_state` to see the post-promotion board state.

**Dispatch responsibilities:**

1. Re-read `kanban.project_state` to observe the board after engine promotion.
2. **Lifecycle-start** dispatchable `todo` items via `kanban.work_item_transition_status` (`status: "in-progress"`) — starting as many as fit `strategic.dispatch.capacity.availableSlots`. A free slot is never held in reserve: the mandate fires on `availableSlots > 0` even when other runs are already active (`linkedRunCount > 0`), because `maxActive` is typically greater than 1. Capacity is read from `availableSlots`, never inferred from `linkedRunCount`.
3. **Patch-and-promote** any backlog item the engine could not auto-promote because of a fixable execution-config blocker (`kanban.work_item_patch_execution_config`, then transition to `todo`).
4. **Restart** stale executions via `kanban.work_item_restart_execution` for items in an automation status with no linked run.
5. For items that remain genuinely blocked, record per-item `blockedReason` in the decision `reason` (the `blockedItems` array).
6. Call `kanban.complete_orchestration_cycle_decision` with `decision`, `reason`, and `idempotency_key`.
7. Call `step_complete` only after the decision tool succeeds.

Dispatch does not evaluate strategic staleness gates, delegate specialist passes, update initiatives, or record strategic intent — all of that belongs to Strategize.

### 3.5 Session state sharing between steps

Both jobs receive the same `agent_profile: ceo-agent` and run within the same workflow execution scope. Job 1 writes `groomed_board_summary` via `set_job_output`; the workflow engine passes it to Job 2 as `{{ jobs.strategize.output.groomed_board_summary }}`. This is not in-memory sharing — the output is persisted in the job output record, so Job 2 can access it even if it runs on a different runner instance.

---

## 4. Staleness Signals and Decision Thresholds (Phase 2)

### 4.1 How staleness is computed

`ProjectStrategicStateService` computes all staleness fields at read time from the orchestration record and work-item rows. There is no separate write step — the signals update automatically as the project evolves. The full staleness block is returned as `strategic.staleness` inside `kanban.project_state`.

### 4.2 Staleness fields

| Field                      | Source                                                                                                      | When it updates                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `lastDiscoveryAt`          | `kanban_orchestrations.metadata["last_discovery_at"]`; written by `kanban.record_discovery_completed`       | When a discovery cycle completes and stamps itself                      |
| `mergesSinceDiscovery`     | Count of work items in `ready-to-merge` or `done` with `updated_at > lastDiscoveryAt`                       | On every work item status transition                                    |
| `commitsSinceDiscovery`    | Always `null` in Phase 2; placeholder for future Git integration                                            | N/A                                                                     |
| `lastCharterUpdateAt`      | `kanban_orchestrations.metadata["last_charter_update_at"]`; written when the CEO persists charter knowledge | When the charter-capture workflow persists structured project knowledge |
| `lastInitiativeReviewAt`   | Max `last_reviewed_at` across all initiatives on the project                                                | Stamped by `kanban.initiative_set_priority` and roadmap planning        |
| `lastWorkItemCreatedAt`    | Max `created_at` across all work items                                                                      | On every new work item creation                                         |
| `backlogDepth`             | Count of work items with `status = "backlog"`                                                               | On every status transition                                              |
| `recentBurnRatePerCycle`   | Completed items / recent orchestration cycles, averaged over the last 10 decision-log entries               | On every completed cycle                                                |
| `starvationForecastCycles` | `backlogDepth / recentBurnRatePerCycle`; null when burn rate is zero                                        | Derived from the two fields above                                       |

`starvationForecastCycles` is the most actionable signal: it tells the CEO "the backlog will be exhausted in N cycles." A value of `null` (zero burn rate) means the project is new or stalled — treat it as requiring ideation.

### 4.3 Decision thresholds

Two named constants, exported from `packages/kanban-contracts/src/strategic.schema.ts`:

| Constant                               | Value | Trigger                                                            |
| -------------------------------------- | ----- | ------------------------------------------------------------------ |
| `REDISCOVERY_MERGE_THRESHOLD`          | `10`  | `mergesSinceDiscovery >= 10` → `delegate_rediscovery`              |
| `IDEATION_STARVATION_THRESHOLD_CYCLES` | `2`   | `starvationForecastCycles <= 2` → `delegate_goal_backlog_planning` |

These are conservative starting values chosen to control token cost. They are named constants in the prompt (not magic numbers), so operators can tune them by editing the constants in the prompt file.

### 4.4 Strategic intent continuity

At the end of each Strategize step the CEO calls `kanban.record_strategic_intent`. This appends a `strategic_intent` entry to the orchestration decision log:

```json
{
  "kind": "strategic_intent",
  "focus_initiative_id": "init-abc123",
  "rationale": "Authentication initiative is 80% complete; finishing it unblocks the billing horizon.",
  "planned_next_steps": [
    "Review open PRs on auth service",
    "Promote two backlog items linked to init-abc123"
  ],
  "staleness_actions": ["delegated rediscovery: 14 merges since scan"],
  "created_at": "2026-06-13T01:00:00.000Z"
}
```

The most recent `strategic_intent` entry is surfaced as `strategic.latestStrategicIntent` in `kanban.project_state`, so the next CEO cycle can read "what was I planning" without scanning the full timeline. This gives the CEO durable cross-cycle recall without relying on in-context memory.

---

## 5. Specialist Delegation Passes (Phases 3–5)

The specialist delegation tools are registered in `seed/workflow-delegation-tools/project-orchestration-cycle-ceo.delegations.json`. Each tool durably awaits the child workflow — the CEO step suspends until the child terminates and resumes with child results in context. This prevents the "next cycle blind" problem where fire-and-forget delegation left the next cycle unaware of what the prior cycle had launched.

As of Phase 2 (deterministic gates), the three passes below are fired by the **engine** as condition-gated `invoke_workflow` jobs rather than by the agent evaluating thresholds itself. The `delegate_*` tools remain available for judgement-based overrides (see §3.3). The threshold values are inline in the seed YAML and mirror the `@nexus/kanban-contracts` constants `REDISCOVERY_MERGE_THRESHOLD` (10) and `IDEATION_STARVATION_THRESHOLD_CYCLES` (2).

### 5.1 Delegation overview table

| Tool                             | Target workflow                                         | Engine gate expression (YAML condition)                              | Durable await | Phase |
| -------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------- | ------------- | ----- |
| `delegate_rediscovery`           | `project_codebase_deep_investigation` (mode: `refresh`) | `mergesSinceDiscovery >= 10`                                         | Yes           | 4     |
| `delegate_roadmap_planning`      | `project_roadmap_planning`                              | `activeNowInitiativeCount == 0` (no active `now`-horizon initiative) | Yes           | 5     |
| `delegate_goal_backlog_planning` | `project_goal_backlog_planning`                         | `recentBurnRatePerCycle == 0` OR `starvationForecastCycles <= 2`     | Yes           | 5     |

### 5.2 How durable await works

When the CEO calls a `delegate_*` tool, the step suspends with `wait_reason='dependency'`. The workflow engine tracks the child run. When the child terminates (successfully or with failure), the parent step resumes with the child's results injected into context. The CEO then reads the injected results, re-reads `kanban.project_state` to confirm what changed, and continues.

This is distinct from `await_agent_workflow`, which is also available for cases where the CEO wants to await several workflows in a single suspend. The `delegate_*` tools are the preferred path for the named specialist passes because they carry tool-specific input schemas and fixed trigger data (e.g., `mode: "refresh"` for rediscovery).

**Circuit-broken delegations:** a delegation can be refused if its target workflow keeps failing the same way. When the tool returns a circuit-broken error, the CEO must NOT retry it — record a `blocked` decision and surface it for human repair.

---

## 6. Merge Heartbeat (Phase 3)

### 6.1 What it does

`seed/workflows/work-item-merge-orchestration-wakeup.workflow.yaml` subscribes to `WorkItemMergeCompletedEvent` and emits a `ProjectOrchestrationCycleRequestedEvent` via `kanban.orchestration_request_wakeup`. This wires the loop: every merged work item causes the CEO cycle to fire.

```yaml
workflow_id: work_item_merge_orchestration_wakeup
trigger:
  type: event
  name: WorkItemMergeCompletedEvent
jobs:
  - id: request_cycle
    type: mcp_tool_call
    tier: light
    inputs:
      server_id: kanban-mcp
      tool_name: kanban.orchestration_request_wakeup
      params:
        project_id: "{{ trigger.scopeId }}"
        source: work_item_merge
        reason: Work item merge completed
        dedupe_key: "project-orchestration-cycle:{{ trigger.scopeId }}:work_item_merge:{{ trigger.contextId }}"
```

### 6.2 Burst coalescing

The cycle workflow carries `concurrency: max_runs: 1, scope: trigger.scopeId, on_conflict: skip`. A rapid sequence of merges (e.g., 5 PRs merged in 2 minutes) emits 5 `WorkItemMergeCompletedEvent` events → 5 cycle-requested events → only 1 cycle actually runs (the rest are skipped). When the first cycle finishes, the next event re-arms the loop.

This means the CEO sees the world-state at the end of each burst, not once per merge — a more efficient use of tokens without losing any strategic freshness.

### 6.3 Other triggers

The cycle can also be fired by:

- A human "review now" trigger (on-demand, e.g., via the Web UI or Telegram).
- The specs-ready event (emitted when a spec revision workflow completes).
- The generation-done event (emitted when a work-item generation workflow completes).

When the board is healthy and nothing is in flight, Dispatch records a `pause` decision. New work or a human trigger re-arms the loop. There is no cron — the loop is entirely CEO-driven and event-reactive.

---

## 7. Rediscovery in Refresh Mode (Phase 4)

### 7.1 Full vs. refresh mode

The `project-codebase-deep-investigation` workflow accepts a `mode` input:

| Mode      | Behaviour                                                                                             |
| --------- | ----------------------------------------------------------------------------------------------------- |
| `full`    | Complete investigation of the entire codebase; used for initial project onboarding                    |
| `refresh` | Delta-probe only — identifies scopes that changed since `lastDiscoveryAt` and investigates only those |

`delegate_rediscovery` always passes `mode: "refresh"` via its `fixed_trigger_data`:

```json
{
  "id": "ceo.rediscovery",
  "tool_name": "delegate_rediscovery",
  "workflow_id": "project_codebase_deep_investigation",
  "fixed_trigger_data": { "mode": "refresh" }
}
```

### 7.2 What delta-probe does

In refresh mode, the investigation coordinator identifies the set of codebase scopes (e.g., packages, service modules) that changed since `lastDiscoveryAt` — typically by inspecting git history or merge records. It investigates only those scopes and merges the findings into the existing capability map rather than rebuilding it from scratch.

This is significantly cheaper in tokens than a full investigation on a large codebase while still keeping the capability map current for areas that actually changed.

### 7.3 Stamping the baseline

When the refresh investigation completes, it calls `kanban.record_discovery_completed`, which stamps `last_discovery_at` on the orchestration record. On the next cycle, `mergesSinceDiscovery` resets to 0 (counting only from the new baseline). This prevents the threshold from re-triggering on the same set of merges.

---

## 8. Roadmap Planning (Phase 5)

### 8.1 What the workflow does

`seed/workflows/project-roadmap-planning.workflow.yaml` runs a single `plan_roadmap` job using the `product-manager` agent profile. The workflow is triggered manually or via `delegate_roadmap_planning`.

The roadmap planning agent:

1. Reads `kanban.project_state` (goals, existing initiatives, staleness).
2. Reads the charter and capability map from `docs/project-context/`.
3. Calls `kanban.orchestration_timeline` for strategic decision history (now defaults to the most-recent ~20 decisions, full count in `diagnostics.decisionCount`, `limit`/`offset` to page deeper) — or `kanban.orchestration_activity` for a quick recent-activity feed.
4. Proposes new initiatives or updates existing ones: sets horizon, priority, status, and links to goals.
5. Calls `kanban.initiative_set_priority` to set ordering, which stamps `last_reviewed_at`.
6. Writes a `roadmap_summary` to job output.

### 8.2 What it does NOT do

The roadmap planning workflow does not create work items. Work item creation is ideation's responsibility (`project_goal_backlog_planning`). This separation of concerns (SRP) ensures the roadmap can be reworked without generating backlog churn. An operator can trigger roadmap planning to restructure the initiative horizon without accidentally flooding the backlog.

### 8.3 Gating condition

The Strategize step gates `delegate_roadmap_planning` on any of:

- No initiative has a recent `lastReviewedAt` (horizons are stale).
- An active goal has no linked initiative.
- There is no `now`-horizon initiative with `status: active`.

After the engine's roadmap-planning gate completes, the strategize agent reads the refreshed `strategic.initiatives`; the ideation gate is then evaluated deterministically by the engine (the agent may still trigger ideation via `delegate_goal_backlog_planning` as a judgement override).

---

## 9. Initiative-Aware Ideation (Phase 5)

### 9.1 Extension to goal backlog planning

The `project_goal_backlog_planning` workflow was extended in Phase 5 with initiative-awareness:

- Ideation scopes to the active `now`-horizon initiative when one exists.
- Created work items have `initiative_id` set to the active initiative's ID, linking them into the initiative at creation time.
- Deduplication runs against the **fresh** capability map (the one produced by the most recent re-discovery, not the stale map from a prior cycle).

### 9.2 Starvation gate

The gate is `starvationForecastCycles <= IDEATION_STARVATION_THRESHOLD_CYCLES (2)`. The CEO may call `delegate_goal_backlog_planning` multiple times per cycle if the runway does not recover after the first ideation pass (up to the step loop limit). A `null` forecast (zero burn rate — new or stalled project) also triggers ideation.

### 9.3 Initiative linkage

When ideation creates items linked to an initiative, those items appear in the initiative's `openWorkItemCount` in subsequent `project_state` reads. The Dispatch step can then apply initiative-aware prioritisation when promoting backlog items — candidates linked to the active `now` initiative rank higher.

---

## 10. Charter Materialization (file availability)

Whenever the charter changes — for example via the standalone `project_charter_ceo` workflow run in `refine` mode from the project UI — the updated charter data lands in the kanban DB (goals + charter memories). That data must also be reliably available as `docs/project-context/CHARTER.md` in the project repository so that agents and tools can read it without a live DB query. Three complementary mechanisms guarantee this.

**Source of truth.** The kanban DB is the authoritative store. `CharterDocRenderService.render()` is the single renderer — it assembles the charter markdown from the project's goals and charter memories. `docs/project-context/CHARTER.md` is a _projection_ of that data, not the source of truth.

**Three delivery mechanisms:**

| Mechanism                                           | Where                                                                                           | Behaviour                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(A) `kanban.get_charter` runtime tool**           | `apps/kanban/src/mcp/tools/read/get-charter.tool.ts`                                            | Renders live from the DB on demand. Race-free; never reads a stale file. This is the authoritative path for agents that need the charter during a run.                                                                                                                                                                                                                             |
| **(B) Run-start materialization**                   | `apps/kanban/src/core/core-lifecycle-stream.consumer.ts`                                        | When a workflow run starts, the lifecycle stream consumer enqueues a charter regen job so the committed file is refreshed before the run's first agent turn reads it.                                                                                                                                                                                                              |
| **(C) Hardened regen queue + reconciliation sweep** | `apps/kanban/src/project/charter-regen.processor.ts`, `charter-regen-reconciliation.service.ts` | BullMQ queue with 3 attempts and exponential backoff (1 s base). Processor throws on failure so BullMQ retries rather than silently swallowing errors. A startup sweep plus a 15-minute periodic reconciliation (`KANBAN_CHARTER_RECONCILE_INTERVAL_MS` overrides the default) re-enqueues any project whose file is missing or stale, self-healing without operator intervention. |

**Net effect.** A transient git-push failure or queue restart cannot leave the charter file permanently absent. Mechanism A is always available regardless of file state. Mechanisms B and C ensure the committed file catches up autonomously. Operators do not need to manually trigger a regen after a queue outage.

**Key env var:** `KANBAN_CHARTER_RECONCILE_INTERVAL_MS` — override the 15-minute reconciliation sweep interval (e.g., set to `60000` in CI or dev to flush quickly).

---

## 11. End-to-End Worked Example

This example walks through a concrete scenario: a project with 14 merges since last discovery, 1 item in backlog, and no `now`-horizon initiative.

**Board state at cycle start:**

```
mergesSinceDiscovery: 14
starvationForecastCycles: 1.5   (3 backlog items / 2.0 burn rate)
backlogDepth: 3
now-horizon initiatives: none
latestStrategicIntent: { planned_next_steps: ["Set up initiative for auth system"] }
```

### Step 1 — Strategize: Perceive

The CEO calls `kanban.project_state` and reads:

- `strategic.staleness.mergesSinceDiscovery = 14` (≥ threshold 10) → rediscovery warranted.
- `strategic.staleness.starvationForecastCycles = 1.5` (≤ threshold 2) → ideation warranted.
- `strategic.initiatives = []` (no `now`-horizon initiative) → roadmap planning warranted.
- `strategic.latestStrategicIntent.planned_next_steps = ["Set up initiative for auth system"]` — the prior cycle intended to do this but did not complete it.

The CEO reads the charter: vision confirms the authentication system is a top priority for this sprint.

### Step 2 — Strategize: Delegate rediscovery

`mergesSinceDiscovery (14) >= REDISCOVERY_MERGE_THRESHOLD (10)` is true. CEO calls:

```
delegate_rediscovery({ reason: "14 merges since last discovery; capability map may be stale." })
```

Step suspends. The `project_codebase_deep_investigation` workflow runs in `refresh` mode — delta-probes the scopes that changed in the last 14 merges. It updates the capability map and calls `kanban.record_discovery_completed`. Step resumes. `mergesSinceDiscovery` will reset to 0 on the next read.

### Step 3 — Strategize: Delegate roadmap planning

No `now`-horizon initiative exists. CEO calls:

```
delegate_roadmap_planning({
  reason: "No active now-horizon initiative; prior cycle intended to set up auth system initiative.",
  goals: ["Ship secure authentication by end of sprint"]
})
```

Step suspends. `project_roadmap_planning` runs: reads goals, charter, fresh capability map. Creates initiative "Authentication System" with `horizon: now`, `status: active`, `priority: 0`, linked to the auth goal. Stamps `last_reviewed_at`. Writes `roadmap_summary`. Step resumes.

### Step 4 — Strategize: Delegate ideation

`starvationForecastCycles (1.5) <= IDEATION_STARVATION_THRESHOLD_CYCLES (2)` is true. CEO calls:

```
delegate_goal_backlog_planning({
  reason: "Starvation forecast 1.5 cycles; scoping ideation to new auth initiative."
})
```

Step suspends. `project_goal_backlog_planning` runs initiative-aware: scopes to `init-abc123` (the new "Authentication System" initiative), deduplicates against the fresh capability map. Creates 3 new backlog items with `initiative_id = "init-abc123"`. Step resumes.

### Step 5 — Strategize: Light grooming

CEO has 6 total backlog items (3 pre-existing + 3 newly created). It:

- Links the 3 pre-existing items to `init-abc123` via `kanban.initiative_link_work_item`.
- Re-prioritises: sets auth-related items to priority 1-3, unrelated items to priority 10+.

No items are deferred or split this cycle.

### Step 6 — Strategize: Record strategic intent

```
kanban.record_strategic_intent({
  focus_initiative_id: "init-abc123",
  rationale: "Authentication initiative created and scoped; 6 items linked. Rediscovery completed (14 merges absorbed).",
  planned_next_steps: [
    "Promote highest-priority auth item to todo",
    "Monitor starvation forecast — ideate again if falls below 2"
  ],
  staleness_actions: ["delegated rediscovery: 14 merges", "roadmap planning: created auth initiative", "ideation: 3 items created"]
})
```

### Step 7 — Strategize: Hand off

```
set_job_output({
  groomed_board_summary: {
    todo_count: 0,
    backlog_count: 6,
    dispatchableTodoCount: 0,
    autonomous_mode: true,
    promotion_candidates: [
      { workItemId: "wk-001", title: "Implement JWT login endpoint", priority: 1, initiativeId: "init-abc123" },
      { workItemId: "wk-002", title: "Add password hashing service", priority: 2, initiativeId: "init-abc123" }
    ],
    strategic_intent: "Auth initiative active; 6 items linked; rediscovery complete.",
    groomed_changes: [
      { workItemId: "wk-pre-1", change: "Linked to init-abc123; priority set to 3." }
    ]
  }
})
```

`step_complete` → Job 2 starts.

### Step 8 — Engine: Deterministic backlog promotion

Before the Dispatch agent turn begins, the `promote_safe_backlog` engine job fires. Condition: `todo_count (0) < target_todo_depth (3)` and `autonomous_mode == true` → true. It iterates over the two `promotion_candidates` from `groomed_board_summary` and calls `kanban.work_item_transition_status` for each:

```
kanban.work_item_transition_status({ workItemId: "wk-001", status: "todo" })  // engine
kanban.work_item_transition_status({ workItemId: "wk-002", status: "todo" })  // engine
```

Both items are now `todo`. The dispatch agent has not yet started.

### Step 9 — Dispatch: Lifecycle-start promoted items

Dispatch re-reads `kanban.project_state`. `todo_count = 2`, `dispatchableTodoCount = 2`. The engine already promoted the safe candidates — Dispatch's job is to lifecycle-start them:

```
kanban.work_item_transition_status({ workItemId: "wk-001", status: "in-progress" })
```

Records:

```
kanban.complete_orchestration_cycle_decision({
  decision: "repeat",
  reason: "Engine promoted wk-001 and wk-002 to todo. Lifecycle-started wk-001 (Implement JWT login endpoint). Auth initiative now has 1 in-progress item.",
  idempotency_key: "cycle-2026-06-13T01:00:00Z"
})
```

`step_complete`.

### Step 10 — Heartbeat loops

The work on `wk-001` proceeds. When it merges:

- `WorkItemMergeCompletedEvent` fires.
- `work_item_merge_orchestration_wakeup` calls `kanban.orchestration_request_wakeup`.
- `ProjectOrchestrationCycleRequestedEvent` emits.
- The cycle starts again with updated staleness signals.

---

## 12. Escalated Blocked-Item Recovery

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

---

## 13. Key File Locations

All seed files introduced or modified by EPIC-208:

| File                                                                              | Phase | Purpose                                                                                            |
| --------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------- |
| `seed/workflows/project-orchestration-cycle-ceo.workflow.yaml`                    | 3     | Two-job cycle definition (strategize + dispatch)                                                   |
| `seed/workflows/prompts/project-orchestration-cycle-ceo/strategize.md`            | 3     | Strategize step prompt                                                                             |
| `seed/workflows/prompts/project-orchestration-cycle-ceo/dispatch.md`              | 3     | Dispatch step prompt (slimmed from prior decide.md)                                                |
| `seed/workflows/work-item-merge-orchestration-wakeup.workflow.yaml`               | 3     | Merge heartbeat: WorkItemMergeCompletedEvent → cycle request                                       |
| `seed/workflows/project-roadmap-planning.workflow.yaml`                           | 5     | Roadmap planning workflow                                                                          |
| `seed/workflows/prompts/project-roadmap-planning/plan-roadmap.md`                 | 5     | Roadmap planning agent prompt                                                                      |
| `seed/workflow-delegation-tools/project-orchestration-cycle-ceo.delegations.json` | 3–5   | `delegate_rediscovery`, `delegate_roadmap_planning`, `delegate_goal_backlog_planning` tool configs |

Kanban-domain source files (in `apps/kanban`):

| Path                                                           | Phase | Purpose                                                                                  |
| -------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------- |
| `apps/kanban/src/initiatives/`                                 | 1     | Initiative entity, repository, and module                                                |
| `apps/kanban/src/mcp/tools/mutation/initiative-*.ts`           | 1     | MCP tool implementations                                                                 |
| `apps/kanban/src/strategic/project-strategic-state.service.ts` | 2     | Staleness computation at read time                                                       |
| `apps/kanban/migrations/`                                      | 1     | `kanban_initiatives`, `kanban_initiative_goals`, `work_items.initiative_id` FK migration |

Contract packages:

| Path                                                 | Phase | Purpose                                  |
| ---------------------------------------------------- | ----- | ---------------------------------------- |
| `packages/kanban-contracts/src/strategic.schema.ts`  | 2     | Threshold constants + staleness schema   |
| `packages/kanban-contracts/src/initiative.schema.ts` | 1     | Initiative Zod schemas and request types |

---

## 13. Operational Notes

### Tuning thresholds

The gate thresholds are inline in the `condition` expressions of the deterministic gate jobs in `seed/workflows/project-orchestration-cycle-ceo.workflow.yaml`. Adjust them there to retune without a prompt change:

- `mergesSinceDiscovery >= 10` (re-discovery) — lower on fast-moving projects where the capability map drifts quickly; raise on stable projects to reduce token cost.
- `activeNowInitiativeCount == 0` (roadmap planning) — this is a boolean gate; it fires whenever there is no active `now`-horizon initiative.
- `recentBurnRatePerCycle == 0` or `starvationForecastCycles <= 2` (ideation) — lower the starvation threshold if you want the CEO to ideate more aggressively; raise it if you want a leaner backlog.

The `promote_safe_backlog` job and the project WIP cap are tuned via orchestration policy variables (registry: `packages/kanban-contracts/src/orchestration-policy.registry.ts`; global defaults: `seed/variables/orchestration-defaults.json`), not inline in the gate conditions:

- `backlog.target_todo_depth` (default 3) — the todo-queue depth the engine keeps groomed. The `promote_safe_backlog` job back-fills ready backlog into `todo` while `todo_count < target_todo_depth`. Raise it to keep a deeper ready buffer (more parallel dispatch headroom); set it to 1 to restore the old zero-floor behaviour.
- `work_item_dispatch_max_active_per_project` (Kanban setting, default 3) — the project WIP cap (`maxActive`). Dispatch fills every free slot up to this cap and never holds one in reserve, so this setting is the real throughput ceiling.

The corresponding named constants in `packages/kanban-contracts/src/strategic.schema.ts` (`REDISCOVERY_MERGE_THRESHOLD = 10`, `IDEATION_STARVATION_THRESHOLD_CYCLES = 2`) remain the source of truth for test fixtures and type-safe comparisons in unit tests. Keep the YAML inline values and the contract constants in sync when tuning.

### Grooming scope cap

The Strategize prompt applies a soft cap of around 10 items per grooming pass to bound token cost. On large boards (50+ backlog items), the CEO prioritises items linked to the active `now` initiative and items with the highest priority score. Items further down the list are groomed on subsequent cycles.

### Circuit breakers on delegations

If a specialist workflow fails repeatedly (e.g., `delegate_roadmap_planning` fails 3 times on a malformed charter), the delegation infrastructure circuit-breaks it. The CEO receives a circuit-broken error and must record a `blocked` decision naming the failing workflow and failure class. Do not retry a circuit-broken delegation — fix the underlying cause (e.g., repair the charter file) and the breaker will reset.

### Board health invariant

An idle board (zero todo, zero in-progress, unblocked backlog items, `autonomous_mode: true`) is a critical orchestration failure, not a valid idle state. The merge heartbeat ensures the CEO fires after every merge. If the board is healthy and Dispatch records `pause`, the loop re-arms on the next trigger. If the board appears idle and the loop is not firing, check:

1. Whether `work-item-merge-orchestration-wakeup` is seeded and enabled in the environment.
2. Whether `ORCHESTRATION_AWAIT_ENABLED` is set — if false, delegations fall back to fire-and-forget and child results are not injected back into the parent cycle.
3. The orchestration timeline for recent `blocked` or `pause` decisions with explanations.

### Boundary enforcement

EPIC-208 follows the same boundary rules as the rest of the orchestration domain:

- No `kanban`/work-item/initiative identifiers in `apps/api/src` or `packages/core/src`. The `nexus-boundaries/no-core-kanban-residue` lint rule enforces this.
- Delegation tools use neutral `scope_id`/`scopeId` only — no initiative or work-item domain IDs cross the api/kanban boundary.
- Initiative entity, tools, and intent storage are entirely kanban-side.
- All delegation projections route through the durable-await path; none hard-code `invokeAgentWorkflow` (which would produce fire-and-forget behaviour and leave the next cycle blind).
