# Design: Autonomous Project Orchestrator (CEO Agent)

**Date:** 2026-04-04
**Status:** Draft (self-reviewed)
**Epic:** EPIC-046 (proposed)

---

## Overview

Introduce a **CEO Agent** that acts as an intelligent project orchestrator for each Nexus project. It replaces the mechanical `WorkItemDispatchCoordinatorService` with an LLM-driven orchestration loop that:

1. **Bootstraps** a new project via an interactive goal-clarification session → generates PRD + SDD → pauses for human approval → creates work items via the spec-generator
2. **Orchestrates** the running project by evaluating state after each work item completes and autonomously deciding: dispatch more items, revise remaining specs, request an architect review, ask the user for input, or declare the project complete

The design follows the existing "everything is workflows and agents" pattern: the CEO is a new **agent profile** plus **three focused YAML workflow definitions**, backed by a new **`ProjectOrchestration` DB entity** for clean, queryable state.

---

## What We're Replacing / Retiring

| Removed | Replaced By |
|---------|-------------|
| `WorkItemDispatchCoordinatorService` | CEO orchestration cycle workflow |
| `WorkItemDispatchSelectorService` | CEO agent selected dispatch call, now superseded by `kanban.dispatch_selected_work_items` |
| `work-item-todo-dispatch-default.workflow.yaml` | CEO orchestration cycle |

The `WorkItemDispatchCoordinatorService` and `WorkItemDispatchSelectorService` will be **deleted**, not deprecated.

---

## Architecture

### Three-Workflow Bootstrap Pipeline

The approval gate is handled **between** workflows (not inside one), avoiding cyclic DAG issues:

```
[ProjectOrchestrationStartedEvent]
    ↓
Workflow A: CEO Discovery + Spec Generation
    ↓ (sets status = awaiting_approval)
[Human reviews PRD/SDD in UI]
    ↓  POST /orchestration/approve  →  [ProjectOrchestrationApprovalGrantedEvent]
    ↓  POST /orchestration/reject   →  [ProjectOrchestrationRevisionRequestedEvent]
Workflow B: CEO Spec Revision (triggered on rejection, re-runs discovery from feedback)
    ↓ (sets status = awaiting_approval again)
    [Human approves]
    ↓
Workflow C: Work Item Generation + Orchestration Start
    (triggered by ProjectOrchestrationApprovalGrantedEvent)
    ↓ (emits WorkItemDoneEvent-equivalent to kick off first cycle)

[WorkItemDoneEvent] (each time a work item reaches 'done')
    ↓
Workflow D: CEO Orchestration Cycle (ongoing)
```

---

### New Database Entity: `ProjectOrchestration`

One record per project. Tracks the CEO's lifecycle and decision history.

```
project_orchestrations
├── id (uuid, PK)
├── project_id (uuid, FK → projects, unique)
├── status ('idle' | 'initializing' | 'awaiting_approval' | 'bootstrapping' | 'orchestrating' | 'paused' | 'completed' | 'failed')
├── goals (text, nullable)                — user's free-form project vision
├── revision_feedback (text, nullable)    — feedback from rejected specs (cleared on approval)
├── orchestration_mode ('autonomous' | 'supervised' | 'notifications_only', default: 'supervised')
├── strategy_summary (text, nullable)    — CEO's running high-level strategy
├── current_workflow_run_id (varchar, nullable) — active CEO workflow run
├── decision_log (jsonb, nullable)       — array of {timestamp, type, reasoning, actions[]}
├── metadata (jsonb, nullable)           — flexible future extension
├── created_at, updated_at
```

`orchestration_mode` provides future flexibility but only `supervised` (pause-and-wait) is implemented initially.

---

### New Agent Profile: `ceo-agent`

```typescript
{
  name: 'ceo-agent',
  tier_preference: 'heavy',
  allowed_tools: [
    'read_file',
    'write_file',
    'query_memory',
    'nexus_orchestrator',
    'kanban.dispatch_selected_work_items', // selected dispatch
    'get_project_state',            // new CEO tool
    'submit_orchestration_decision',// new CEO tool
    'update_project_strategy',      // new CEO tool
    'invoke_agent_workflow',        // new CEO tool
    'complete_orchestration',       // new CEO tool
  ],
  system_prompt: // See agent profile file for full prompt
}
```

**System prompt responsibilities:**
- Discovery phase: Engage in focused dialogue, ask one question at a time, get explicit agreement before writing specs
- Spec generation: Write production-ready PRD + SDD (stored via `write_file` to temp paths, then persisted)
- Orchestration cycle: Review project state, decide strategically, call `submit_orchestration_decision` before acting

---

### New Events

```typescript
// Fired when CEO is activated for a project (starts bootstrap)
ProjectOrchestrationStartedEvent(projectId, orchestrationId, goals)

// Fired when the user rejects the generated specs (starts revision)
ProjectOrchestrationRevisionRequestedEvent(projectId, orchestrationId, feedback)

// Fired when the user approves specs (starts work item generation)
ProjectOrchestrationApprovalGrantedEvent(projectId, orchestrationId)

// Fired when a work item reaches 'done' status (triggers CEO cycle)
WorkItemDoneEvent(projectId, workItemId)

// Fired at end of work item generation (triggers first CEO cycle)
ProjectOrchestrationBootstrapCompletedEvent(projectId, orchestrationId)
```

`WorkItemDoneEvent` is emitted in `WorkItemService.updateStatus()` when `toStatus === 'done'`.

---

### New WebSocket Tool Actions (added to `telemetry.gateway.ts`)

These follow the existing selected-dispatch and `step_complete` patterns:

| WebSocket message | What it does |
|-------------------|--------------|
| `get_project_state` | Returns work items grouped by status + dependency info for the project |
| `submit_orchestration_decision` | Appends to `ProjectOrchestration.decision_log`, returns ok |
| `update_project_strategy` | Updates `ProjectOrchestration.strategy_summary` |
| `invoke_agent_workflow` | Starts a workflow by ID (e.g., PM revision, architect review) via WorkflowEngineService |
| `complete_orchestration` | Sets status = `completed` on `ProjectOrchestration` |

---

### Workflow A: `project-discovery-ceo.workflow.yaml`

**Trigger:** `ProjectOrchestrationStartedEvent`
**Concurrency:** 1 per `projectId` (skip-on-conflict)

```yaml
workflow_id: project_discovery_ceo
name: CEO — Project Discovery & Spec Generation
trigger:
  type: event
  name: ProjectOrchestrationStartedEvent
concurrency:
  scope: "project:{{ trigger.projectId }}"
  policy: skip

jobs:
  - id: discovery_session
    type: execution
    tier: heavy
    inputs:
      agent_profile: ceo-agent
    steps:
      - id: clarify_goals
        type: agent
        prompt: |
          Begin a project discovery session for project {{ trigger.projectId }}.

          User's initial goals:
          {{ trigger.goals }}

          Your task: Ask focused clarifying questions one at a time to understand:
          - The core problem being solved
          - Target users and their needs
          - Success criteria and measurable outcomes
          - Key constraints and explicit non-goals

          When you and the user are in full agreement on requirements,
          call nexus_orchestrator with step_complete and include a structured
          summary of agreed requirements as your output.

  - id: generate_prd_sdd
    type: execution
    tier: heavy
    depends_on: [discovery_session]
    inputs:
      agent_profile: ceo-agent
    steps:
      - id: write_specs
        type: agent
        prompt: |
          Based on the discovery summary:
          {{ steps.discovery_session.output.summary }}

          Generate a comprehensive PRD and SDD for project {{ trigger.projectId }}.

          {{#if trigger.revision_feedback}}
          NOTE: This is a revision. Address this feedback from the previous version:
          {{ trigger.revision_feedback }}
          {{/if}}

          - Use write_file to save PRD to docs/PRD.md
          - Use write_file to save SDD to docs/SDD.md
          - The project's prdMarkdown and sddMarkdown fields will be updated
            automatically from these files after your step completes.

          When done, call nexus_orchestrator step_complete with a brief summary
          of what was written.

  - id: set_awaiting_approval
    type: emit_event
    tier: light
    depends_on: [generate_prd_sdd]
    inputs:
      event_name: ProjectOrchestrationSpecsReadyEvent
      payload:
        projectId: "{{ trigger.projectId }}"
        orchestrationId: "{{ trigger.orchestrationId }}"
```

*Note: `ProjectOrchestrationService` listens to `ProjectOrchestrationSpecsReadyEvent` and sets status = `awaiting_approval`.*

---

### Workflow B: `project-spec-revision-ceo.workflow.yaml`

**Trigger:** `ProjectOrchestrationRevisionRequestedEvent`
**Concurrency:** 1 per `projectId` (skip-on-conflict)

This is structurally identical to Workflow A but the discovery is skipped (requirements are already agreed) and the revision feedback is surfaced to the CEO. In practice, this workflow re-runs Workflow A's `generate_prd_sdd` job with `revision_feedback` populated in the trigger context.

---

### Workflow C: `project-work-item-generation-ceo.workflow.yaml`

**Trigger:** `ProjectOrchestrationApprovalGrantedEvent`
**Concurrency:** 1 per `projectId` (skip-on-conflict)

```yaml
workflow_id: project_work_item_generation_ceo
name: CEO — Work Item Generation
trigger:
  type: event
  name: ProjectOrchestrationApprovalGrantedEvent

jobs:
  - id: generate_work_items
    type: execution
    tier: heavy
    inputs:
      agent_profile: spec-generator
    steps:
      - id: decompose_specs
        type: agent
        prompt: |
          Read the PRD (docs/PRD.md) and SDD (docs/SDD.md) for project
          {{ trigger.projectId }} and decompose them into concrete, actionable
          work items using the create_work_items tool.

          Group items logically, set appropriate priorities and dependencies.
          When all work items are created, call nexus_orchestrator step_complete.

  - id: emit_bootstrap_complete
    type: emit_event
    tier: light
    depends_on: [generate_work_items]
    inputs:
      event_name: ProjectOrchestrationBootstrapCompletedEvent
      payload:
        projectId: "{{ trigger.projectId }}"
        orchestrationId: "{{ trigger.orchestrationId }}"
```

*Note: `ProjectOrchestrationService` listens to `ProjectOrchestrationBootstrapCompletedEvent` and sets status = `orchestrating`. The orchestration cycle workflow (D) also triggers on this event.*

---

### Workflow D: `project-orchestration-cycle-ceo.workflow.yaml`

**Trigger:** `WorkItemDoneEvent` AND `ProjectOrchestrationBootstrapCompletedEvent`
**Concurrency:** 1 per `projectId` (skip-on-conflict — prevents duplicate CEO decisions)

```yaml
workflow_id: project_orchestration_cycle_ceo
name: CEO — Orchestration Cycle
trigger:
  type: event
  name: WorkItemDoneEvent
concurrency:
  scope: "project:{{ trigger.projectId }}"
  policy: skip  # If CEO is already deciding, skip duplicate triggers

jobs:
  - id: check_orchestration_active
    type: check_orchestration_status   # New special step (see below)
    tier: light
    inputs:
      project_id: "{{ trigger.projectId }}"
      required_status: orchestrating

  - id: ceo_decision_cycle
    type: execution
    tier: heavy
    depends_on: [check_orchestration_active]
    inputs:
      agent_profile: ceo-agent
    steps:
      - id: evaluate_and_decide
        type: agent
        prompt: |
          A project event has occurred in {{ trigger.projectId }}.
          {{ #if trigger.workItemId }}
          Completed work item: {{ trigger.workItemId }}
          {{ /if }}

          Use get_project_state to review the full project status, then decide:

          1. Are there work items ready to dispatch? → kanban.dispatch_selected_work_items
          2. Does completed work reveal spec gaps? → invoke_agent_workflow (PM revision)
          3. Is an architectural review warranted? → invoke_agent_workflow (architect)
          4. Do you need user input? → invoke_agent_workflow (user question)
          5. Is the project complete? → complete_orchestration
          6. Nothing needed right now? → step_complete with reason

          Always call submit_orchestration_decision with your reasoning before
          taking any action. Then call step_complete when done.
```

---

### New Special Step: `check_orchestration_status`

A lightweight special step that reads `ProjectOrchestration` status and fails the job (without failing the workflow run) if the project is not in the expected state (e.g., if orchestration is paused or completed). This prevents stale `WorkItemDoneEvent` triggers from firing CEO cycles after orchestration is paused.

```typescript
// Returns { ok: true } if status matches, { ok: false, reason: string } otherwise
// The workflow can then use transitions to gracefully skip the cycle
```

---

### New API: `ProjectOrchestrationController`

All routes under `/projects/:projectId/orchestration`:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/start` | Activate CEO: `{ goals: string, orchestration_mode?: string }` |
| `GET` | `/` | Get orchestration state, current status, decision log |
| `PATCH` | `/` | Update orchestration mode |
| `POST` | `/approve` | Approve specs → emits `ProjectOrchestrationApprovalGrantedEvent` |
| `POST` | `/reject` | Reject specs with feedback → emits `ProjectOrchestrationRevisionRequestedEvent` |
| `POST` | `/pause` | Pause ongoing orchestration (sets status = paused) |
| `POST` | `/resume` | Resume paused orchestration (re-triggers orchestration cycle) |

---

## Files to Create

### Backend
```
apps/api/src/database/entities/project-orchestration.entity.ts
apps/api/src/database/repositories/project-orchestration.repository.ts
apps/api/src/database/repositories/project-orchestration.repository.spec.ts
apps/api/src/database/migrations/<timestamp>-create-project-orchestration.ts
apps/api/src/project/project-orchestration.service.ts
apps/api/src/project/project-orchestration.service.spec.ts
apps/api/src/project/project-orchestration.service.types.ts
apps/api/src/project/project-orchestration.controller.ts
apps/api/src/project/project-orchestration.controller.spec.ts
apps/api/src/project/dto/start-orchestration.dto.ts
apps/api/src/project/dto/reject-orchestration.dto.ts
apps/api/src/project/events/project-orchestration.events.ts
apps/api/src/project/events/work-item-done.event.ts
apps/api/src/workflow/step-check-orchestration-status-special-step.handler.ts
apps/api/src/workflow/step-check-orchestration-status-special-step.handler.spec.ts
apps/api/src/database/seeds/agent-profiles/profiles/ceo.profile.ts
apps/api/src/database/seeds/project-discovery-ceo.workflow.yaml
apps/api/src/database/seeds/project-spec-revision-ceo.workflow.yaml
apps/api/src/database/seeds/project-work-item-generation-ceo.workflow.yaml
apps/api/src/database/seeds/project-orchestration-cycle-ceo.workflow.yaml
```

### Files to Modify
```
apps/api/src/project/work-item.service.ts
  — emit WorkItemDoneEvent when status transitions to 'done'

apps/api/src/telemetry/telemetry.gateway.ts
  — add CEO WebSocket handlers: get_project_state, submit_orchestration_decision,
    update_project_strategy, invoke_agent_workflow, complete_orchestration

apps/api/src/telemetry/telemetry-gateway-compat.helpers.ts
  — implement new CEO tool action handlers

apps/api/src/workflow/step-special-step.types.ts
  — add 'check_orchestration_status' type

apps/api/src/workflow/step-special-step-executor.service.ts
  — register new handler

apps/api/src/workflow/workflow.module.ts
  — register new handler

apps/api/src/project/project.module.ts
  — register ProjectOrchestrationService, Controller, Repository

apps/api/src/database/seeds/agent-profiles/agent-profile-definitions.provider.ts
  — add ceo-agent to AGENT_PROFILE_SEED_DEFINITIONS

apps/api/src/database/seeds/agent-profiles/index.ts
  — export ceo profile

apps/api/src/project/work-item-dispatch.events.ts
  — add new event constants or move to shared events file
```

### Files to Delete
```
apps/api/src/project/work-item-dispatch-coordinator.service.ts
apps/api/src/project/work-item-dispatch-coordinator.service.spec.ts
apps/api/src/project/work-item-dispatch-selector.service.ts
apps/api/src/project/work-item-dispatch-selector.service.spec.ts (if exists)
apps/api/src/database/seeds/work-item-todo-dispatch-default.workflow.yaml
```

---

## TDD Implementation Order

1. **`ProjectOrchestration` entity + repository** — unit tests for CRUD
2. **`WorkItemDoneEvent` emission** — update existing `work-item.service.spec.ts` to verify event emitted on `done` transition
3. **`ProjectOrchestrationService`** — unit tests: start, approve, reject, pause, resume, status transitions
4. **`check_orchestration_status` special step handler** — unit tests with mocked repo
5. **CEO WebSocket tool actions** — unit tests in telemetry gateway compat helpers
6. **`ceo-agent` seed profile** — add to definitions, update `agent-profiles.seed.spec.ts`
7. **`ProjectOrchestrationController`** — controller unit tests
8. **Delete dispatch coordinator + selector** — update all import references, remove from `project.module.ts`
9. **Workflow YAML files** — workflow validation tests for each new YAML
10. **Integration: E2E flow** — manual verification per the verification section

---

## Verification

### E2E Manual Flow

1. Create a project (no goals yet)
2. `POST /projects/:id/orchestration/start` with `{ goals: "Build a todo app with user auth" }`
3. Verify `ProjectOrchestration` record created with `status = initializing`
4. Observe Workflow A starts (check `/workflows/runs/:runId`)
5. Answer CEO's clarifying questions via the existing question-answers WebSocket
6. Verify PRD/SDD written to project (`GET /projects/:id/specs`)
7. Verify orchestration status = `awaiting_approval`
8. `POST /projects/:id/orchestration/approve` → verify Workflow C starts
9. Verify work items appear in the project's backlog
10. Verify first CEO orchestration cycle triggers and dispatches first work items (status = in-progress)
11. Simulate a work item completing (`done` status via PATCH) → verify CEO cycle triggers
12. Check decision log: `GET /projects/:id/orchestration`

### Unit Test Coverage Required
- `ProjectOrchestrationService`: all status transitions valid/invalid
- `ProjectOrchestrationService`: approve emits correct event, reject populates revision_feedback
- `WorkItemDoneEvent`: emitted in `work-item.service.ts` on `done` transition only
- `check_orchestration_status` handler: passes when status matches, skips gracefully when not
- CEO WebSocket tools: `get_project_state` returns grouped items, `submit_orchestration_decision` appends to log
- `ProjectOrchestrationController`: all endpoints, authorization guards

---

## Key Design Decisions

**Three workflows instead of one with loops** — The approval revision cycle (approve → reject → revise → approve) would require a cyclic DAG, which the existing `DAGResolverService` rejects. Breaking into separate event-triggered workflows keeps each one acyclic, observable, and independently restartable.

**CEO replaces dispatch coordinator entirely** — The coordinator's dependency-checking logic and capacity awareness move into the CEO agent's prompt context (via `get_project_state` which includes dependency info and a count of active items).

**`orchestration_mode` field** — Enables future autonomous/supervised/notifications_only modes as a config field without a schema change.

**`check_orchestration_status` special step** — Prevents stale `WorkItemDoneEvent` triggers from running CEO cycles on paused or completed projects without failing the overall workflow run.

**`decision_log` on entity** — Makes CEO decisions visible without requiring an event sourcing query. Capped at ~100 entries in the service layer.

**Keep `work-item-post-merge-spec-hydration`** — The CEO can `invoke_agent_workflow` to trigger it. It remains a reusable building block.

---

## Out of Scope (Future Epics)

- Frontend UI for CEO chat/approval flow
- CEO managing multiple projects simultaneously
- CEO spawning parallel sub-agents (EPIC-045)
- `autonomous` and `notifications_only` orchestration modes
- CEO rollback capability (undo a dispatch decision)
- CEO memory across orchestration cycles (persistent strategy document)
