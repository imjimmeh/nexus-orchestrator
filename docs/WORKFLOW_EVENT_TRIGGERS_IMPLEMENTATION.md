# Workflow Event Triggers Implementation Notes

This document captures implementation-level behavior for event-triggered workflows.

## 1. Registration Lifecycle

WorkflowEventTriggerService performs registration during module initialization.

Process:

1. Load active workflow definitions.
2. Parse YAML definitions.
3. Filter workflows where trigger.type is event.
4. Register listeners using trigger.name.

Result:

- Event listeners are dynamically derived from workflow definitions.
- No hardcoded listener class is required per workflow.

## 2. Execution Path

When an event is emitted:

1. Listener receives event object/payload.
2. Payload is transformed into trigger state variables.
3. WorkflowEngineService.startWorkflow is invoked for matching workflow(s).
4. Run state persists trigger payload for template resolution.

## 3. Current Platform Event Usage

### Kanban lifecycle

- kanban.work_item.status_changed.v1

Expected canonical status event payload contract:

- event
- scopeId
- contextId
- workItemId
- status
- previousStatus
- actor
- resource (full work-item snapshot used by seeded workflows)

### Dispatch orchestration

- work_item.dispatch.reconcile
- WorkItemDispatchSelectEvent
- ProjectOrchestrationCycleRequestedEvent

### Orchestration startup/restart continuity

- ProjectOrchestrationStartedEvent with isRestart and stateSummary

### Periodic CEO cycle path (EPIC-056 Option A)

- Dispatch polling consumer emits ProjectOrchestrationCycleRequestedEvent with source `dispatch_poll`.
- Lifecycle/work-item completion paths emit ProjectOrchestrationCycleRequestedEvent with source markers (`work_item_done`, `resume`, `bootstrap_completed`, `self_heal`).
- `project_orchestration_cycle_ceo` is triggered by ProjectOrchestrationCycleRequestedEvent.

## 4. Template Binding Considerations

Trigger payload fields should be accessed defensively in templates.

Recommended pattern:

1. Use explicit job inputs to normalize names.
2. Avoid direct deep access without defaults when fields may be absent.
3. Keep restart-specific prompt blocks conditional on is_restart/isRestart.

## 5. Restart Context Propagation (EPIC-058)

Expected propagation chain:

1. Orchestration start computes restart context summary.
2. ProjectOrchestrationStartedEvent includes isRestart and stateSummary.
3. Discovery/cycle workflows map these into job inputs.
4. Prompt templates branch behavior using restart flags.

## 6. Operational Validation

After introducing or updating event-triggered workflows:

1. Confirm startup registration logs include workflow ID and event name.
2. Emit synthetic or real event and confirm workflow run creation.
3. Verify trigger payload values in run state.
4. Confirm downstream prompts/jobs consume mapped inputs correctly.

## 7. Known Gaps to Track

1. Keep trigger docs and architecture docs synchronized when adding new lifecycle events.
2. Ensure event payload additions remain backward compatible for existing templates.
3. Keep deterministic tests for restart-context scenarios and dispatch-routing scenarios.
4. Validate that kanban status transitions emit `kanban.work_item.status_changed.v1` with enriched payloads; seeded lifecycle workflows depend on `trigger.resource`, `trigger.status`, and `trigger.previousStatus`.
5. Track and remove contradictory workflow permission entries where the same tool is listed in both allow_tools and deny_tools (for example, read in work_item_in_progress_default job implement_and_commit).

## 8. Related Docs

- docs/WORKFLOW_EVENT_TRIGGERS.md
- docs/architecture/workflow-engine.md
- docs/epics/EPIC-056-capacity-aware-work-polling-true-kanban.md
- docs/epics/EPIC-058-ceo-agent-context-continuity-on-restart.md
