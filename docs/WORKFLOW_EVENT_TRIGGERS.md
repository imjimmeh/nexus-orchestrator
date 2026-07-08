# Workflow Event Triggers

This guide documents current event-triggered workflow behavior and contracts.

## 1. Trigger Declaration

Workflow YAML declares trigger activation directly:

- trigger.type: event
- trigger.name: EventClassName

Example:

trigger:
type: event
name: ProjectOrchestrationStartedEvent

At startup, WorkflowEventTriggerService registers all active event-triggered workflows.

## 2. Trigger Payload Contract

Event payload values are available under trigger.\* inside workflow jobs.

Canonical Kanban lifecycle status payload fields:

- trigger.event
- trigger.scopeId
- trigger.contextId
- trigger.workItemId
- trigger.status
- trigger.previousStatus
- trigger.actor
- trigger.resource
- trigger.resource.executionConfig

Kanban lifecycle status workflows subscribe to `kanban.work_item.status_changed.v1` and expect `trigger.resource` to contain the full work-item snapshot.

The resource object is used heavily by seeded workflows for fields such as
title, scope, priority, description, metadata, and executionConfig.

## 3. Kanban Lifecycle Event Mapping

Status transitions emit one canonical event, `kanban.work_item.status_changed.v1`. Status-specific workflows subscribe to that event and route through workflow-owned conditions over `trigger.status`.

Current mappings:

- `trigger.status == "refinement"` -> `work_item_refinement_default`
- `trigger.status == "in-progress"` -> `work_item_in_progress_default`
- `trigger.status == "in-review"` -> `work_item_in_review_default`
- `trigger.status == "ready-to-merge"` -> `work_item_ready_to_merge_default`
- `trigger.status == "refinement"` and large-scope split condition -> `work_item_split_default`

Dispatch note:

- Kanban-owned dispatch tooling can send todo items to refinement or in-progress depending on pre-flight policy.

Implementation status:

- Event listener registration handles the canonical status-change event.
- Kanban status-transition paths emit `kanban.work_item.status_changed.v1` with enriched payloads, including `trigger.resource`.

## 4. Dispatch and Scheduling Event Contracts

Common orchestration/dispatch events:

- work_item.dispatch.reconcile
- WorkItemDispatchSelectEvent
- ProjectOrchestrationCycleRequestedEvent
- ProjectOrchestrationRefinementRequestedEvent
- ProjectOrchestrationRefinementCompletedEvent
- work_item.dispatch.decision (telemetry)

These coordinate candidate selection, capacity checks, and dispatch decision observability.

ProjectOrchestrationCycleRequestedEvent payload (key fields):

- projectId
- workItemId
- goals
- source (`work_item_done`, `resume`, `bootstrap_completed`, `self_heal`, `dispatch_poll`)
- reason
- isRestart
- stateSummary

## 5. Restart Continuity Event Contract (EPIC-058)

ProjectOrchestrationStartedEvent includes restart context fields:

- isRestart
- stateSummary

Workflows can map these to explicit job inputs, for example:

- state_summary: {{trigger.stateSummary}}
- is_restart: {{trigger.isRestart}}

Recommended behavior:

1. Gate restart-only guidance with is_restart.
2. Use state_summary as a context preamble.
3. Avoid re-running discovery/spec delegation when summary indicates completed artifacts.

Cycle parity guidance:

1. Map trigger.stateSummary and trigger.isRestart in cycle workflows as explicit inputs.
2. Use source/reason fields to distinguish poll-driven cycles from work-item-driven cycles.

## 6. Example: Restart-Aware Discovery Trigger

trigger:
type: event
name: ProjectOrchestrationStartedEvent

jobs:

- id: discovery
  type: execution
  inputs:
  is_restart: "{{trigger.isRestart}}"
  state_summary: "{{trigger.stateSummary}}"

## 7. Operational Notes

1. Event names are contract keys; changing them requires coordinated workflow updates.
2. Trigger payload compatibility should be versioned through additive fields when possible.
3. Validate trigger registration at startup logs when introducing a new event workflow.

## 8. Troubleshooting Checklist

1. Confirm workflow is active in DB.
2. Confirm trigger.type is event and trigger.name matches emitted class name exactly.
3. Confirm event is emitted in application logs.
4. Confirm run was created and trigger payload contains expected fields.
5. Confirm downstream job templates reference existing trigger keys.

## 9. Related Docs

- docs/WORKFLOW_EVENT_TRIGGERS_IMPLEMENTATION.md
- docs/architecture/workflow-engine.md
- docs/architecture/ARCH-kanban-workflow.md
