# 22 — Kanban Work Item Lifecycle

The Kanban work item lifecycle is a state machine that governs how individual units of work progress from backlog to completion. Each status transition is validated by Kanban's lifecycle rules and emits a domain event consumed by the Core event bus, which can trigger automated workflows.

## Status Flow

```mermaid
stateDiagram-v2
    [*] --> backlog : Created
    backlog --> todo : Promoted (CEO/manual)
    todo --> refinement : Automated (lifecycle event)
    refinement --> in-progress : Automated (refinement complete)
    todo --> in-progress : CEO initiates (status transition)
    in-progress --> in-review : Automated (PR opened/agent signals)
    in-review --> ready-to-merge : Approved (review decision)
    in-review --> in-progress : Rejected (review decision)
    ready-to-merge --> done : Merged (automated)
    done --> [*]

    state blocked {
        [*] --> blocked_entry
        blocked_entry --> [*]
    }

    backlog --> blocked : Blocked
    todo --> blocked : Blocked
    refinement --> blocked : Blocked
    in-progress --> blocked : Blocked
    in-review --> blocked : Blocked
    blocked --> todo : Unblocked (human feedback resolved)

    note right of blocked
        Can be entered from any
        active state. Exits back
        to todo when unblocked.
    end note
```

## Status Semantics

| Status           | Semantic Meaning                                                                                                                      | Typical Duration    | Owned By            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------- |
| `backlog`        | Work identified but not yet prioritized or scheduled. No execution configuration required.                                            | Indefinite          | Product/CEO         |
| `todo`           | Ready for execution. Has execution config, dependencies are satisfied (or explicitly waived). Next in dispatch queue.                 | Hours to days       | CEO/Orchestration   |
| `refinement`     | Work item is undergoing automated refinement: plan generation, scope validation, war-room alignment. A transient pre-execution phase. | Minutes (automated) | Automation          |
| `in-progress`    | Actively executing. A workflow run is linked (`linked_run_id` is set). The agent is implementing, committing, and testing.            | Minutes to hours    | Agent/Workflow      |
| `in-review`      | Implementation complete. Automated code review is running (or awaiting human review in supervised mode).                              | Minutes to hours    | Automation/Reviewer |
| `ready-to-merge` | Review passed. The work item is approved for merge. A merge workflow may be pending.                                                  | Minutes (automated) | Automation          |
| `blocked`        | Work cannot proceed. May be waiting for human feedback, dependency resolution, or external input. Not dispatched.                     | Indefinite          | External/Human      |
| `done`           | Work completed and merged. Terminal state.                                                                                            | Permanent           | System              |

## Who Triggers Each Transition

| Transition                     | Trigger Actor  | Mechanism                                                                                       |
| ------------------------------ | -------------- | ----------------------------------------------------------------------------------------------- |
| (new) → `backlog`              | System / API   | `WorkItemService.createWorkItem()` defaults status to `backlog`                                 |
| `backlog` → `todo`             | CEO agent      | CEO orchestration cycle calls `kanban.work_item_transition_status` with `status: "todo"`        |
| `backlog` → `todo`             | Manual         | API `PATCH /work-items/:id` status update                                                       |
| `todo` → `in-progress`         | CEO agent      | CEO transitions work item via `kanban.work_item_transition_status` with `status: "in-progress"` |
| `todo` → `in-progress`         | Dispatch       | `DispatchService` sets `status: "in-progress"` when linking `run_id`                            |
| `todo` → `refinement`          | Automated      | Lifecycle event triggers `work-item-refinement-default` workflow                                |
| `refinement` → `in-progress`   | Automated      | Refinement workflow completes successfully                                                      |
| `in-progress` → `in-review`    | Agent/Workflow | Agent signals PR is ready; automated transition                                                 |
| `in-review` → `ready-to-merge` | Review         | Review decision of `approve`                                                                    |
| `in-review` → `in-progress`    | Review         | Review decision of `reject` — work item returns to implementation                               |
| `ready-to-merge` → `done`      | Automated      | Merge workflow completes successfully                                                           |
| Any active → `blocked`         | System/Manual  | Dependency blocks, human feedback needed, external issue                                        |
| `blocked` → `todo`             | Human          | Human feedback resolved via `submitHumanFeedbackResolution()`                                   |

## Lifecycle Events

Two event types are published when work item state changes:

### 1. Status Changed Event (`kanban.work_item.status_changed.v1`)

Fired on every status change (except when the new status equals the previous). Published to Core's domain event bus via `POST /api/internal/kanban/events`.

**Payload shape:**

```json
{
  "event": "kanban.work_item.status_changed.v1",
  "scopeId": "<project_id>",
  "contextId": "<work_item_id>",
  "workItemId": "<work_item_id>",
  "status": "<new_status>",
  "previousStatus": "<previous_status_or_null>",
  "actor": "system",
  "resource": {
    /* full WorkItemRecord */
  }
}
```

Key behaviors:

- **Deduplication**: Events are identified by a SHA-256 hash of `[kanban, event_name, projectId, workItemId, previousStatus, status, updatedAt]`.
- **Delivery tracking**: Each event is recorded in `kanban_event_delivery_projections` with status `pending`, then updated to `accepted` or `failed`.
- **Repair lane**: Failed deliveries are reported to the orchestration repair lane for later investigation.
- **Outbound sync**: If an `IOutboundSyncService` is configured, status changes are also pushed to external systems (best-effort, fire-and-forget).
- **Skip on no-change**: When `previousStatus === status`, no event is emitted.

### 2. Human Feedback Resolved Event (`kanban.work_item.human_feedback_resolved.v1`)

Fired when a human resolves a feedback request on a work item (typically unblocking it).

**Payload shape:**

```json
{
  "event": "kanban.work_item.human_feedback_resolved.v1",
  "scopeId": "<project_id>",
  "contextId": "<work_item_id>",
  "workItemId": "<work_item_id>",
  "response": "<human_response>",
  "resolvedBy": "<user_id_or_null>",
  "previousDecisionPrompt": "<original_prompt_or_null>",
  "resource": {
    /* full WorkItemRecord */
  }
}
```

When human feedback is resolved on a `blocked` item, the status is automatically set back to `todo`, and **both** events are emitted: `human_feedback_resolved` first, then `status_changed` (blocked → todo).

## Lifecycle Validation

The Kanban service validates status transitions at the domain level:

- **Valid statuses**: Only the 8 defined statuses (`backlog`, `todo`, `refinement`, `in-progress`, `in-review`, `ready-to-merge`, `blocked`, `done`) are accepted.
- **No-op detection**: Setting the status to the current value is a no-op — no save, no event.
- **Boundary enforcement**: The `nexus-boundaries/no-core-kanban-residue` lint rule ensures Core never validates Kanban statuses directly. All validation lives in the Kanban service.

**Valid transitions** (enforced by domain logic, not a hard matrix — some transitions are validated contextually):

- `backlog` → `todo`, `blocked`
- `todo` → `refinement`, `in-progress`, `blocked`
- `refinement` → `in-progress`, `blocked`
- `in-progress` → `in-review`, `blocked`, `todo` (orphan recovery or provision failure reset)
- `in-review` → `ready-to-merge`, `in-progress`, `blocked`
- `ready-to-merge` → `done`, `blocked`
- `blocked` → `todo` (via human feedback resolution)
- Any status → same status (no-op)

**Invalid transitions** (examples of what is rejected):

- `done` → any other status (terminal)
- Direct jump from `backlog` to `done` (skipping all intermediate states)
- `in-progress` → `done` without passing through review and merge

## Work Item Structure

### Core Fields

| Field                   | Type                              | Description                                                                                                                |
| ----------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `id`                    | `string (UUID)`                   | Unique identifier                                                                                                          |
| `project_id`            | `string`                          | Owning project ID                                                                                                          |
| `title`                 | `string`                          | Human-readable title                                                                                                       |
| `description`           | `string \| null`                  | Detailed description                                                                                                       |
| `status`                | `WorkItemStatus`                  | Current lifecycle status                                                                                                   |
| `type`                  | `WorkItemType`                    | One of `epic \| story \| task \| bug \| spike` — see [Work Item Types and Story Points](#work-item-types-and-story-points) |
| `parent_work_item_id`   | `string \| null`                  | FK to the parent `WorkItem` (`ON DELETE SET NULL`); forms the epic/story hierarchy                                         |
| `story_points`          | `number \| null`                  | Fibonacci estimate (`1\|2\|3\|5\|8\|13`); `null` when unpointed, forbidden on `epic`                                       |
| `priority`              | `string`                          | Priority label (e.g., `p0`, `p1`, `p2`)                                                                                    |
| `assigned_agent_id`     | `string \| null`                  | Agent assigned to execute this work item                                                                                   |
| `token_spend`           | `number`                          | Cumulative token spend across executions (accrued from terminal run `usage` totals; see `24-kanban-core-integration.md`)   |
| `current_execution_id`  | `string \| null`                  | Current workflow run ID (set during dispatch, cleared on completion)                                                       |
| `waiting_for_input`     | `boolean`                         | Whether the work item is awaiting human input                                                                              |
| `execution_config`      | `WorkItemExecutionConfig \| null` | Execution parameters                                                                                                       |
| `metadata`              | `Record<string, unknown> \| null` | Arbitrary metadata (QA feedback, decision history)                                                                         |
| `last_execution_status` | `string \| null`                  | Status of the last linked workflow run                                                                                     |
| `linked_run_id`         | `string \| null`                  | Currently linked workflow run ID                                                                                           |
| `created_at`            | `Date`                            | Creation timestamp                                                                                                         |
| `updated_at`            | `Date`                            | Last update timestamp                                                                                                      |

### Execution Config

The `execution_config` object defines how a work item should be executed:

| Field                | Type                      | Description                                             |
| -------------------- | ------------------------- | ------------------------------------------------------- |
| `agentProfileId`     | `string`                  | Agent profile to use                                    |
| `baseBranch`         | `string`                  | Git base branch for the worktree                        |
| `targetBranch`       | `string`                  | Git target branch (used for branch claim deduplication) |
| `contextFiles`       | `string[]`                | Files providing context for the agent                   |
| `documentationUrls`  | `string[]`                | Documentation URLs                                      |
| `maxTokens`          | `number`                  | Token budget override                                   |
| `maxLoops`           | `number`                  | Maximum agent loop count                                |
| `implementationPlan` | `Record<string, unknown>` | Structured implementation plan                          |
| `rejectionFeedback`  | `object \| string`        | Feedback from previous review rejections                |
| `rejectionCount`     | `number`                  | Count of review rejections                              |

### Relationships

- **Dependencies** (`dependsOn`): Work items that must be `done` before this item is dispatchable. Stored in a join table; queryable via `findDependenciesByWorkItemIds`.
- **Subtasks**: Granular sub-tasks with their own independent status (`todo`, `in_progress`, `done`, `blocked`), ordering, and inter-subtask dependencies.

### Status Groups

Statuses are grouped for summary calculations:

| Group       | Statuses                                 |
| ----------- | ---------------------------------------- |
| `active`    | `refinement`, `in-progress`, `in-review` |
| `completed` | `ready-to-merge`, `done`                 |
| `blocked`   | `blocked`                                |

## Board State Service

The `BoardStateService` provides board-level projections:

- **Snapshots**: Creates point-in-time snapshots of all work items for a project, with column distribution by status and serialized work item data.
- **Mutation detection**: Compares the current board state against the most recent snapshot to detect changes (added items, removed items, completed items, distribution shifts).
- **Latest snapshot retrieval**: Returns the most recent snapshot for a project.
- **Idempotency**: Snapshots are keyed by `idempotency_key` for deduplication within orchestration cycles.
- **Summary aggregation** (`getBoardStateSummary`): Returns a typed `BoardStateSummary` for a project covering the seven flat counts (`totalTasks`, `completedTasks`, `blockedTasks`, `inProgressTasks`, `pendingTasks`, `lastActivityAt`) plus the always-populated structured fields `column_counts`, `total_items`, `work_item_counts` (per-status histogram with `activeCount`/`doneCount`), and `goal_coverage` (non-archived goal taxonomy with `coveragePercentage`). Terminal work-item statuses are `['done', 'completed']`; `coveragePercentage` falls back to `0` when `total === 0`.

Board state data feeds the retrospective evidence gathering process and helps the CEO agent understand project health at a glance.

## Work Item Types and Dispatch

Work items are dispatched differently based on context:

- **Autonomous dispatch**: The CEO orchestration cycle transitions `todo` items to `in-progress` via `kanban.work_item_transition_status`, which triggers the lifecycle automation that launches the appropriate workflow.
- **Direct dispatch**: `DispatchService.dispatchReadyWorkItems()` iterates over todo items, checks dependencies, capacity, and target branch availability, then launches workflows directly via `CoreWorkflowClientService.requestWorkflowRun()`.
- **Selected dispatch**: `dispatchSelectedWorkItems()` dispatches a specific subset of items, used for manual trigger or targeted re-dispatch.

Under the hood both `DispatchService.dispatchReadyWorkItems` and `DispatchService.dispatchSelectedWorkItems` are thin facades that delegate to a single core function `dispatchWorkItems(deps, options)` in `apps/kanban/src/dispatch/dispatch-work-items.core.ts`. The core is parameterized by `DispatchCoreOptions` flags (`selectedWorkItemIds`, `limit`/`slots`, `capacitySkipReason`, `causationIdPrefix`, `partialFailure`, `reconcileOrphans`, etc.) so the two public entry points share one loop and one set of skip-reason / causation-id / idempotency-key format strings. See `docs/plans/2026-06-23-dispatch-loop-unification.md` for the refactor decision record.

The dispatch workflow for work items (`work-item-todo-dispatch-default`) includes pre-flight checks: dependency verification, branch claim ownership, and agent capacity assessment.

## Work Item Types and Story Points

Every work item carries a first-class `type`, an optional `parent_work_item_id`,
and an optional Fibonacci `story_points` estimate. These replaced the earlier
`scope` (`standard | large`) field entirely — `scope` no longer exists on the
entity, the API contract, or seed workflow payloads. The rules below are the
single source of truth in `packages/kanban-contracts/src/schemas/work-item-type.rules.ts`
(shared by `apps/kanban` and `apps/web` so both sides enforce the same
invariants).

### The five types

| Type    | Can have children? | Can have a parent? | Allows `story_points`? |
| ------- | ------------------ | ------------------ | ---------------------- |
| `epic`  | Yes                | No (never)         | No — rejected          |
| `story` | Yes                | Yes                | Yes                    |
| `task`  | No                 | Yes                | Yes                    |
| `bug`   | No                 | Yes                | Yes                    |
| `spike` | No                 | Yes                | Yes                    |

### Parent/child matrix (`canParent(parent, child)`)

A child can never be `epic` (epics are always roots). Otherwise:

| Parent type | Allowed child types             |
| ----------- | ------------------------------- |
| `epic`      | `story`, `task`, `bug`, `spike` |
| `story`     | `task`, `bug`, `spike`          |
| `task`      | — (leaf; cannot have children)  |
| `bug`       | — (leaf; cannot have children)  |
| `spike`     | — (leaf; cannot have children)  |

`assertWorkItemInvariants` (in the kanban `WorkItemService`) enforces this
matrix, the epic/points exclusion, and the epic/parent exclusion server-side
on every create and update; the web UI (`work-item-type-form.helpers.ts`)
mirrors the same predicates client-side for immediate form feedback, but the
server remains the source of truth.

### Fibonacci story points

`STORY_POINT_VALUES = [1, 2, 3, 5, 8, 13]`. Any other numeric value is
rejected by `StoryPointsSchema`. Points are forbidden on `epic` and optional
(nullable) on every other type. A leaf/story pointed at `13` is the signal
the CEO uses to decide whether to decompose it (see the oversized-item split
in [Refinement Pipeline](#refinement-pipeline-producers-and-consumers) above)
or promote it to `epic`.

### Dispatch guard: containers never dispatch

A **container** is any `epic`, or any `story` that currently has children in
the same project. `isDispatchable(type, hasChildren)` returns `false` for
both cases; `isContainerCandidate()` (`apps/kanban/src/dispatch/dispatch-container.helper.ts`)
consults it immediately after the `status !== "todo"` skip in the shared
`dispatchWorkItems` core, so no container ever reaches
`CoreWorkflowClientService.requestWorkflowRun()` — closing the historical hole
where a `todo` epic (or a `scope: large` item, under the old model) could be
dispatched directly. The same guard is consulted by the manual dispatch API
path and by every "dispatchable todo work remaining" read predicate used by
orchestration continuation/blocker logic, so a container occupies its board
column visually but is structurally invisible to those checks. A childless
`story` (or any leaf `task`/`bug`/`spike`) dispatches exactly like before.

### Hierarchy and rollup

- **Parent link**: `parent_work_item_id` is a real FK column (`ON DELETE SET NULL`),
  not metadata. Promoting a `story` to `epic` atomically detaches any existing
  parent in the same transaction.
- **Points rollup**: for a container, its displayed `story_points` is the sum
  of its children's points (recursively, epic → story → leaf); a childless
  item's rollup is just its own `story_points`. Computed via a repository
  helper (`computeRolledUpPoints`) rather than denormalized on the row.
- **Auto-completion**: a container (epic, or story-with-children)
  auto-completes to `done` once every child is `done`, via
  `kanban.work_item_resolve_umbrella_parent` — see
  [Split umbrella relationships](#split-umbrella-relationships) above.
- **Web UI**: the board shows a type badge and color per card
  (`WorkItemTypeBadge`), a story-point chip (hidden for epics, showing the
  derived rollup on containers), an expand/collapse hierarchy view for
  epic/story cards with a rollup point total, a type filter, and a
  create/convert-type form with client-side parent/points validation mirroring
  the server rules.

## Refinement Pipeline: Producers and Consumers

The `refinement` status feeds an always-active consumer pipeline. Two seeded
workflows subscribe to `kanban.work_item.status_changed.v1` with
`trigger.status == "refinement"`:

| Workflow                       | Condition                                                          | Purpose                                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `work_item_refinement_default` | Always (on refinement)                                             | Generates an implementation plan, validates scope, aligns with codebase context                                                                                    |
| `work_item_split_default`      | Oversized (`story_points == 13`) or CEO-flagged, and no parent yet | Decomposes an oversized item into child work items; parent exits refinement terminally — see [Work Item Types and Story Points](#work-item-types-and-story-points) |

### Who produces `refinement` entries

Four mechanisms can transition an item into `refinement`:

1. **Promotion reroute** (requires `work_item_preflight_pipeline_enabled = true`): when
   the CEO or any actor calls `kanban.work_item_transition_status` with
   `status: "todo"` for a `backlog` item that has never cleared refinement, the
   effective target status is silently rewritten to `"refinement"`. Controlled
   by the `resolvePromotionReroute` helper in
   `apps/kanban/src/work-item/work-item-preflight-routing.helper.ts`.

2. **Dispatch safety-net** (requires `work_item_preflight_required = true`): the
   dispatch core loop (`dispatchWorkItems` in
   `apps/kanban/src/dispatch/dispatch-work-items.core.ts`) checks every `todo`
   candidate before launching. Items that have never cleared refinement are
   transitioned to `refinement` and skipped (reason: `refinement_required`). This
   catches items that reached `todo` before the promotion reroute was enabled.

3. **CEO discretionary move**: the CEO agent can call
   `kanban.work_item_transition_status` with `status: "refinement"` explicitly for
   any item it judges under-specified. No settings required.

4. **Oversized-item split**: when `work_item_split_default` processes a
   `refinement` item pointed at `story_points == 13` (or flagged by the CEO),
   child items are created in `backlog` with `parent_work_item_id` set to the
   parent's id and enter the pipeline afresh. The parent stays as the
   non-dispatchable umbrella item while children carry the real parent
   column — see [Work Item Types and Story Points](#work-item-types-and-story-points).

### Split umbrella relationships

Splits link the umbrella parent to the generated child work items via the
real `parent_work_item_id` column (not metadata) — see
[Hierarchy and rollup](#hierarchy-and-rollup).

The `work_item_umbrella_resolution_default` workflow runs when a split child
reaches `done`. It calls `kanban.work_item_resolve_umbrella_parent`, which
looks up the child's `parentWorkItemId`, finds all sibling child ids via
`findChildIds(parentId)`, and — once every child is `done` — transitions the
umbrella parent to `done`.

### Loop-guard

`metadata.refinement.hasClearedRefinementOnce` (boolean) is set to `true` by
the refinement workflow after a successful run. The promotion reroute and
dispatch gate both check this flag and pass through items that have already
cleared refinement, preventing infinite re-refinement loops.

### Exit gate: reaching `todo`

`work_item_refinement_default`'s `transition_to_todo` job carries the same
completion condition as `mark_refinement_completed`: both only run when the
architect job produced a genuine `implementation_plan` (string) and
`subtask_blueprint`, the item isn't split-required, `plan_validation` didn't
fail, and subtask materialization succeeded. Because both jobs share the exact
condition, a work item cannot reach `todo` through a partially-run or
condition-skipped refinement chain — completion and the `todo` transition are
gated together, not independently.

### How to enable

Both opt-in settings are off by default. Enable them via the kanban settings
API or database:

| Setting                                | Effect                                                                          | Default |
| -------------------------------------- | ------------------------------------------------------------------------------- | ------- |
| `work_item_preflight_pipeline_enabled` | Reroutes `backlog → todo` to `backlog → refinement` (for un-refined items)      | `false` |
| `work_item_preflight_required`         | Blocks dispatch of un-refined `todo` items; reroutes them to `refinement` first | `false` |

Enabling `work_item_preflight_required` with existing un-refined `todo` items
will cause them to bounce to `refinement` on the next dispatch cycle (one-time
transition per item).

See [ADR-20260627-refinement-routing-restoration](../architecture/decisions/ADR-20260627-refinement-routing-restoration.md)
for the full design rationale.

## Race-safety cross-reference

The transition from `todo` to `in-progress` (and the link from work
item to workflow run that the transition writes) is race-prone: at
least five mutators of the same row can interleave, and the
conditional `linkRunIfUnlinked` UPDATE is the only naive guard. The
race-safety protocol for the link path is a per-work-item
orchestration lease. See
[kanban-work-item-lifecycle.md](kanban-work-item-lifecycle.md) for
the cross-reference (lease identity, owner id format, TTL, rollback
flag, and where the operator runbook lives).
