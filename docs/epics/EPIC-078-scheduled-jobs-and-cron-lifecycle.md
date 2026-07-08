# EPIC-078: Scheduled Jobs and Cron Lifecycle

Status: Done
Priority: P0
Depends On: EPIC-005, EPIC-009, EPIC-056
Last Updated: 2026-04-12

---

## 1. Summary

Add first-class scheduled automation to the existing API and web app:

1. Create, edit, pause, resume, run now, list, and remove schedules.
2. Support one-time, interval, and cron schedules.
3. Execute schedules by invoking existing workflow runs and record run history.

This closes a major Hermes/OpenClaw parity gap without requiring service split.

Current implementation status (2026-04-12):

1. Core schema, runtime, API surface, and web UI are implemented.
2. Non-e2e validation is passing for lint, unit tests, and builds.
3. Deterministic e2e coverage is deferred by current execution directive.

---

## 2. Problem

Current platform has repeat jobs for internal operations (dispatch polling, cleanup) but no user-facing scheduling surface for product automation.

Missing today:

1. Persistent schedule model.
2. API contracts for schedule lifecycle.
3. Execution history and diagnostics for scheduled work.

---

## 3. Goals

1. Deliver a schedule registry in API with complete lifecycle operations.
2. Reuse WorkflowEngineService for execution instead of adding a separate runtime.
3. Add run history and failure metadata for operations visibility.
4. Add web UI management for schedules per project.

## 4. Non-Goals

1. Multi-channel delivery targets.
2. New external broker technology.
3. Task-flow DAG automation (covered by later epic).

---

## 5. Architecture

### 5.1 Data Model

Add entities:

1. scheduled_jobs
   - id, project_id, name, status, schedule_type, schedule_expression, timezone
   - execution_target_type (workflow)
   - execution_target_ref (workflow_id)
   - payload_json
   - created_by, updated_by
2. scheduled_job_runs
   - id, scheduled_job_id, status, triggered_at, started_at, finished_at
   - workflow_run_id
   - error_code, error_message, diagnostics_json

### 5.2 Runtime

1. Add scheduled-jobs BullMQ queue and consumer.
2. Tick cadence configurable via system settings.
3. On due job, invoke WorkflowEngineService.startWorkflow with stored payload.
4. Record run outcome and backoff metadata.

### 5.3 API

1. POST /automation/schedules
2. GET /automation/schedules
3. GET /automation/schedules/:id
4. PATCH /automation/schedules/:id
5. POST /automation/schedules/:id/pause
6. POST /automation/schedules/:id/resume
7. POST /automation/schedules/:id/run-now
8. DELETE /automation/schedules/:id
9. GET /automation/schedules/:id/runs

### 5.4 UI

1. Add Schedules panel under project workspace.
2. Show status, next run, last run, failure badge.
3. Add create/edit modal with expression validation preview.

---

## 6. Workstreams

1. Schema and migration.
2. Queue runtime and due-job evaluator.
3. API controllers/services/DTOs.
4. UI schedule management.
5. Integration tests and deterministic schedule tests.

---

## 7. Backlog

- [x] E078-001 Add scheduled_jobs and scheduled_job_runs entities and migration.
- [x] E078-002 Add schedule expression parser and validator with timezone support.
- [x] E078-003 Add queue and due-job consumer.
- [x] E078-004 Add API endpoints and DTO validation.
- [x] E078-005 Add workflow invocation adapter and idempotency guard.
- [x] E078-006 Add schedule run history query API.
- [x] E078-007 Add project workspace schedules UI.
- [x] E078-008 Add API integration tests and failure-path tests.
- [x] E078-009 Add operations dashboard counters for schedule success and failure rates.

---

## 8. Acceptance Criteria

1. Users can create and manage schedules through API and UI.
2. Due jobs trigger workflow runs reliably.
3. Paused schedules never execute.
4. Run history includes success and failure diagnostics.
5. Deterministic tests cover lifecycle and retry behavior.

---

## 9. Risks and Mitigation

1. Duplicate executions under race conditions.
   - Mitigate with job idempotency keys and unique due-run keys.
2. Invalid cron expressions causing runtime crashes.
   - Mitigate with strict parser validation and safe defaults.

---

## 10. Validation Snapshot (2026-04-12)

1. `npm run lint:api` passed.
2. `npm run lint:web` passed.
3. `npm run lint` passed.
4. `npm run test:api` passed.
5. `npm run test:unit:web` passed.
6. `npm run build:api` passed.
7. `npm run build:web` passed.
8. `npm run test:e2e:kanban:deterministic` is intentionally deferred in the current execution phase.
