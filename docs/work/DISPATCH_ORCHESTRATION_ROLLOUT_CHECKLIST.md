# Dispatch Orchestration Rollout Checklist

## Scope

This checklist verifies the migration from legacy dispatch reconcile/start events
into Kanban-owned dispatch and lifecycle actions.

## Pre-Deployment Checks

- Confirm no runtime references remain to retired dispatch artifacts:
  - `work_item.dispatch.reconcile`
  - `WorkItemDispatchStartEvent`
- Confirm `work_item_todo_dispatch_default.workflow.yaml` is active and uses the Kanban-owned `kanban.dispatch_selected_work_items` tool.
- Confirm invoke guardrails are active in `ProjectOrchestrationService`:
  - bootstrap workflows are blocked from `invoke_agent_workflow` while status is `orchestrating`.

## API Validation

- Run targeted orchestration service tests:
  - `npm run test -- src/project/project-orchestration.service.spec.ts`
- Verify dispatch capacity is enforced:
  - Kanban-owned dispatch only starts up to remaining active slots.
- Verify supervised mode approval path:
  - dispatch request is persisted in `project_orchestration_action_requests`.

## Web Validation

- Run Dispatch tab tests:
  - `npm run test:unit -- src/pages/project-workspace/DispatchTab.spec.tsx`
- Confirm Dispatch tab shows orchestration decision log entries and pending approvals.
- Confirm no UI code depends on `WorkItemDispatchSelectEvent` or `WorkItemDispatchStartEvent`.

## Post-Deployment Monitoring

- Review project orchestration decision logs for dispatch actions:
  - `action_executed`
  - `action_queued_for_approval`
  - `action_execution_failed`
- Verify pending dispatch approvals are visible and actionable in the Orchestration tab.
- Track rate of failed dispatch actions and investigate repeated correlation IDs with failures.
