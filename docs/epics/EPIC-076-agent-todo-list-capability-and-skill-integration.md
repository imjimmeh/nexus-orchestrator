# EPIC-076: Agent Todo List Capability and Skill Integration

Status: Proposed  
Priority: P1 (High)  
Created: 2026-04-11  
Owner: TBD  
Theme: Agent execution quality, transparency, and controllability

---

## 1. Executive Summary

Pi coding agent intentionally does not ship a built-in todo primitive. Nexus can add this as a first-class runtime capability so agents can explicitly track multi-step work, keep plans current while executing, and surface progress to users.

This epic introduces a `manage_todo_list` tool and full supporting stack:

1. Runtime tool contract and validation rules (same operating model as Copilot-style todo management).
2. Persistent per-run todo list storage with optimistic concurrency.
3. API callback tool integration via capability manifest and tool mount pipeline.
4. UI visibility in active session surfaces.
5. A dedicated agent skill with clear usage instructions and guardrails.
6. Workflow/profile updates so orchestration agents consistently use the tool.
7. Integration with EPIC-075 subtask projections so checklist execution aligns with canonical subtask definitions.

Result: agents can maintain a structured checklist during execution, and users can see, trust, and steer progress.

---

## 2. Problem Statement

Current gaps:

1. Agents can reason about plans in free text, but there is no structured, machine-readable todo state.
2. Users cannot reliably see what is pending, active, or complete during long-running steps.
3. Planning discipline varies by profile and prompt quality.
4. Existing tooling (`nexus_orchestrator`, `ask_user_questions`) does not provide a dedicated checklist lifecycle.

Consequences:

1. Lower observability of execution intent.
2. Harder recovery/resume decisions after interruptions.
3. Increased risk of skipped sub-steps in larger tasks.

---

## 3. Goals

1. Add a first-class `manage_todo_list` capability callable by agents.
2. Enforce a strict todo schema and status invariants.
3. Persist todo state for each workflow run and expose it to UI.
4. Provide a reusable skill that tells agents when and how to maintain todo state.
5. Integrate with profile permissions and workflow `allow_tools` policy.
6. Ship with unit, integration, and deterministic E2E coverage.
7. Integrate subtask-backed execution flows from EPIC-075 without violating canonical ownership boundaries.

---

## 4. Non-Goals

1. Replacing kanban work item lifecycle with todo lists.
2. Cross-run/global todo aggregation in v1.
3. Collaborative multi-agent shared todo editing across different runs in v1.
4. AI-generated automatic task decomposition quality scoring in v1.
5. Direct markdown mutation of canonical subtask files from `manage_todo_list` runtime tool calls.

---

## 5. Functional Spec (v1)

### 5.1 Tool Name and Scope

- Tool name: `manage_todo_list`
- Scope: current workflow run (and optionally current step context for display filtering)
- Access: controlled by IAM + capability allowlist + workflow `allow_tools`

### 5.2 Operation Contract

Input shape:

```json
{
  "items": [
    { "id": 1, "title": "Gather context", "status": "completed" },
    { "id": 2, "title": "Implement changes", "status": "in-progress" },
    { "id": 3, "title": "Run tests", "status": "not-started" }
  ],
  "reason": "Optional short progress note"
}
```

Rules:

1. `items` is required and non-empty.
2. `id` must be positive integer, unique, and contiguous starting at 1.
3. `title` is required, non-empty, max length configured (for example 160).
4. `status` enum: `not-started | in-progress | completed`.
5. At most one item may be `in-progress`.
6. Full-replacement semantics in v1 (single source of truth per update).

Output shape:

```json
{
  "ok": true,
  "version": 7,
  "summary": {
    "not-started": 1,
    "in-progress": 1,
    "completed": 1,
    "total": 3
  }
}
```

### 5.3 Suggested Agent Usage Policy

1. Use todo list for tasks expected to require 3 or more meaningful steps.
2. Create/update immediately after planning.
3. Update before and after major transitions (start implementation, start validation, finalization).
4. Keep exactly one `in-progress` item when work is active.
5. Mark all items completed before `step_complete`, unless blocked.

### 5.4 Subtask-Backed Todo Mode (EPIC-075 Integration)

When a run is associated with a work item that has EPIC-075 subtasks, todo mode switches to subtask-backed behavior.

Rules:

1. Initial todo list is seeded from subtask projection ordered by `order_index`.
2. Seeded todo ids are deterministic and reserved for linked subtasks.
3. In subtask-backed mode, agents primarily update status, not list structure.
4. Runtime sync updates subtask projection status from todo status.
5. Canonical markdown subtask files are not written by todo runtime updates.

Status mapping:

1. Subtask `todo` -> todo `not-started`
2. Subtask `in_progress` -> todo `in-progress`
3. Subtask `done` -> todo `completed`
4. Subtask `blocked` -> todo `not-started` plus blocked context in read-model metadata

Drift policy:

1. If subtask projection changes during an active run, todo state is marked stale.
2. Stale state triggers a rebase instruction in agent prompt context and UI warning banner.

---

## 6. Technical Design

### 6.1 Persistence Model

Add a run-scoped todo state table:

- `workflow_run_todo_state`
  - `id` uuid
  - `workflow_run_id` uuid unique
  - `step_id` varchar nullable (latest writer step)
  - `items_json` jsonb
  - `version` int (optimistic concurrency)
  - `updated_by_agent_profile` varchar nullable
  - `updated_at` timestamp

Rationale:

1. Durable resume/replay behavior.
2. Cheap UI retrieval.
3. Auditable update history via event ledger/telemetry events.

### 6.2 API Surface

Internal runtime endpoints:

1. `POST /api/workflow-runtime/manage-todo-list`
   - Validates payload
   - Upserts state
   - Emits telemetry update event
2. `GET /api/workflow-runtime/todo-list`
   - Returns latest state for run

Web/API endpoints:

1. `GET /api/workflows/runs/:runId/todo-list`
2. Optional `DELETE /api/workflows/runs/:runId/todo-list` (admin/debug only; not required in v1)

### 6.3 Tool Registration Path

Use capability manifest and mount pipeline instead of runner-native hardcoding:

1. Add runtime capability entry `manage_todo_list` with `api_callback` transport.
2. Seed into tool registry and policy tags (`mutating`, `progress_tracking`).
3. Allow mounting via existing `ToolMountingService` and `_sdk_tool_allowlist` mechanism.
4. Include tool in selected workflow `allow_tools` sets.

### 6.4 UI Integration

Active session should show a todo panel/card:

1. Ordered task list with status chips.
2. Last updated timestamp/profile.
3. Summary counters.
4. Live updates via telemetry event (or polling fallback).

### 6.5 Skill Integration

Add skill at `seed/skills/todo-execution-discipline/SKILL.md`:

1. Activation criteria (when to use).
2. Required behavior for state updates.
3. Anti-patterns (stale list, multiple in-progress, vague titles).
4. Output expectations and examples.

Assign to profiles that orchestrate or execute multi-step tasks:

1. `ceo-agent`
2. `architect-agent`
3. `senior-dev`
4. `qa-automation`

### 6.6 EPIC-075 Ownership Alignment

Ownership split for integrated behavior:

1. EPIC-075 canonical subtask markdown remains source-of-truth for subtask definitions and ordering.
2. EPIC-075 subtask DB projection remains runtime read model for subtask lifecycle state.
3. EPIC-076 run todo state is execution-scoped checklist projection for the active run.

Sync direction in v1:

1. Bootstrap: subtask projection -> run todo seed.
2. Runtime progress: run todo update -> subtask projection status update.
3. No runtime path writes canonical markdown directly.

Guardrails:

1. Sync is limited to status/progress fields, never identity/path/order fields.
2. Subtask rows remain non-board and non-dispatchable as required by EPIC-075.
3. Failed sync does not silently continue; it emits diagnostics and marks run as requiring intervention.

---

## 7. Workstreams and Task Lists

Each task below is intentionally scoped so it can be created as a single work item and completed independently.

### WS1: Contract and Domain Model

Objective: lock the v1 contract so backend, runner, and web implement against one schema.

#### E076-001 Define canonical todo schema and invariants

- Suggested owner profile: `architect-agent`
- Depends on: none
- Deliverables:
  - schema definition and examples in docs
  - enum/constants in code
  - validation error catalog
- Completion checklist:
  - [ ] Input/output JSON examples documented
  - [ ] Invariants listed and testable
  - [ ] Error responses standardized

#### E076-002 Add architecture doc addendum for run-scoped todo state

- Suggested owner profile: `architect-agent`
- Depends on: E076-001
- Deliverables:
  - update architecture docs with storage and event flow
- Completion checklist:
  - [ ] Lifecycle diagram added
  - [ ] Read/write ownership clear
  - [ ] Security boundary documented

### WS2: Backend Persistence and Runtime API

Objective: store and serve todo state reliably.

#### E076-003 Add entity, repository, migration for workflow run todo state

- Suggested owner profile: `senior-dev`
- Depends on: E076-001
- Deliverables:
  - entity + repository + migration
- Completion checklist:
  - [ ] Migration applies cleanly
  - [ ] Unique run constraint enforced
  - [ ] Version column included

#### E076-004 Implement runtime service for validate-and-upsert

- Suggested owner profile: `senior-dev`
- Depends on: E076-003
- Deliverables:
  - service method for full replacement updates
  - summary counter generation
- Completion checklist:
  - [ ] All invariants enforced server-side
  - [ ] Deterministic summary output
  - [ ] Structured errors returned

#### E076-005 Expose runtime callback endpoint and read endpoint

- Suggested owner profile: `senior-dev`
- Depends on: E076-004
- Deliverables:
  - workflow-runtime controller routes
  - DTOs and validation tests
- Completion checklist:
  - [ ] POST endpoint callable by mounted tool
  - [ ] GET endpoint returns latest state
  - [ ] Authz checks align with existing runtime endpoints

### WS3: Tool Capability and Mount Wiring

Objective: make `manage_todo_list` available to agents through existing capability/mount plumbing.

#### E076-006 Add `manage_todo_list` to capability manifest runtime entries

- Suggested owner profile: `architect-agent`
- Depends on: E076-001
- Deliverables:
  - manifest entry with schema and callback mapping
- Completion checklist:
  - [ ] Tool name and schema match canonical contract
  - [ ] Policy tags set
  - [ ] Callback path verified

#### E076-007 Ensure tool seeding and mount generation include todo tool

- Suggested owner profile: `senior-dev`
- Depends on: E076-006, E076-005
- Deliverables:
  - seed/runtime registration updates
  - mounted metadata validation coverage
- Completion checklist:
  - [ ] Tool appears in mounted manifest when allowed
  - [ ] Tool excluded when denied
  - [ ] No regressions in existing mounted tools

#### E076-008 Update IAM and profile capability policies

- Suggested owner profile: `senior-dev`
- Depends on: E076-006
- Deliverables:
  - policy map updates and tests
- Completion checklist:
  - [ ] Intended profiles allowed
  - [ ] Denied profiles blocked
  - [ ] Policy tests updated

### WS4: Agent Skill and Prompt Instructions

Objective: enforce good agent behavior with explicit skill guidance.

#### E076-009 Author `todo-execution-discipline` skill

- Suggested owner profile: `product-manager` + `architect-agent`
- Depends on: E076-001
- Deliverables:
  - `seed/skills/todo-execution-discipline/SKILL.md`
  - examples for normal, blocked, and resume flows
- Completion checklist:
  - [ ] Frontmatter valid and name matches folder
  - [ ] Clear activation criteria
  - [ ] Includes anti-patterns and recovery guidance

#### E076-010 Assign skill to target agent profiles

- Suggested owner profile: `product-manager`
- Depends on: E076-009
- Deliverables:
  - profile assignment updates in seed data
- Completion checklist:
  - [ ] CEO/orchestration profiles assigned
  - [ ] Execution profiles assigned where needed
  - [ ] Seed validation passes

#### E076-011 Update workflow prompts to require todo updates for complex tasks

- Suggested owner profile: `product-manager`
- Depends on: E076-009
- Deliverables:
  - prompt updates in relevant workflows
- Completion checklist:
  - [ ] Prompt language defines when to use the tool
  - [ ] Prompt language avoids overuse on tiny tasks
  - [ ] Existing behavior remains backward compatible

### WS5: Web UX and Telemetry Visibility

Objective: make todo state visible to users during execution.

#### E076-012 Add run todo API client and state hooks in web app

- Suggested owner profile: `senior-dev`
- Depends on: E076-005
- Deliverables:
  - client methods + hooks
- Completion checklist:
  - [ ] Fetch on session load
  - [ ] Handles empty state
  - [ ] Handles stale/missing run gracefully

#### E076-013 Add active session todo panel with live updates

- Suggested owner profile: `senior-dev`
- Depends on: E076-012
- Deliverables:
  - todo panel component
  - websocket event handling or polling fallback
- Completion checklist:
  - [ ] Ordered rendering by item id
  - [ ] Status chips and counters shown
  - [ ] Update latency acceptable (<2s target)

### WS6: Testing and Rollout

Objective: ship safely with coverage across backend, runtime, and UI.

#### E076-014 Backend unit tests for validation and state transitions

- Suggested owner profile: `qa-automation`
- Depends on: E076-004, E076-005
- Deliverables:
  - tests for invariants and error cases
- Completion checklist:
  - [ ] Duplicate id rejection tested
  - [ ] Multi in-progress rejection tested
  - [ ] Empty/malformed list rejection tested

#### E076-015 Runner integration test for mounted tool callback flow

- Suggested owner profile: `qa-automation`
- Depends on: E076-007
- Deliverables:
  - integration test from tool invocation to persisted state
- Completion checklist:
  - [ ] Tool call succeeds when allowed
  - [ ] Tool call denied when not allowed
  - [ ] Response summary asserted

#### E076-016 Deterministic E2E scenario for visible todo progression

- Suggested owner profile: `qa-automation`
- Depends on: E076-013, E076-015
- Deliverables:
  - E2E test proving list creation, update, and completion visibility
- Completion checklist:
  - [ ] User sees initial list
  - [ ] User sees in-progress shift
  - [ ] User sees all completed before step completion

#### E076-017 Rollout guardrails and runbook

- Suggested owner profile: `architect-agent`
- Depends on: E076-016
- Deliverables:
  - rollout plan and fallback procedure
  - operational runbook entry
- Completion checklist:
  - [ ] Feature flag or staged enablement documented
  - [ ] Monitoring queries/dashboard defined
  - [ ] Incident rollback steps documented

### WS7: EPIC-075 Subtask Integration

Objective: integrate run-scoped todo execution with canonical subtask projections without violating markdown-first ownership.

#### E076-018 Define subtask-to-todo mapping contract and ownership boundaries

- Suggested owner profile: `architect-agent`
- Depends on: E076-001, EPIC-075 E075-016
- Deliverables:
  - integration contract doc with mapping table and drift policy
- Completion checklist:
  - [ ] Mapping rules finalized
  - [ ] Ownership boundaries documented
  - [ ] Failure semantics documented

#### E076-019 Implement todo bootstrap from subtask projection at run start

- Suggested owner profile: `senior-dev`
- Depends on: E076-018, EPIC-075 E075-017
- Deliverables:
  - run initialization hook to seed todo state from subtasks
- Completion checklist:
  - [ ] Deterministic ordering by `order_index`
  - [ ] Empty-subtask fallback behavior covered
  - [ ] Seed behavior is idempotent on resume

#### E076-020 Implement runtime status sync from todo updates to subtask projection

- Suggested owner profile: `senior-dev`
- Depends on: E076-019
- Deliverables:
  - sync service updating allowed subtask runtime fields
- Completion checklist:
  - [ ] Status mapping rules enforced
  - [ ] Protected fields remain immutable
  - [ ] Sync failures emit diagnostics

#### E076-021 Add stale-state drift detection for active runs

- Suggested owner profile: `senior-dev`
- Depends on: E076-020
- Deliverables:
  - drift detector comparing linked subtask projection revision/hash
  - UI/API stale-state indicator
- Completion checklist:
  - [ ] Drift reliably detected
  - [ ] User-facing warning present
  - [ ] Agent prompt rebase instruction injected

#### E076-022 Add integrated E2E for subtask-backed todo lifecycle

- Suggested owner profile: `qa-automation`
- Depends on: E076-021, EPIC-075 E075-021
- Deliverables:
  - deterministic E2E covering seed, progress sync, and completion
- Completion checklist:
  - [ ] Subtask list seeds todo list
  - [ ] Todo updates reflect in subtask projection
  - [ ] Completion consistency holds across UI and runtime

---

## 8. Suggested Delivery Sequence

1. WS1 (contract)
2. WS2 (backend state and endpoints)
3. WS3 (tool exposure and policy)
4. WS4 (skill and prompt behavior)
5. WS5 (UI visibility)
6. WS7 (subtask integration with EPIC-075)
7. WS6 (tests, rollout, release)

Parallelization guidance:

1. WS4 can begin after WS1 while WS2/WS3 are in progress.
2. WS5 can start once WS2 read endpoint shape is stable.
3. WS7 starts once EPIC-075 subtask projection schema stabilizes.
4. WS6 starts with unit tests as each stream lands, then deterministic E2E last.

---

## 9. Risks and Mitigations

1. Risk: agents spam updates and produce noisy telemetry.  
   Mitigation: recommend update cadence in skill; add optional rate-limit warning logs.

2. Risk: stale todo list on crashed runs.  
   Mitigation: display timestamp + agent profile; allow run resume overwrite.

3. Risk: policy drift exposes tool to unintended profiles.  
   Mitigation: explicit IAM tests and capability preflight checks.

4. Risk: confusion with kanban statuses.  
   Mitigation: document that todo list is execution checklist, not project lifecycle state.

5. Risk: subtask drift during active runs creates inconsistent checklist state.  
   Mitigation: revision/hash drift detection with explicit stale-state handling and rebase guidance.

---

## 10. Definition of Done (Epic)

1. `manage_todo_list` tool is callable in allowed workflows and blocked elsewhere.
2. Todo state persists per run and is visible in active session UI.
3. Skill guidance is seeded and assigned to target profiles.
4. Prompt instructions reference the skill/tool behavior for complex tasks.
5. Unit + integration + deterministic E2E suites pass for touched areas.
6. Runbook and rollout notes are published.
7. Subtask-backed runs seed todo state from EPIC-075 subtask projection.
8. Todo status updates synchronize to allowed subtask runtime projection fields with drift protection.

---

## 11. Candidate File Touch List (Planning Aid)

API:

1. `apps/api/src/tool/capability-manifest.runtime.entries.ts`
2. `apps/api/src/workflow/workflow-runtime-tools.service.ts`
3. `apps/api/src/workflow/workflow-runtime-tools.controller.ts`
4. `apps/api/src/database/entities/*todo*.entity.ts` (new)
5. `apps/api/src/database/repositories/*todo*.repository.ts` (new)
6. `apps/api/src/database/migrations/*todo*.ts` (new)
7. `apps/api/src/workflow/*subtask*` (EPIC-075 projection integration points)

Runner:

1. No runner-native hardcoding required in v1 if using API callback mounted tool.
2. Optional future enhancement: runner-native wrapper tool for reduced latency.

Web:

1. `apps/web/src/lib/api/client.ts`
2. `apps/web/src/lib/api/types.ts`
3. `apps/web/src/pages/active-session/*`
4. `apps/web/src/hooks/*todo*` (new)
5. work-item detail surfaces that render EPIC-075 subtasks alongside run todo state

Seed/skills/workflows:

1. `seed/skills/todo-execution-discipline/SKILL.md` (new)
2. `seed/agents/*/agent.json`
3. Relevant workflow yaml files in `seed/workflows/`

---

## 12. Cross-Epic Dependencies (EPIC-075)

Hard dependencies for integrated delivery:

1. EPIC-075 E075-016 (subtask schema and identity rules).
2. EPIC-075 E075-017 (subtask reconcile behavior).
3. EPIC-075 E075-019 (API/realtime nested subtask payloads).
4. EPIC-075 E075-021 (agent context injection for subtasks).

Recommended sequencing:

1. Land E075-016 and E075-017 before E076-019 implementation.
2. Land E075-019 before E076-021 UI drift warning integration.
3. Validate E075-021 and E076-022 together in deterministic E2E.
