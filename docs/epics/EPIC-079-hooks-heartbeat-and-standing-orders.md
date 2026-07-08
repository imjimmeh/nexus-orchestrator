# EPIC-079: Hooks, Heartbeat, and Standing Orders

Status: Done
Priority: P1
Depends On: EPIC-078, EPIC-062, EPIC-070
Last Updated: 2026-04-12

---

## 1. Summary

Add higher-level automation primitives on top of current workflow/event runtime:

1. Event hooks for lifecycle-triggered actions.
2. Heartbeat jobs for periodic context-aware checks.
3. Standing orders injected into runtime context as persistent operator policy.

All features are implemented including core runtime, API, and web UI.

---

## 2. Problem

Today automation is either direct workflow triggers or manual actions. There is no opinionated automation layer for:

1. Periodic context-aware monitoring turns.
2. Declarative event hooks with guardrails.
3. Persistent run-time policy instructions outside prompts.

---

## 3. Goals

1. Add hook registry with scoped trigger types and action handlers.
2. Add heartbeat engine with due-only task checks.
3. Add standing-order storage and injection into runtime context payloads.
4. Ensure all actions are auditable and policy-enforced.

## 4. Non-Goals

1. Full external channel heartbeat delivery.
2. Arbitrary shell script execution from hooks in v1.
3. Replacing workflow YAML orchestration.

---

## 5. Architecture

### 5.1 Hooks

Hook definition model:

1. id, project_id, enabled, trigger_type, trigger_filter, priority
2. action_type (invoke_workflow, emit_event, record_metadata)
3. action_payload, cooldown_window_seconds

Supported trigger types initially:

1. workflow.run.started
2. workflow.run.failed
3. work_item.status.changed
4. project.orchestration.completed

### 5.2 Heartbeat

1. Add heartbeat profile per project.
2. Queue periodically runs heartbeat evaluator.
3. Evaluator compiles due checks and invokes configured workflow or runtime action.

### 5.3 Standing Orders

1. Add persistent standing-order records per project and optional profile.
2. Inject standing orders into project brief and runtime context payloads.
3. Provide allow/deny policy flags to control override behavior.

### 5.4 API

1. /automation/hooks
2. /automation/heartbeat
3. /automation/standing-orders

---

## 6. Workstreams

1. Hook registry and execution handler.
2. Heartbeat scheduler and due-check runner.
3. Standing-order persistence and runtime injection.
4. UI management for hooks and heartbeat policy.
5. Audit and diagnostics endpoints.

---

## 7. Backlog

- [x] E079-001 Add automation_hooks entity and migration.
- [x] E079-002 Add hook trigger-to-action dispatcher with cooldown support.
- [x] E079-003 Add heartbeat profile entity and scheduler consumer.
- [x] E079-004 Add standing-order entity and retrieval service.
- [x] E079-005 Inject standing orders in project brief and workflow runtime tools.
- [x] E079-006 Add API endpoints for hooks, heartbeat, and standing orders.
- [x] E079-007 Add UI for hook list/editor, heartbeat config, and standing orders.
- [x] E079-008 Add audit events for hook firing and heartbeat runs.
- [x] E079-009 Add tests for policy enforcement and cooldown behavior.

---

## 8. Acceptance Criteria

1. Operators can define hooks that trigger deterministic actions.
2. Heartbeat checks run on configured cadence and only when due.
3. Standing orders are visible in runtime context and influence behavior.
4. Hook and heartbeat executions are observable in diagnostics.

---

## 9. Risks and Mitigation

1. Hook storms from high-frequency triggers.
   - Mitigate with cooldown windows and per-trigger rate caps.
2. Policy ambiguity between standing orders and prompts.
   - Mitigate with explicit precedence rules and diagnostics.
