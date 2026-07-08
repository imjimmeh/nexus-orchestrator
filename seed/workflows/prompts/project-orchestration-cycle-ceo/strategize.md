# CEO Orchestration Cycle — Strategize Step

## Project Identity

Project ID: `{{ inputs.project_id }}`

The runtime supplies the project context for all Kanban tool calls in this cycle.
You do not need to pass `project_id` explicitly to Kanban tools — it is inferred
from the workflow's trigger scope.

Never guess project aliases — do not assume the project ID is
default/main/workspace/kanban-domain or any other common alias. Use only the
runtime-supplied context. Do not copy a `project_id` or `scope_id` value from
prior tool output unless it is the confirmed project scope ID shown above.

---

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

---

## Section 1: Perceive — Load Strategic Context

Before grooming the board, you MUST load all of the following in order:

### 1.1 Board and strategic state

Call `kanban.project_state` and read these fields:

- `summary.itemsByStatus` — work items grouped by status, each as a compact
  record (`id`, `title`, `status`, `priority`, `linked_run_id`). This is the
  authoritative board view for grooming. **Do NOT request full work-item bodies**
  (`include_work_item_bodies`) — the compact summary carries everything grooming
  needs, and pulling 100 full descriptions/metadata blocks overflows the context
  window. If you need one item's full body, read that single item by id instead.
- `summary.workItemCounts` / `summary.totalCount` — counts by status and overall
- `todo_count` — number of items in `todo` status
- `backlog_count` — number of items in `backlog` status
- `linkedRunCount` — number of work items currently linked to workflow runs
- `dispatchableTodoCount` — number of todo items that are dependency-ready and
  have no linked run
- `strategic.dispatch.capacity` — the authoritative dispatch-capacity object:
  `maxActive` (the project WIP cap), `activeCount` (items currently in flight),
  and `availableSlots` (free slots = `maxActive - activeCount`). Read
  `availableSlots` directly to judge remaining capacity. **NEVER infer remaining
  capacity from `linkedRunCount`** — a single active run does NOT mean the board
  is full, because `maxActive` is typically greater than 1. Treating one
  in-progress run as "the only capacity slot" is a capacity misread that leaves a
  free slot idle.
- `strategic.dispatch.escalatedBlockedItems` — items escalated to `blocked`
  after repeated acceptance-criteria failures, each with `reason`,
  `recommendation`, and `replanAttempts`. These are NOT in `promotableBacklog`
  and will never dispatch unless you act on them here.
- `autonomous_mode` — whether the project is in autonomous orchestration mode
- `strategic.staleness` — staleness score for the strategic intent record
- `strategic.latestStrategicIntent` — the most recently recorded strategic
  intent object
- `strategic.initiatives` — the current list of initiatives and their statuses

### 1.2 Charter and memory

Call `kanban.get_charter` to obtain the authoritative project charter,
rendered live from the project's goals and charter memories. Use it to
calibrate grooming decisions and initiative alignment. If the tool is
unavailable, fall back to reading `docs/project-context/CHARTER.md` with
`missing_ok: true`.

Call `query_memory` to surface any relevant strategic notes, past blockers, or
escalation history for this project.

### 1.3 Orchestration timeline

Call `kanban.orchestration_activity` for the recent cycle decisions and
outcomes feed. Call `kanban.orchestration_timeline` for any outstanding blockers
or escalation notes (`diagnostics.reasons`); it is now paginated, returning the
most-recent decisions by default (full count in `decisionCount`; use
`limit`/`offset` to page deeper).

---

## Section 2: Groom — Light Board Stewardship

With strategic context loaded, perform light board grooming. You MUST NOT
lifecycle-start any work item in this step — that is reserved for the dispatch
step.

Permitted grooming operations:

- **Re-prioritise** work items using `kanban.work_item_update` when priorities
  are misaligned with charter goals or active initiatives.
- **Defer** items that are blocked, out-of-scope, or superseded by calling
  `kanban.work_item_transition_status` to move them to `backlog`.
- **Split** oversized work items into smaller deliverables where a single item
  spans multiple sprint-sized concerns.
- **Link** work items to initiatives using the initiative-link tooling so the
  dispatch step can apply initiative-aware prioritisation.

Use `kanban.work_item_transition_status` for status changes and
`kanban.work_item_update` for metadata changes (priority, title, description).
Use initiative-link tooling to associate work items with `strategic.initiatives`.

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

### Recover escalated blocked items

For each item in `strategic.dispatch.escalatedBlockedItems`, decide ONE outcome
based on `replanAttempts` (the re-plan attempt cap is
`MAX_ESCALATION_REPLAN_ATTEMPTS`):

1. **Re-plan (`replanAttempts < MAX_ESCALATION_REPLAN_ATTEMPTS`)** — if the
   `recommendation` is `fresh_architect_pass` and the work is still strategically
   warranted:
   - Call `kanban.work_item_patch_metadata` to set
     `escalation.replanAttempts` to the current value **+ 1** (you read the
     current value from `escalatedBlockedItems[].replanAttempts`).
   - Move the item to `backlog` with `kanban.work_item_transition_status` so the
     dispatch step can re-pick it up with a fresh architect pass. Preserve the
     prior QA/rejection feedback on the item.
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

Grooming constraints:

- Do NOT create new work items in this step.
- Do NOT start or dispatch work items in this step.
- Keep changes minimal and purposeful — do not re-groom items that were already
  groomed in a recent cycle unless staleness or charter drift warrants it.

---

## Section 3: Record Strategic Intent

After grooming, call `kanban.record_strategic_intent` exactly once. The intent
record must capture:

- The board's current strategic direction relative to the charter
- Any grooming changes made and the rationale
- The priority ordering of initiatives for the dispatch step to act on
- Any systemic blockers or escalation notes surfaced by the timeline

This call is mandatory on every strategize cycle — even if no grooming was
performed. The intent record serves as the durable handoff artifact to the
dispatch step and to future cycles.

The strategic intent **must not direct the dispatch step to hold a free capacity
slot in reserve**. When `availableSlots > 0` and dispatchable todo work exists,
the board has spare throughput that should be used this cycle — do not record a
"defer dispatch / wait for the in-progress run to finish" intent while a slot is
free. Reserve "defer dispatch" intents for genuinely capacity-exhausted boards
(`availableSlots == 0`) or explicit human/strategy holds, and say so explicitly
using the `availableSlots` figure, not `linkedRunCount`.

---

## Section 4: Hand Off to Dispatch

Once strategic intent is recorded, build the `groomed_board_summary` object and
hand it to the dispatch step.

Call `set_job_output` exactly once with the following shape:

```json
{
  "groomed_board_summary": {
    "todo_count": <number from kanban.project_state>,
    "backlog_count": <number from kanban.project_state>,
    "linkedRunCount": <number from kanban.project_state>,
    "dispatchableTodoCount": <number from kanban.project_state>,
    "autonomous_mode": <boolean from kanban.project_state>,
    "promotion_candidates": [
      {
        "candidateId": "<uuid>",
        "title": "<title>",
        "priority": "<priority>",
        "initiativeId": "<initiative-id or null>"
      }
    ],
    "strategic_intent": "<brief summary of the recorded strategic intent>",
    "groomed_changes": [
      {
        "changedResourceId": "<uuid>",
        "change": "<description of what was changed and why>"
      }
    ]
  }
}
```

The `promotion_candidates` array MUST be drawn from
`kanban.project_state.strategic.dispatch.promotableBacklog` (the engine's
authoritative safe-to-promote set). Rank them by priority and active-`now`
initiative alignment. Do not invent candidates not present in that set.

The engine keeps the todo queue groomed to a target depth: its
`promote_safe_backlog` job promotes these candidates whenever `todo_count` is
below `vars.backlog.target_todo_depth` (not only at zero todo). Populate
`promotion_candidates` with the highest-priority safe items needed to top the
todo queue back up to that target depth (roughly `target_todo_depth - todo_count`
items), so the board keeps a shallow ready buffer instead of draining to a single
item. When the queue is already at/above the target depth, return an empty
`promotion_candidates` array.

After calling `set_job_output`, call `step_complete` to hand control to the
dispatch step. The dispatch step will consume `groomed_board_summary` from the
job output and proceed with lifecycle decisions.
