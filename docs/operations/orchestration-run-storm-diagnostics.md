# Orchestration Run Storm Diagnostics

Use this runbook when imported-project orchestration appears to launch repeated CEO cycles, automatic wakeups, or delegated agent workflows for the same project.

## Symptoms

- Multiple `project_orchestration_cycle_ceo` runs appear close together for one project.
- `core_lifecycle_stream`, `orchestration_continuation_reconciler`, and `revision_complete` wakeups all request cycles after a terminal run.
- A project remains in `blocked`, `pause`, or `complete` decision state but automatic wakeups continue.
- Delegated agent workflows lack a launch dedupe key or concurrency scope.
- Kanban integration tests fail before test execution with `Could not find a working container runtime strategy`.

## Fast Checks

Replace `<project-id>` with the Kanban project UUID.

```powershell
docker exec nexus-postgres psql -U nexus -d nexus_orchestrator -c "select workflow_id, status, launch_dedupe_key, concurrency_scope, created_at from workflow_runs where state_variables::text like '%<project-id>%' order by created_at desc limit 20;"
docker exec nexus-postgres psql -U nexus -d nexus_orchestrator -c "select event_name, payload->>'dedupeKey', payload->>'source', payload->>'reason', occurred_at from event_ledger where payload::text like '%<project-id>%' and event_name = 'ProjectOrchestrationCycleRequestedEvent' order by occurred_at desc;"
docker exec nexus-postgres psql -U nexus -d nexus_orchestrator -c "select project_id, run_id, status, updated_at from kanban_core_run_projections where run_id in (select id::text from workflow_runs where state_variables::text like '%<project-id>%') order by updated_at desc;"
```

Expected healthy signals:

- Repeated automatic cycle requests within 60 seconds are coalesced instead of emitted.
- Automatic wakeups from core lifecycle, stale reconciliation, and revision completion stop after a latest cycle decision of `blocked`, `pause`, or `complete`.
- Manual/admin wakeups still work through explicit manual sources.
- Delegated default agent workflows include `launch_dedupe_key` and concurrency scope based on `trigger.dedupeKey`.
- Scope-only lifecycle contexts still write `kanban_core_run_projections.project_id`.

## Verification Commands

Run these from the repository root after changing orchestration wakeup or delegation behavior.

```powershell
npm run build --workspace=packages/core
npm run test --workspace=apps/api -- workflow-runtime-orchestration-actions.service.spec.ts workflow-engine.service.spec.ts workflow-run.repository.spec.ts workflow-concurrency-manager.service.spec.ts workflow-core-lifecycle-stream.listener.spec.ts
npm run test --workspace=apps/kanban -- project-orchestration-wakeup.service.spec.ts orchestration.service.spec.ts orchestration-continuation-reconciler.service.spec.ts core-run-projection.service.spec.ts core-lifecycle-stream.consumer.spec.ts workflows.seed.contract.spec.ts
npm run validate:seed-data
npm run build:api
npm run build:kanban
npm run test:integration:kanban-core
```

If `test:integration:kanban-core` fails before running `imported-project-recovery.integration-spec.ts` with `Could not find a working container runtime strategy`, verify Docker first:

```powershell
docker version
docker ps
docker compose up -d --build
```

Docker server API 500s indicate a local Docker Desktop/engine issue. Restart Docker Desktop and rerun the integration/live verification before concluding the integration path is broken.

## Live Recovery Notes

If the stack is healthy but old rows still reflect pre-fix behavior, distinguish existing historical state from new behavior:

- Existing duplicate workflow runs are not automatically removed by the code fix.
- Existing stale orchestration metadata can be migrated by recording a later wakeup; valid legacy stale wakeup metadata is preserved into `lastStaleWakeup` before `lastWakeup` is overwritten.
- If a project must be repaired immediately, first collect the SQL evidence above, then use the Kanban/API admin path appropriate for the stuck orchestration rather than deleting rows directly.
