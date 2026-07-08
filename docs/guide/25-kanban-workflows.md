# 25 — Kanban Workflows

This document catalogs all Kanban-related workflows, their triggers, purposes, and how they integrate with the Kanban lifecycle. All workflows are defined as YAML files in the `seed/workflows/` directory and validated by seed contract specs in `apps/kanban/src/seeds/`.

## Workflow Categories

Kanban workflows fall into five categories:

| Category                    | Purpose                                                         | Trigger Mechanism                        |
| --------------------------- | --------------------------------------------------------------- | ---------------------------------------- |
| **CEO Orchestration Cycle** | Evaluate board state, make strategic decisions, dispatch work   | Domain events, manual, wake-up scheduler |
| **Work Item Execution**     | Implement, refine, review, and merge individual work items      | Lifecycle events (status transitions)    |
| **Review**                  | Automated code review with structured QA feedback               | Status transition to `in-review`         |
| **Retrospective**           | Post-cycle evidence gathering and learning                      | Orchestration completion events, manual  |
| **Project Management**      | Discovery, goal planning, codebase investigation, spec revision | Manual, domain events, import triggers   |

---

## CEO Orchestration Cycle Workflow

### `project-orchestration-cycle-ceo`

| Attribute         | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Workflow ID**   | `project_orchestration_cycle_ceo`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Trigger Type**  | Domain event (`ProjectOrchestrationCycleRequestedEvent`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Agent Profile** | `ceo-agent`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Key Job**       | Two jobs: `strategize` (new) → `dispatch` (formerly `decide`), both in the same agent session, 10 max step loops                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Tools**         | `kanban.project_state`, `kanban.orchestration_activity`, `kanban.orchestration_timeline`, `kanban.work_item`, `kanban.work_item_transition_status`, `kanban.work_item_patch_execution_config`, `kanban.work_item_update`, `kanban.work_item_restart_execution`, `kanban.complete_orchestration_cycle_decision`, `kanban.initiative_create`, `kanban.initiative_update`, `kanban.initiative_update_status`, `kanban.initiative_set_priority`, `kanban.initiative_link_goal`, `kanban.initiative_link_work_item`, `kanban.record_strategic_intent`, `delegate_rediscovery`, `delegate_roadmap_planning`, projected delegation tools |
| **Denied Tools**  | `kanban.dispatch_selected_work_items`, `invoke_agent_workflow`, `get_todo_list`, `manage_todo_list`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

**Purpose**: The central autonomic loop. The CEO agent evaluates the full board state, makes cycle decisions (`repeat`, `pause`, `complete`, `blocked`), promotes backlog items to `todo`, transitions ready work to `in-progress` via lifecycle tools, and delegates planning/bootstrap work through projected delegation.

**Key Steps**:

**Strategize step** (Step 1 — `strategize` job):

1. **Load strategic context**: Calls `kanban.project_state` (staleness signals, existing initiatives, `latestStrategicIntent`), `kanban.orchestration_timeline` (deep history, blockers, capacity, recovery — most-recent ~20 decisions by default, full count in `diagnostics.decisionCount`, `limit`/`offset` to page deeper), or `kanban.orchestration_activity` for a lightweight recent-activity feed, and reads `CHARTER.md`.
2. **Re-think strategic position**: Evaluates whether last cycle's turns moved toward the active "now" initiative; identifies stale signals requiring specialist intervention.
3. **Delegate specialist passes**: Issues durable-await delegation calls gated by staleness thresholds (e.g. `delegate_rediscovery`, `delegate_roadmap_planning`).
4. **Light grooming**: Re-prioritises, defers, splits, and links work items to initiatives without research — adjustments that are safe to make within a single cycle.
5. **Record strategic intent**: Calls `kanban.record_strategic_intent` to persist the strategic decision for audit and future context.
6. **Hand off to dispatch**: Calls `set_job_output` with a `groomed_board_summary` so the `dispatch` job starts with full context.

**Dispatch step** (Step 2 — `dispatch` job, formerly `decide`):

1. **Read groomed board**: Consumes `groomed_board_summary` from `set_job_output` produced by the `strategize` job.
2. **Evaluate and decide**: Determines the cycle decision (`repeat`, `pause`, `complete`, `blocked`) and selects work items to promote or start.
3. **Record decision**: Calls `kanban.complete_orchestration_cycle_decision` to persist the decision before mutating the board.
4. **Start work items**: Transitions selected `todo` items to `in-progress` via `kanban.work_item_transition_status`.
5. **Step complete**: Calls `step_complete` to signal cycle completion.

**Key Rules** (from prompt contract):

- "A bare `repeat` decision with no board mutation is NOT permitted when unblocked backlog exists."
- "Lifecycle Start Rules: use `kanban.work_item_transition_status` with `status: in-progress`."
- "Projected delegation tools launch workflows but do NOT constitute Kanban lifecycle starts."
- "Do not send an existing work-item UUID to a projected delegation tool as a task prompt."
- "The strategize beat is structurally prior to dispatch — the CEO cannot skip to tactical work without first perceiving staleness and executing any warranted specialist passes."

---

## Work Item Execution Workflows

### `work-item-todo-dispatch-default`

| Attribute        | Value                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| **Trigger Type** | Lifecycle event (`kanban.work_item.status_changed.v1` → status = `todo`)                         |
| **Purpose**      | Pre-dispatch validation: dependency checks, branch claim verification, agent capacity assessment |

This workflow runs when a work item enters `todo` status. It validates that the work item is ready for dispatch — dependencies are satisfied, execution config is complete, branch claims are available — before the item can transition to `in-progress`.

### `work-item-in-progress-default`

| Attribute                        | Value                                                                                                                                                                                  |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Workflow ID**                  | `work-item-in-progress-default`                                                                                                                                                        |
| **Trigger Type**                 | Lifecycle event (status = `in-progress`)                                                                                                                                               |
| **Agent Profile**                | Implementation orchestrator                                                                                                                                                            |
| **Key Jobs**                     | `implement_and_commit` (execution, 3 max step loops), `war_room_plan_alignment` (for large scope), `check_repeated_failures`, `escalate_to_needs_rework`, `transition_to_needs_rework` |
| **Strict Dependencies**          | `true`                                                                                                                                                                                 |
| **Tools (implement_and_commit)** | `spawn_subagent_async`, `wait_for_subagents`, `step_complete`, `delegate_ui_ux_testing`, `delegate_web_research`                                                                       |
| **Denied Tools**                 | `read`, `ls`, `write`, `edit`, `bash`, `get_todo_list`, `manage_todo_list`, `check_subagent_status`                                                                                    |

**Purpose**: The primary work item execution workflow. The implementation orchestrator dispatches subagents to implement the work item, monitors progress, verifies results, and commits changes.

**Key Steps**:

1. **Implementation plan** (implement step): Read work item context from DB (`trigger.resource.title`, `trigger.resource.description`, metadata). Dispatch implementation subagents.
2. **Subagent execution**: Spawn subagents for implementation tasks; wait for all to complete.
3. **Commit** (commit step): Agent cleans the working tree, stages only intended changes (not temporary files), commits, and reports `git status --porcelain` output.
4. **War room alignment** (for `scope: large` items): Aligns implementation approach with war-room consensus.
5. **Failure escalation**: On repeated failures, escalates to `needs_rework` status and transitions work item.

**Key Rules**:

- The implement_and_commit job is "orchestration-only" — it can dispatch subagents but cannot read/write files directly.
- Specialist delegation tools may be passed to spawned implementation or QA subagents only for concrete digressions: `delegate_ui_ux_testing` for UI behavior validation and `delegate_web_research` for cited external API, library, or standard uncertainty.
- A projected delegate tool already durably awaits the child workflow; subagents must consume the returned result and must not call `await_agent_workflow` after a delegate call.
- Missing markdown is not a workflow failure; fall back to DB-backed work item context.
- Commit cleanup is agent-mediated with a bounded retry loop (3 max loops).

### `work-item-refinement-default`

| Attribute        | Value                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trigger Type** | Lifecycle event (status = `refinement`, with condition `retroactiveRefinementRequired` OR `(not (eq trigger.previousStatus 'todo'))`)                         |
| **Key Jobs**     | `architect_refinement` (output: `implementation_plan`, `subtask_blueprint`), `plan_validation` (output: `validation_result`), `war_room_refinement_alignment` |

**Purpose**: Refines a work item before it enters execution. Validates the implementation plan, aligns scope with war-room consensus, and gates on explicit reopen semantics for re-refinement.

**Output contract**: `architect_refinement`'s `implementation_plan` is a **required string** field — the full Milestone/Task plan as markdown text, not a nested JSON object — because downstream Handlebars conditions (`persist_implementation_plan`, `validate_refinement_exit_readiness`, `mark_refinement_completed`) and the `plan_validation` job all key off it being genuinely non-empty.

**Exit gate**: a work item reaches `todo` only via `transition_to_todo`, which carries the same completion condition as `mark_refinement_completed` — a real `implementation_plan`, a `subtask_blueprint`, a non-`split_required` outcome, `plan_validation` not `failed`, and subtask materialization not failed. Sharing the condition means a condition-skipped `mark_refinement_completed` cannot leave `transition_to_todo` free to run anyway.

### `work-item-in-review-default`

| Attribute        | Value                                                                          |
| ---------------- | ------------------------------------------------------------------------------ |
| **Trigger Type** | Lifecycle event (status = `in-review`)                                         |
| **Key Job**      | `record_qa_feedback` (MCP tool call: `kanban.work_item_append_metadata_array`) |
| **Tools**        | `delegate_ui_ux_testing`, `delegate_web_research` for bounded QA digressions   |

**Purpose**: Automated code review. Records structured QA feedback in the work item's metadata using the `kanban.work_item_append_metadata_array` tool. Feedback includes `decision`, `feedback`, and `reviewerAgentId`. The review agent may call `delegate_ui_ux_testing` for browser, screenshot, accessibility, or flow validation and `delegate_web_research` for cited external standards; both are manual digressions that must feed the final QA decision and do not replace the required output contract.

### `work-item-ready-to-merge-default`

| Attribute        | Value                                         |
| ---------------- | --------------------------------------------- |
| **Trigger Type** | Lifecycle event (status = `ready-to-merge`)   |
| **Purpose**      | Merge prechecks and automated merge execution |

Runs merge blocking checks via Core's lifecycle workflow system before proceeding with the merge. On success, transitions the work item to `done`.

The `attempt_merge` git operation job produces a `merge_outcome` field that drives the DAG branching:

| `merge_outcome`       | Meaning                                                                     | DAG route                                                              |
| --------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `succeeded`           | Merge and push completed.                                                   | → record merge → transition to `done` → cleanup                        |
| `conflict`            | Merge produced local conflicts.                                             | → `resolve_local_conflicts` (architect-agent) → re-validate → done     |
| `quality_gate_failed` | Push rejected by the target repo's `.husky/pre-push` hook (lint/test gate). | → `remediate_quality_gate` → `validate_merge_after_remediation` → done |
| `auth_error`          | Push authentication failure.                                                | → `emit_merge_failed`                                                  |
| `failed`              | Unclassified push or merge failure.                                         | → `emit_merge_failed`                                                  |

#### Quality-gate remediation branch

When a `git push` is rejected by a pre-push hook, `GitMergeService` returns `merge_outcome: 'quality_gate_failed'` (distinct from a remote non-fast-forward rejection) and surfaces the hook's combined stdout+stderr as `quality_gate_log` on the job output. The workflow routes this outcome through a bounded one-pass remediation branch that mirrors the existing conflict-resolution path:

1. **`remediate_quality_gate`** (`tier: heavy`, `agent_profile: architect-agent`, `max_retries: 1`) — the architect agent reads `quality_gate_log`, fixes the lint or test failures in the per-run worktree, and commits the changes.
2. **`validate_merge_after_remediation`** — re-runs the merge and push. On `succeeded`, the run continues to the normal record→transition→done→cleanup tail. On a second `quality_gate_failed`, the run falls through to `emit_merge_failed`.

The remediation agent operates in the same per-run worktree used by conflict-resolution agents; no additional worktree infrastructure is required. If the remediation pass is exhausted, the failure classifier recognises the `quality_gate_failed` class as a `human_required` backstop so the run is not labelled `ambiguous_failure`.

### `work-item-split-default`

| Attribute        | Value                                                                     |
| ---------------- | ------------------------------------------------------------------------- |
| **Trigger Type** | Manual / CEO-initiated                                                    |
| **Key Job**      | `mark_parent_blocked_awaiting_children` (transitions parent to `blocked`) |

**Purpose**: Decomposes a large work item into smaller sub-items. The parent is
set to `blocked` status while children are created and dispatched. Parent
metadata records child ids in `metadata.split.proposedChildIds`; child metadata
records the canonical parent link in `metadata.split.parentId`. Legacy
`metadata.parent_context_id` authored by specs is still accepted and
canonicalized by publish-specs.

### `work-item-umbrella-resolution-default`

| Attribute        | Value                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| **Trigger Type** | Lifecycle event (status = `done`, with canonical `metadata.split.parentId` or legacy `parent_context_id`) |
| **Key Job**      | `resolve_umbrella_parent` (`kanban.work_item_resolve_umbrella_parent`)                                    |

**Purpose**: Checks whether a completed split child was the last open child for
a blocked umbrella parent. When all child ids listed in
`metadata.split.proposedChildIds` are loaded and `done`, the workflow
transitions the parent from `blocked` to `done`.

### `work-item-post-merge-spec-hydration`

| Attribute        | Value                                                       |
| ---------------- | ----------------------------------------------------------- |
| **Trigger Type** | Post-merge (status = `done`)                                |
| **Purpose**      | Updates specs and documentation after a work item is merged |

Hydrates project specifications, updates capability maps, and refreshes documentation based on the completed implementation.

---

## Review Workflow

### `work-item-in-review-default`

_(Detailed above in Work Item Execution section)_

The review workflow is triggered when a work item transitions to `in-review`. It performs automated QA:

- Records structured feedback in `metadata.qaFeedback` array
- Captures decision (approve/reject), feedback text, and reviewer agent ID
- On approval, transitions to `ready-to-merge`; on rejection, transitions back to `in-progress` with rejection feedback in `execution_config.rejectionFeedback`

---

## Project Management Workflows

### `project-discovery-ceo`

| Attribute        | Value                                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Workflow ID**  | `project_discovery_ceo`                                                                                                                                    |
| **Trigger Type** | Manual / domain event (`ProjectOrchestrationSpecsReadyEvent` emitted on completion)                                                                        |
| **Concurrency**  | `max_runs: 1, scope: trigger.scopeId, on_conflict: skip`                                                                                                   |
| **Key Jobs**     | `kickoff_clarification`, `discovery_and_specs`, `investigate_imported_repo`, `reconcile_import_specs`, `synthesize_and_hydrate_import`, `emit_specs_ready` |

**Purpose**: Onboards a new or imported project. Clarifies goals, investigates the codebase (via `project_codebase_deep_investigation` invocation), reconciles specs, and hydrates imported repository data into Kanban work items.

**Key Steps**:

1. **Kickoff clarification**: Asks at most 3 focused questions about scope, success criteria, and constraints. Outputs `kickoff_summary`, `clarified_goals`, `open_questions`.
2. **Discovery and specs**: Generates specifications based on clarified goals. Consumes the selected startup route from trigger inputs.
3. **Imported repo investigation**: Invokes `project_codebase_deep_investigation` to probe the existing codebase.
4. **Synthesis and hydration**: Generates work items from imported repository findings.
5. **Specs ready emission**: Emits `ProjectOrchestrationSpecsReadyEvent` to signal readiness for orchestration cycles.

### `project-codebase-deep-investigation`

| Attribute        | Value                                                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Workflow ID**  | `project_codebase_deep_investigation`                                                                                |
| **Trigger Type** | Manual (invoke-only)                                                                                                 |
| **Key Jobs**     | `coordinate_investigation`, `run_scope_probes`, `finalize_investigation_artifacts`, `commit_investigation_artifacts` |

**Purpose**: Deep structured investigation of an imported codebase. Divides the codebase into probe scopes, runs concurrent independent probes (up to 3), serializes dependent/overlapping scopes, and produces `CAPABILITY_MAP.md`, `CODEBASE_HEALTH.md`, and `OPEN_QUESTIONS.md`.

> **EPIC-208 Phase 4 — `mode` input**: This workflow accepts an optional `mode` input (`full` | `refresh`, default `full`). In `refresh` mode the coordinator performs a delta-probe — investigating only scopes changed since the project's `lastDiscoveryAt` timestamp — rather than a full rescan. Re-stamps `lastDiscoveryAt` on completion. The CEO's `delegate_rediscovery` tool always sets `mode: "refresh"` via `fixed_trigger_data`.

**Key Steps**:

1. **Coordinate investigation**: Produces `scope_manifest` identifying all probe scopes with dependency relationships.
2. **Run scope probes**: Dispatches subagents per scope. Batch mode for independent non-overlapping file-backed scopes; serial mode for dependent scopes. Each subagent writes `docs/project-context/probe-results/<probe_scope_id>.md`.
3. **Finalize artifacts**: Merges probe files into consolidated project-context documents. Outputs `probe_artifact_paths`, `investigation_summary_path`, `valid_probe_artifact_count`.
4. **Commit artifacts**: Git operation that commits `docs/project-context` with message `docs(discovery): persist imported repository investigation`.

### `project-goal-backlog-planning`

| Attribute        | Value                                                   |
| ---------------- | ------------------------------------------------------- |
| **Trigger Type** | CEO cycle delegate (`delegate_goal_backlog_planning`)   |
| **Purpose**      | Generates backlog work items aligned with project goals |
| **Tools**        | `delegate_web_research` for bounded external research   |

Used by the CEO orchestration cycle to expand goal-level directives into concrete, dispatchable work items. The planning agent can call `delegate_web_research` when a specific external question materially changes backlog choices; it must cite returned specialist findings in `evidenceRefs` or the planning summary and cannot use raw web search/fetch tools directly.

### `project-roadmap-planning`

| Attribute         | Value                                                                                                                                                                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Workflow ID**   | `project_roadmap_planning`                                                                                                                                                                                                                                                    |
| **Trigger Type**  | CEO cycle delegate (`delegate_roadmap_planning`)                                                                                                                                                                                                                              |
| **Agent Profile** | `product-manager`                                                                                                                                                                                                                                                             |
| **Concurrency**   | `max_runs: 1, scope: trigger.scopeId, on_conflict: skip`                                                                                                                                                                                                                      |
| **Key Job**       | `plan_roadmap` (execution, output contract requires `decision` and `roadmap_summary`)                                                                                                                                                                                         |
| **Tools**         | `kanban.project_state`, `kanban.orchestration_timeline`, `kanban.orchestration_activity`, `kanban.initiative_create`, `kanban.initiative_update`, `kanban.initiative_update_status`, `kanban.initiative_set_priority`, `kanban.initiative_link_goal`, `delegate_web_research` |

**Purpose**: The strategist reads the project charter, goals, capability map, and existing initiatives, then proposes or updates initiatives with horizons and priorities, links them to goals, and stamps `last_reviewed_at`. Does NOT create work items — backlog generation is delegated separately to `project-goal-backlog-planning` (SRP: roadmap planner writes initiatives only).

**Key constraint**: This workflow writes initiative-layer records only. Any work item ideation that follows from a newly minted initiative must be triggered as a separate `delegate_goal_backlog_planning` delegation in a subsequent cycle.

**Specialist delegation**: The roadmap planner may call `delegate_web_research` for a concrete external question that materially affects initiative horizon or priority decisions, then cite the returned findings in `roadmap_summary`. It does not receive `delegate_ui_ux_testing` or raw web search/fetch tools.

### `work-item-merge-orchestration-wakeup`

| Attribute        | Value                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------- |
| **Workflow ID**  | `work_item_merge_orchestration_wakeup`                                                       |
| **Trigger Type** | Domain event (`WorkItemMergeCompletedEvent`)                                                 |
| **Key Job**      | `request_cycle` (MCP tool call, `tier: light` — calls `kanban.orchestration_request_wakeup`) |
| **Emitted**      | `ProjectOrchestrationCycleRequestedEvent` (via the wakeup tool)                              |

**Purpose**: The merge heartbeat. Every merged work item triggers a fresh CEO orchestration cycle for the project. The `request_cycle` job calls `kanban.orchestration_request_wakeup` with `source: work_item_merge`, emitting a `ProjectOrchestrationCycleRequestedEvent`. Because the CEO cycle itself has `on_conflict: skip`, rapid merge bursts are coalesced — only one cycle runs at a time regardless of how many merges land simultaneously.

### `project-work-item-generation-ceo`

| Attribute          | Value                                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| **Trigger Type**   | CEO cycle delegate                                                                                                |
| **Key Jobs**       | `generate_bootstrap_work_items`, `publish_generated_work_items`, `emit_bootstrap_completed`, `emit_cycle_request` |
| **Emitted Events** | `ProjectOrchestrationBootstrapCompletedEvent`                                                                     |

**Purpose**: Generates work items from bootstrap analysis. For imported repositories, requires investigation artifacts before generation. Publishes generated items via `kanban.publish_specs` and signals bootstrap completion.

### `project-orchestration-advisor`

| Attribute        | Value                                                 |
| ---------------- | ----------------------------------------------------- |
| **Trigger Type** | CEO cycle delegate (`delegate_orchestration_advisor`) |
| **Key Job**      | `advise` (execution, step: `write_advice`)            |

**Purpose**: Provides targeted advice to the CEO on specific work items or board configurations — not a full cycle, just a consult.

### `project-spec-revision-ceo`

| Attribute          | Value                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------- |
| **Trigger Type**   | Manual / CEO cycle delegate (`delegate_spec_revision`)                                |
| **Key Jobs**       | `war_room_revision_alignment` (conditional on `trigger.feedback`), `emit_specs_ready` |
| **Emitted Events** | `ProjectOrchestrationSpecsReadyEvent`                                                 |

**Purpose**: Revises project specifications based on feedback or new information. Aligns revision approach with war-room consensus when feedback is present.

### `project-orchestration-refinement-ceo`

| Attribute          | Value                                                    |
| ------------------ | -------------------------------------------------------- |
| **Trigger Type**   | CEO cycle delegate (`delegate_orchestration_refinement`) |
| **Emitted Events** | `ProjectOrchestrationRefinementCompletedEvent`           |

**Purpose**: Mid-flight refinement of orchestration strategy. Re-evaluates project strategy during an active orchestration cycle and adjusts priorities.

### `imported-repo-synthesis-and-hydration`

| Attribute        | Value                                                                                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trigger Type** | Manual (invoke-only)                                                                                                                                                                   |
| **Key Job**      | `hydrate_discovery_results` (outputs: `existing_work_item_count`, `reconciliation_summary`, `hydration_summary`, `ready_for_cycle`, `cycle_decision`, `findings_ready_for_resolution`) |

**Purpose**: Synthesizes imported repository discovery results into hydrated Kanban work items. Determines whether the project is ready for orchestration cycles.

---

## Delegation Tools

The CEO uses a set of projected delegation tools to launch specialist workflows from inside the `strategize` and `dispatch` jobs. Each tool wraps a durable-await call: the CEO run is parked until every delegated child workflow reaches a terminal state, then resumes with the child's outputs injected into context. This prevents the "next cycle blind" bug where a fire-and-forget launch left the next cycle unaware of in-flight work.

| Tool                             | Target Workflow                                         | Trigger Condition                                                      | Durable Await |
| -------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------- | ------------- |
| `delegate_rediscovery`           | `project_codebase_deep_investigation` (`mode: refresh`) | `mergesSinceDiscovery >= REDISCOVERY_MERGE_THRESHOLD` (10)             | Yes           |
| `delegate_roadmap_planning`      | `project_roadmap_planning`                              | Initiative horizons stale or goals lack initiative coverage            | Yes           |
| `delegate_goal_backlog_planning` | `project_goal_backlog_planning`                         | `starvationForecastCycles <= IDEATION_STARVATION_THRESHOLD_CYCLES` (2) | Yes           |
| `delegate_ui_ux_testing`         | `ui_ux_smoke_test`                                      | CEO needs governed browser-based UX smoke testing                      | Yes           |
| `delegate_web_research`          | `web_research`                                          | CEO needs cited external research or evidence gathering                | Yes           |
| `delegate_orchestration_advisor` | `project_orchestration_advisor`                         | CEO needs read-only analysis of ambiguous state                        | Yes           |
| `delegate_spec_revision`         | `project_spec_revision_ceo`                             | Spec changes required                                                  | Yes           |

Delegation tool configs live in `seed/workflow-delegation-tools/`. Each JSON file maps a `tool_name` to a `workflow_id` with an input schema, optional `fixed_trigger_data` (e.g. `mode: "refresh"` for rediscovery), and `trigger_data_fields` listing which caller-supplied fields are forwarded as trigger data to the child workflow.

Selected non-CEO workflows also receive projected delegation tools as explicit workflow-level grants. These are manual specialist digressions, not lifecycle starts: work-item review can ask UX or research specialists for bounded validation; the implementation workflow can pass UX/research delegates to spawned implementer or verifier subagents; goal backlog and roadmap planning can call web research for concrete external evidence. In all cases, the delegate tool already durably awaits and the caller must consume the child result before completing its own output contract.

---

## Workflow Triggers

### Event-Driven Triggers

| Event                                                     | Workflows Triggered                                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `kanban.work_item.status_changed.v1` (→ `backlog`)        | None (backlog is passive)                                                                  |
| `kanban.work_item.status_changed.v1` (→ `todo`)           | `work-item-todo-dispatch-default`                                                          |
| `kanban.work_item.status_changed.v1` (→ `refinement`)     | `work-item-refinement-default`                                                             |
| `kanban.work_item.status_changed.v1` (→ `in-progress`)    | `work-item-in-progress-default`                                                            |
| `kanban.work_item.status_changed.v1` (→ `in-review`)      | `work-item-in-review-default`                                                              |
| `kanban.work_item.status_changed.v1` (→ `ready-to-merge`) | `work-item-ready-to-merge-default`                                                         |
| `kanban.work_item.status_changed.v1` (→ `done`)           | `work-item-post-merge-spec-hydration`                                                      |
| `ProjectOrchestrationCycleRequestedEvent`                 | `project-orchestration-cycle-ceo`                                                          |
| `ProjectOrchestrationSpecsReadyEvent`                     | `project-orchestration-cycle-ceo` (via wake-up)                                            |
| `ProjectOrchestrationBootstrapCompletedEvent`             | `project-orchestration-cycle-ceo` (via wake-up)                                            |
| `ProjectOrchestrationRefinementCompletedEvent`            | `project-orchestration-cycle-ceo` (via wake-up)                                            |
| `WorkItemMergeCompletedEvent`                             | `work-item-merge-orchestration-wakeup` (→ emits `ProjectOrchestrationCycleRequestedEvent`) |

### Scheduled Triggers

Kanban workflows do not use cron-based scheduling directly. Instead, the wake-up service and continuation reconciler act as scheduling mechanisms:

- **Wake-up coalescing**: Automatic wake-ups are coalesced within 60-second windows.
- **Stale reconciler**: Every 5 minutes (cooldown), checks for stuck orchestrations.
- **Lifecycle polling**: Every 5 seconds, the stream consumer checks for new events.

### Manual Triggers

| Workflow                                | How Triggered                                        |
| --------------------------------------- | ---------------------------------------------------- |
| `project-orchestration-cycle-ceo`       | `POST /api/projects/:id/orchestration/start`         |
| `project-discovery-ceo`                 | Manual project creation with import flag             |
| `project-codebase-deep-investigation`   | Invoke-only via `invoke_workflow` from discovery CEO |
| `imported-repo-synthesis-and-hydration` | Invoke-only via `invoke_workflow` from discovery CEO |
| `work-item-split-default`               | Agent-initiated decomposition                        |
| Retrospective manual replay             | `POST /api/retrospectives/run`                       |

---

## Expected Launch Conditions

| Condition                                   | Should Launch?     | Reasoning                                                             |
| ------------------------------------------- | ------------------ | --------------------------------------------------------------------- |
| Status changes from `todo` → `in-progress`  | Yes                | Triggers execution workflow                                           |
| Status changes from `backlog` → `todo`      | Yes                | Triggers pre-dispatch validation                                      |
| Status does not change (same status)        | No                 | No-op; no lifecycle event emitted                                     |
| Run already exists for this work item       | No                 | Idempotency key prevents duplicate launches                           |
| CEO cycle already running for this project  | No                 | Active cycle guard suppresses wake-up                                 |
| Auto-wake suppressed (CEO paused/completed) | No                 | Orchestration is intentionally stopped                                |
| Dependencies not satisfied                  | No                 | Dispatch service skips item with reason `dependencies_not_ready`      |
| Project WIP limit reached                   | No                 | Dispatch service skips item with reason `project_wip_limit_reached`   |
| Target branch already claimed               | No                 | Dispatch service skips with reason `target_branch_already_dispatched` |
| Agent at capacity                           | No                 | Dispatch service skips with reason `agent_capacity_reached`           |
| Work item is `blocked`                      | No                 | Blocked items are never dispatched                                    |
| Orphaned `in-progress` (no run linked)      | Yes (for recovery) | Reset to `todo` and re-enter dispatch queue                           |

---

## How Workflows Are Seeded

All workflow YAML files live in `seed/workflows/` at the repository root. They are:

- **Validated by seed contracts**: Spec files in `apps/kanban/src/seeds/` verify workflow structure, tool permissions, prompt content, and contract compliance.
- **Imported at startup**: Core's seed system loads workflows into the database on startup (with idempotent upsert logic).
- **Referenced by ID**: Dispatch and orchestration services reference workflows by their `workflow_id` string (e.g., `"work-item-in-progress-default"`).

Seed contract specs for Kanban workflows ensure:

- The CEO cycle never grants direct work-item creation or dispatch tools.
- Lifecycle status transitions are used instead of direct dispatch.
- Projected delegation tools are properly constrained to planning/bootstrap paths.
- Tool permission policies are unambiguous (no denied tools also appearing in allowed lists).
- Output contracts specify required fields for job completion validation.

---

## Relationship Between Status Transitions and Workflow Triggers

```
Status Transition          →  Lifecycle Event        →  Workflow Trigger
──────────────────────────────────────────────────────────────────────────────
backlog → todo             →  status_changed.v1      →  work-item-todo-dispatch-default
todo → in-progress         →  status_changed.v1      →  work-item-in-progress-default
todo → refinement          →  status_changed.v1      →  work-item-refinement-default
in-progress → in-review    →  status_changed.v1      →  work-item-in-review-default
in-review → ready-to-merge →  status_changed.v1      →  work-item-ready-to-merge-default
ready-to-merge → done      →  status_changed.v1      →  work-item-post-merge-spec-hydration
any → blocked              →  status_changed.v1      →  (no workflow; blocked is a wait state)
blocked → todo             →  human_feedback_resolved.v1 →  Enters todo dispatch queue
```

The lifecycle event → workflow trigger mapping is managed by Core's event routing system. When Core receives a `kanban.work_item.status_changed.v1` event with a new status, it evaluates registered workflow triggers to determine which workflows to launch. This is why **all status transition logic must go through the Kanban lifecycle event publisher** — bypassing it would skip workflow trigger evaluation.

## Retrospective Workflows

Kanban retrospectives are **not** seeded as separate workflow YAML files. The `KanbanRetrospectiveService` runs in-process within the Kanban service:

- Triggered automatically on orchestration completion (`cycle_decision: "complete"`)
- Triggered manually via `POST /api/retrospectives/run`
- Runs evidence gathering, board snapshots, and learning candidate generation
- Publishes candidates to Core's domain event bus for Core-side analysis workflows

The old Core `project_retrospective_autorun` workflow has been retired. Retrospective responsibility is fully owned by the Kanban service.
