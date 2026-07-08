---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: automation
outcome: success
inferred_status: implemented
confidence_score: 0.87
evidence_refs:
  - apps/api/src/automation/automation.module.ts
  - apps/api/src/automation/automation-hooks.service.ts
  - apps/api/src/automation/automation-hooks.controller.ts
  - apps/api/src/automation/automation-hooks.listener.ts
  - apps/api/src/automation/automation-hooks.action.ts
  - apps/api/src/automation/automation-hooks.utils.ts
  - apps/api/src/automation/scheduled-jobs.service.ts
  - apps/api/src/automation/scheduled-jobs-runner.service.ts
  - apps/api/src/automation/scheduled-jobs-polling.service.ts
  - apps/api/src/automation/scheduled-jobs.consumer.ts
  - apps/api/src/automation/scheduled-jobs.controller.ts
  - apps/api/src/automation/schedule-expression.service.ts
  - apps/api/src/automation/heartbeat.service.ts
  - apps/api/src/automation/heartbeat-runner.service.ts
  - apps/api/src/automation/standing-orders.service.ts
  - apps/api/src/automation/automation-hooks.action.spec.ts
  - apps/api/src/automation/automation-hooks.listener.spec.ts
  - apps/api/src/automation/automation-hooks.utils.spec.ts
  - apps/api/src/automation/schedule-expression.service.spec.ts
  - apps/api/src/automation/scheduled-jobs.consumer.spec.ts
  - apps/api/src/automation/scheduled-jobs-polling.service.spec.ts
  - apps/api/src/automation/database/entities/automation-hook.entity.ts
  - apps/api/src/automation/database/entities/scheduled-job.entity.ts
  - apps/api/src/automation/database/entities/heartbeat-profile.entity.ts
  - apps/api/src/automation/database/entities/standing-order.entity.ts
source_paths:
  - apps/api/src/automation
  - apps/api/src/runtime
updated_at: 2026-06-02T00:00:00.000Z
---

# Probe Result: Automation and Scheduling

## Narrative Summary

The automation and scheduling scope is **fully implemented** across four feature areas: event-driven Automation Hooks, cron/interval-based Scheduled Jobs, interval-based Heartbeat Profiles, and persistent Standing Orders. All four are wired as NestJS-managed services within a single `AutomationModule`, share TypeORM-backed persistence, and integrate with the workflow engine via the `WORKFLOW_ENGINE_SERVICE` port. BullMQ drives polling-based schedule evaluation (default 30-second tick) while `@OnEvent` decorators handle event-triggered hook dispatch.

## Capability Updates

### Automation Hooks

| Capability | Status | Notes |
|---|---|---|
| Hook CRUD (create/list/get/update/delete) | ✅ Implemented | `AutomationHooksController` → `AutomationHooksService`; scopeId + trigger filter scoping |
| Event-driven dispatch | ✅ Implemented | `AutomationHooksListener` subscribes to `WORKFLOW_RUN_STARTED_EVENT` and `WORKFLOW_RUN_FAILED_EVENT` via `@OnEvent` |
| Manual dispatch | ✅ Implemented | `AutomationHooksService.dispatchHooks` accepts triggerType + scopeId + payload |
| Trigger filter matching | ✅ Implemented | `matchesTriggerFilter` — dot-notation path traversal with JSON equality |
| Cooldown window | ✅ Implemented | `isWithinCooldownWindow` — seconds-based deduplication |
| Priority ordering | ✅ Implemented | Repository index on `(scopeId, enabled, priority)` |
| Action: `INVOKE_WORKFLOW` | ✅ Implemented | Resolves workflow ID, calls `workflowEngineService.startWorkflow` |
| Action: `RECORD_METADATA` | ✅ Implemented | No-op with audit event (stateless) |
| Workflow existence validation | ✅ Implemented | Validates workflow is active before hook creation/update |
| Audit events | ✅ Implemented | `emitHookDispatchSucceeded/Failed/Skipped/CooldownSkippedAudit` via `EventLedgerService` |

### Scheduled Jobs

| Capability | Status | Notes |
|---|---|---|
| Job CRUD (create/list/get/update/delete) | ✅ Implemented | `ScheduledJobsController` → `ScheduledJobsService` |
| Pause / Resume | ✅ Implemented | Sets `paused_at`; resume recomputes `next_run_at` |
| Run Now (manual trigger) | ✅ Implemented | `ScheduledJobsRunnerService.runScheduledJobNow` |
| Schedule types: `CRON` | ✅ Implemented | `cron-parser` library; timezone-aware via IANA names |
| Schedule types: `INTERVAL` | ✅ Implemented | Integer seconds, min 5s; catch-up computation for missed ticks |
| Schedule types: `ONE_TIME` | ✅ Implemented | ISO date-time; future-only enforcement |
| Polling driver | ✅ Implemented | `ScheduledJobsPollingService` programs BullMQ repeat job (default 30 s, configurable) |
| Batch processing | ✅ Implemented | `ScheduledJobsRunnerService.processDueSchedules` with configurable batch size |
| Idempotent run creation | ✅ Implemented | `advanceNextRunIfDue` claim pattern prevents duplicate runs |
| Run history (list runs) | ✅ Implemented | `ScheduledJobsService.listScheduledJobRuns` |
| Workflow start integration | ✅ Implemented | `workflowEngineService.startWorkflow` with `scheduled.job` trigger event and `scheduledJobId`/`scheduledRunId` context |
| Error classification | ✅ Implemented | `workflow_not_started` (concurrency skip), `workflow_start_failed` (dispatch error) |
| Settings overrides | ✅ Implemented | `scheduled_jobs_enabled`, `scheduled_jobs_poll_interval_seconds`, `scheduled_jobs_poll_batch_size` |

### Heartbeat Profiles

| Capability | Status | Notes |
|---|---|---|
| Profile CRUD | ✅ Implemented | `HeartbeatService` with `HeartbeatRunnerService` for execution |
| Interval-based scheduling | ✅ Implemented | `interval_seconds >= 10`; `computeNextRunAt` on each dispatch |
| Run Now | ✅ Implemented | `HeartbeatRunnerService.runHeartbeatNow` |
| Batch polling | ✅ Implemented | `processDueHeartbeats` with claim pattern matching scheduled jobs |
| Run history | ✅ Implemented | `HeartbeatService.listHeartbeatRuns` |
| Workflow dispatch | ✅ Implemented | `heartbeat.run` trigger event with `heartbeatProfileId`/`heartbeatRunId` context |
| Audit events | ✅ Implemented | `automation.heartbeat.run.dispatched/skipped/failed` via `EventLedgerService` |

### Standing Orders

| Capability | Status | Notes |
|---|---|---|
| Standing Order CRUD | ✅ Implemented | `StandingOrdersService` with `StandingOrdersController` |
| Profile-name filtering | ✅ Implemented | `findByScopeId` supports optional `profileName` filter |
| Override policy | ✅ Implemented | `OVERRIDE`, `ADVISORY`, `MANDATORY` via `StandingOrderOverridePolicy` enum |
| Runtime query | ✅ Implemented | `getRuntimeStandingOrders(scopeId, profileName?)` returns `RuntimeStandingOrderView[]` |
| Text validation | ✅ Implemented | Max lengths: title 180, instruction unbounded, profile_name 120 |

### Schedule Expression Service

| Capability | Status | Notes |
|---|---|---|
| Cron expression parsing | ✅ Implemented | `cron-parser`; timezone-normalized via `Intl.DateTimeFormat` |
| Interval normalization | ✅ Implemented | Integer seconds, min 5s |
| One-time date parsing | ✅ Implemented | `Date.parse` + future-only guard |
| Next-run computation | ✅ Implemented | Initial + post-execution catch-up for intervals |
| Timezone validation | ✅ Implemented | IANA timezone via `Intl.DateTimeFormat`; defaults to UTC |

## Health Findings

### Test Coverage

- **`automation-hooks.action.spec.ts`**: Covers action payload validation (missing workflowId), `RECORD_METADATA` no-op, and `INVOKE_WORKFLOW` workflow-not-found error cases.
- **`automation-hooks.listener.spec.ts`**: Covers scopeId extraction from state variables, WORKFLOW_RUN_STARTED and WORKFLOW_RUN_FAILED event dispatch, and graceful failure on dispatch errors.
- **`automation-hooks.utils.spec.ts`**: Covers `isWithinCooldownWindow` (in-window, out-of-window, zero cooldown) and `matchesTriggerFilter` (null filter, dot-path key, value equality including nested objects).
- **`schedule-expression.service.spec.ts`**: Comprehensive — covers all three schedule types, timezone normalization, catch-up arithmetic for intervals, and cron boundary conditions.
- **`scheduled-jobs.consumer.spec.ts`**: Covers unknown-job filtering, disabled polling returning empty metrics, and batch size override.
- **`scheduled-jobs-polling.service.spec.ts`**: Covers disabled setting blocking queue registration and min-interval enforcement.

### Missing Tests

- `heartbeat-runner.service.spec.ts` — `HeartbeatRunnerService` has no dedicated test file; run dispatch, skip, and fail paths are unverified at unit level.
- `standing-orders.service.spec.ts` — No test file for `StandingOrdersService` CRUD or `getRuntimeStandingOrders`.
- `scheduled-jobs.service.spec.ts` — No test file for `ScheduledJobsService` pause/resume/update logic.
- `scheduled-job-run-status.listener.spec.ts` — Listener exists but was not read; unverified.
- `automation-hooks.service.spec.ts` — Full dispatch orchestration path not unit-tested.

### Code Quality

- TypeORM entities implement interfaces from `@nexus/core` (`IAutomationHook`, `IScheduledJob`, `IHeartbeatProfile`, `IStandingOrder`).
- All services accept interface-typed dependencies, enabling testability and substitution.
- BullMQ `Processor`/`WorkerHost` pattern correctly separates polling scheduler (`ScheduledJobsPollingService`) from worker (`ScheduledJobsConsumer`).
- Claim-pattern (`advanceNextRunIfDue`) used by both scheduled jobs and heartbeats to prevent duplicate run creation.
- No entity migrations present in `apps/api/src/database/migrations/` — likely managed by prior migration phases not reviewed here.
- `WorkflowFailureDoctorHookBootstrapService` is a no-op stub that merely logs its disabled status.
- Standing orders have a runtime retrieval path (`getRuntimeStandingOrders`) but it is not wired into the workflow runtime tools surface (the `workflow-runtime.md` probe noted `resolveStandingOrders` returns an empty array).

### Index Coverage

| Entity | Index | Scope |
|---|---|---|
| `automation_hooks` | `idx_automation_hooks_scope_trigger` | `(scopeId, trigger_type)` |
| `automation_hooks` | `idx_automation_hooks_scope_enabled_priority` | `(scopeId, enabled, priority)` |
| `scheduled_jobs` | `idx_scheduled_jobs_scope_status_next_run` | `(schedule_scope, status, next_run_at)` |
| `scheduled_jobs` | `idx_scheduled_jobs_status_next_run` | `(status, next_run_at)` |
| `heartbeat_profiles` | `idx_heartbeat_profiles_scope_enabled_next_run` | `(scopeId, enabled, next_run_at)` |
| `heartbeat_profiles` | `idx_heartbeat_profiles_workflow` | `(workflow_id)` |
| `standing_orders` | `idx_standing_orders_scope_enabled_priority` | `(scopeId, enabled, priority)` |
| `standing_orders` | `idx_standing_orders_scope_profile` | `(scopeId, profile_name)` |

Note: `scheduled-job.entity.ts` defines `idx_scheduled_jobs_scope_status_next_run` twice with different column sets (one uses `schedule_scope`, the other uses `scopeId`) — likely an unintentional duplicate index name that should be renamed.

## Open Questions

1. **Standing orders not wired to workflow runtime**: `StandingOrdersService.getRuntimeStandingOrders` exists and is exported, but the workflow runtime tools (`resolveStandingOrders`) returns an empty array. The integration path needs to be completed.
2. **`WorkflowFailureDoctorHookBootstrapService` is disabled**: The service is a no-op placeholder; the failure-doctor hook bootstrap is not yet functional.
3. **Missing entity migrations in review scope**: No automation/heartbeat/standing-order migration files found in `apps/api/src/database/migrations/`. The migration was likely applied in a prior phase and not part of this probe scope.
4. **Duplicate index name in `ScheduledJob` entity**: `idx_scheduled_jobs_scope_status_next_run` is declared twice with different column sets — this should be resolved.
5. **Heartbeat and standing orders lack unit test files**: Dispatch paths and CRUD logic for these two features are unverified at the unit level.