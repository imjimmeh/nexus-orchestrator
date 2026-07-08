# Dispatch Polling Runbook

## Scope

Operational runbook for EPIC-056 dispatch polling and per-agent capacity behavior.

## Key Settings

System setting keys:

- work_item_dispatch_polling_enabled
- work_item_dispatch_poll_interval_seconds
- work_item_dispatch_poll_batch_size
- work_item_dispatch_max_active_per_project

## Key Endpoints

- GET /projects/:projectId/orchestration/diagnostics
- GET /projects/:projectId/orchestration/agent-capacities
- PUT /projects/:projectId/orchestration/agent-capacities/:agentProfileId
- DELETE /projects/:projectId/orchestration/agent-capacities/:agentProfileId

## Baseline Verification

1. Confirm polling enabled setting is true.
2. Confirm poll interval and batch size are within expected range.
3. Confirm diagnostics endpoint shows recent poll activity.
4. Confirm capacity rows are present where per-agent constraints are expected.

## Common Incident Patterns

1. No dispatch progression despite todo items

- Check dependency blockers in project state.
- Check active-slot saturation (project max active and per-agent max active).
- Check polling enabled flag and recent poll tick data.

2. Dispatch over-assignment concerns

- Verify server-side capacity checks in diagnostics and decision telemetry.
- Verify conflicting manual status transitions are not bypassing orchestrated flow.

3. Intermittent dispatch inactivity

- Check Redis/BullMQ health.
- Check poll consumer liveness and queue backlog.

## Recovery Actions

1. Re-enable polling setting if disabled unexpectedly.
2. Correct invalid per-agent capacity entries.
3. Trigger reconcile through normal lifecycle transitions when appropriate.
4. Restart API/worker services only after confirming queue/connectivity issues.

## Closure Checklist

1. Diagnostics show healthy poll ticks.
2. Capacity summaries match expected project policy.
3. Todo items with satisfied dependencies are eventually selected.
4. No uncontrolled dispatch beyond configured slot limits.

## Related Docs

- docs/architecture/ARCH-kanban-workflow.md
- docs/architecture/rest-api.md
- docs/epics/EPIC-056-capacity-aware-work-polling-true-kanban.md
