# EPIC: Capacity-Aware Work Polling (True Kanban Pull)

**Epic ID:** EPIC-056  
**Status:** In Progress (implementation complete; final global validation gates pending)  
**Created:** 2026-04-05  
**Last Updated:** 2026-04-06  
**Priority:** P0 - Critical  
**Theme:** Orchestration Throughput and WIP Governance

## 1. Executive Summary

The current orchestration and dispatch model is mostly event-driven. Capacity checks exist at dispatch execution time, but there is no persistent background polling loop that periodically evaluates project WIP and agent availability when no new lifecycle event arrives.

This epic introduces a true Kanban pull loop:

- a background polling worker that regularly evaluates orchestration projects,
- deterministic capacity/dependency gating,
- CEO-led periodic dispatch decisions,
- and optional per-agent idle assignment so available developer agents are utilized continuously.

### 1.1 Implementation State (2026-04-06)

Current implementation status is:

- Completed (backend):
  - Dispatch coordinator path is in-source and active.
  - Polling queue/service/consumer path is implemented (`dispatch-polling`).
  - Poll controls are available through system settings:
    - `work_item_dispatch_polling_enabled`
    - `work_item_dispatch_poll_interval_seconds`
    - `work_item_dispatch_poll_batch_size`
  - Per-agent capacity persistence is implemented via `project_agent_capacities`.
  - Per-agent capacity CRUD endpoints are available under project orchestration routes.
  - Dispatch mutation flow accepts optional assignments and emits assignment-failure telemetry.
  - Orchestration diagnostics include polling and dispatch-capacity snapshots.
  - Polling now emits `ProjectOrchestrationCycleRequestedEvent` for periodic CEO capacity-cycle checks (Option A path).

- Completed (web):
  - Orchestration runtime health UI surfaces dispatch polling status and dispatch capacity snapshot.

- Remaining follow-up:
  - Final global validation gates (full lint/build/compose-e2e) should be re-run to close the epic.

## 2. Current-State Findings (Codebase Review at Proposal Time)

This section captures the original baseline used to draft the epic. For current delivery status, use Section 1.1.

### 2.1 What Already Exists

- `work_item_dispatch_max_active_per_project` exists as a system setting and is enforced at dispatch mutation boundaries.
- `ProjectOrchestrationService.dispatchStartWorkItems` caps starts by remaining active slots (`in-progress`, `in-review`, `ready-to-merge`).
- `work_item.dispatch.reconcile` events are emitted from work-item mutations and deferred retry paths.
- Event-triggered workflows are dynamically registered from persisted workflow YAML definitions.
- Historical baseline: the orchestration cycle workflow (`project_orchestration_cycle_ceo`) supported CEO decisions and mutating actions through the old `dispatch_start_work_items` action. Current selected starts use the Kanban-owned `kanban.dispatch_selected_work_items` boundary.

### 2.2 Gaps Relevant to This Epic (Historical)

- No active source service in `apps/api/src/project` currently consumes `work_item.dispatch.reconcile` to emit dispatch selection requests; coordinator logic exists only in recovered files under `tmp/recovered`.
- No periodic polling worker evaluates capacity in the absence of upstream events.
- Capacity is modeled per project only; there is no first-class model for per-agent capacity/availability.
- Current dispatch mutation path starts work items but does not perform explicit idle-agent selection/assignment behavior.

## 3. Goals and Non-Goals

### 3.1 Goals

- Add a periodic, background capacity polling loop (cron/queue worker style).
- Keep dispatch workflow-driven and mode-policy compliant.
- Preserve hard server-side WIP cap enforcement.
- Add optional per-agent idle assignment so tickets can be bound to available dev agents.
- Provide observability for poll decisions and skips.

### 3.2 Non-Goals

- Replacing existing event-driven triggers (polling complements, not replaces).
- Building a full workforce management system.
- Multi-project global optimization beyond project-local pull.

## 4. Proposed Design

### 4.1 Reinstate Dispatch Coordinator as Core Reconcile Engine

Restore and integrate coordinator logic from recovered implementation:

- Add `apps/api/src/project/work-item-dispatch-coordinator.service.ts`.
- Wire it in `ProjectModule` providers.
- Keep project-level lock semantics to avoid duplicate reconcile races.
- Consume:
  - `work_item.dispatch.reconcile`
  - workflow-run status changes (for retry/safety cases)
  - spec-generation completion events
- Emit:
  - `WorkItemDispatchSelectEvent` with slots and dependency-ready candidates
  - `work_item.dispatch.decision` telemetry for every reconcile outcome

This becomes the single in-source path for candidate selection event emission.

### 4.2 Add Background Capacity Polling Worker

Add a dedicated polling worker that runs even when no lifecycle event fires.

Recommended implementation:

- New queue: `dispatch-polling` (BullMQ repeatable job).
- New service: `WorkItemDispatchPollingService` (scheduler/producer).
- New consumer: `WorkItemDispatchPollingConsumer` (performs project-scoped reconcile enqueue/dispatch).
- Poll loop fetches projects currently in `orchestrating` state and emits reconcile for each project.
- Use per-project idempotency key (`projectId + pollTickBucket`) to avoid duplicate poll-triggered reconciles.

System settings (new):

- `work_item_dispatch_polling_enabled` (default: true in non-prod rollout, configurable)
- `work_item_dispatch_poll_interval_seconds` (default: 30)
- `work_item_dispatch_poll_batch_size` (default: 50)

### 4.3 CEO Periodic Capacity Evaluation

Provide explicit CEO periodic checks while reusing existing orchestration logic.

Option A (preferred):

- Poll worker emits synthetic orchestration-cycle trigger event (new event contract) mapped to a dedicated CEO capacity-cycle workflow.
- Workflow enforces `concurrency: max_runs=1, scope=projectId` to avoid overlapping CEO cycles.

Option B (simpler fallback):

- Poll worker emits dispatch reconcile only; dispatch selector workflow handles pull decisions.

Design decision target: use Option A for true CEO periodic review, keep Option B as fallback/kill-switch path.

### 4.4 Per-Agent Capacity and Idle Assignment

Introduce optional agent-level pull constraints.

Data model (new table/entity):

- `project_agent_capacities`
  - `id`
  - `project_id`
  - `agent_profile_id` (or runtime agent identifier)
  - `max_active_items`
  - `is_enabled`
  - timestamps

Assignment algorithm:

1. Compute project remaining slots from project WIP cap.
2. Compute per-agent free slots from assigned active items.
3. Select dependency-ready candidate items.
4. Assign candidates to idle agents (deterministic order).
5. Execute Kanban-owned selected dispatch (`kanban.dispatch_selected_work_items`) with optional assignment context when supported by the current Kanban dispatch contract.

Mutation extension:

- Extend dispatch payload to accept assignment tuples:
  - `assignments: [{ work_item_id, assigned_agent_id }]`
- Update status transition to persist `assignedAgentId` when provided.

Backward compatibility:

- If no agent-capacity rows exist, behavior remains project-cap only.

### 4.5 Observability and Diagnostics

Add structured telemetry for poll-driven decisions:

- `work_item.dispatch.poll_tick` (batch stats, scanned projects, duration)
- `work_item.dispatch.decision` (existing) enriched with `source: event|poll`, `idleAgentCount`, `assignedCount`
- `work_item.dispatch.assignment_failed` for invalid/unavailable agent assignment attempts

Expose diagnostics endpoint additions:

- last poll timestamp
- last poll outcome per project
- current slots and idle-agent summary

### 4.6 UI and App Review Follow-Through

Update workspace UI to make pull behavior visible:

- Dispatch tab:
  - show poll-triggered runs and decision outcomes
  - show capacity snapshot (active/max, available slots, idle agents)
- Orchestration tab diagnostics:
  - show whether polling is enabled
  - show pending capacity blockers vs dependency blockers

## 5. Implementation Plan

### Phase 1: Coordinator Reintegration

- Move recovered coordinator service/spec into `apps/api/src/project`.
- Fix imports/wiring for current module layout.
- Add missing provider registration in `project.module.ts`.
- Ensure event constants/types used by coordinator are current.

Acceptance criteria:

- Reconcile events produce `WorkItemDispatchSelectEvent` in-source.
- Decision telemetry emits on skipped/dispatched outcomes.
- Existing dispatch workflows receive expected payload contract (`slots`, `candidates`).

### Phase 2: Polling Worker Foundation

- Add polling queue registration and worker services.
- Add project listing query for orchestrating projects in `ProjectOrchestrationRepository`.
- Add settings and defaults for polling controls.

Acceptance criteria:

- Poll worker runs at configured interval.
- Only orchestrating projects are scanned.
- Poll ticks trigger reconcile without duplicate storms.

### Phase 3: CEO Periodic Cycle

- Implement dedicated capacity-cycle workflow trigger path.
- Add concurrency guard (`max_runs: 1` per project).
- Ensure mode-policy behavior remains enforced for mutating actions.

Acceptance criteria:

- CEO decision cycle can run even when no work-item completion event occurs.
- Autonomous/supervised/notifications modes behave consistently with current policy.

### Phase 4: Per-Agent Capacity and Assignment

- Add entity, migration, repository, CRUD surface for agent capacity config.
- Extend dispatch action payload and mutation handling for assignments.
- Add deterministic idle-agent selection logic.

Acceptance criteria:

- Example behavior works: 3 agents, 2 busy, 1 idle -> exactly 1 eligible ticket assigned and started.
- No assignment occurs when all agents are at capacity.
- Project-level cap and agent-level cap are both respected.

### Phase 5: Diagnostics, UI, and Docs

- Expand diagnostics and dispatch timeline payloads.
- Update web dispatch/orchestration views to show poll/assignment state.
- Update API README and architecture docs.

Acceptance criteria:

- Operator can explain why dispatch happened or did not happen from UI + diagnostics.
- Polling controls and status are visible.

## 6. Testing Strategy

### 6.1 Unit Tests

- Coordinator candidate filtering and decision emission.
- Poll scheduler cadence and idempotency guards.
- Agent assignment algorithm (idle/busy/mixed).
- Dispatch mutation parsing for assignment payload.

### 6.2 Integration Tests

- Poll tick triggers reconcile and emits selection event.
- Mode-policy interactions (supervised queues action, autonomous executes).
- Concurrency behavior under bursty poll + event overlap.

### 6.3 E2E Tests

- Scenario: no lifecycle events for N minutes but capacity opens; poller still dispatches.
- Scenario: 3-agent pool where one becomes idle and receives next ticket.
- Scenario: dependency-blocked candidates remain unstarted until dependencies done.

### 6.4 Regression Suite

- Existing Kanban lifecycle deterministic E2E remains green.
- Existing orchestration cycle and action approval flows remain green.

## 7. Risks and Mitigations

- Risk: Polling creates duplicate/overlapping dispatch cycles.
  - Mitigation: project-level lock in coordinator + workflow concurrency + queue idempotency keys.

- Risk: Multi-instance deployments over-poll the same project.
  - Mitigation: BullMQ repeatable job + per-project dedupe key + optional Redis lock.

- Risk: Agent assignment introduces invalid IDs or stale availability.
  - Mitigation: validate assignments server-side; fallback to unassigned starts when invalid.

- Risk: Drift between event-driven and poll-driven behavior.
  - Mitigation: force both paths through the same coordinator reconcile method.

## 8. Deliverables

- Reintegrated dispatch coordinator service in source.
- New polling worker and queue wiring.
- Optional per-agent capacity model and assignment extension.
- Updated workflows for periodic CEO capacity checks.
- Extended diagnostics and UI capacity visibility.
- Unit/integration/e2e coverage.
- Updated architecture/API docs.

## 9. Definition of Done

- System periodically evaluates orchestrating projects and pulls work when capacity exists.
- Dispatch decisions remain dependency-safe and capacity-bounded.
- Optional agent pool mode assigns tickets to idle agents deterministically.
- Operator visibility is sufficient to audit each dispatch/skip decision.
- Full relevant test suites pass, including lifecycle and dispatch e2e paths.
