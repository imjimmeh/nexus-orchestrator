# Workflow Required-Tools Audit Runbook

This runbook covers how to audit required-tool compliance for any workflow run.

## What Is Available

Required-tools auditing is now persisted in two places:

1. `workflow_events` event types:
   - `job.required_tools.satisfied`
   - `job.required_tools.missing`
   - `job.required_tools.retry_enqueued`
   - `job.required_tools.exhausted`
  - `job.output_contract.satisfied`
  - `job.output_contract.missing`
  - `job.output_contract.exhausted`
2. Migration-seeded SQL view:
   - `workflow_run_required_tools_audit_v1`

Queue-time requirements are also captured on `job.queued` payloads:

- `requiredToolCalls`
- `outputTool`
- `outputContract`
- `workflowToolPolicy`
- `jobToolPolicy`

## Migration Seed Source

The audit view is created by migration:

- `apps/api/src/database/migrations/20260408220000-create-workflow-run-required-tools-audit-view.ts`

And registered in:

- `apps/api/src/database/migrations/registered-migrations.ts`

With default API configuration (`TYPEORM_MIGRATIONS_RUN != false`), this view is seeded automatically at startup.

## API Endpoint

Use this endpoint for a compact run-level summary:

- `GET /api/workflow-runs/:runId/audit-summary`

Controller:

- `apps/api/src/workflow/workflow-event-log.controller.ts`

## SQL Examples

### 1) Compact summary for a run

```sql
SELECT
  workflow_run_id,
  run_status,
  queued_jobs_count,
  queued_jobs_with_required_tools,
  required_tools_satisfied_count,
  required_tools_missing_count,
  required_tools_retry_enqueued_count,
  required_tools_exhausted_count,
  output_contract_satisfied_count,
  output_contract_missing_count,
  output_contract_exhausted_count
FROM workflow_run_required_tools_audit_v1
WHERE workflow_run_id = 'REPLACE_RUN_ID'::uuid;
```

### 2) Inspect queued expectations + tool policy

```sql
SELECT
  event_type,
  job_id,
  payload->'requiredToolCalls' AS required_tool_calls,
  payload->>'outputTool' AS output_tool,
  payload->'outputContract' AS output_contract,
  payload->'workflowToolPolicy' AS workflow_tool_policy,
  payload->'jobToolPolicy' AS job_tool_policy
FROM workflow_events
WHERE workflow_run_id = 'REPLACE_RUN_ID'
  AND event_type = 'job.queued'
ORDER BY timestamp;
```

### 3) Inspect required-tools decision events

```sql
SELECT
  event_type,
  job_id,
  payload
FROM workflow_events
WHERE workflow_run_id = 'REPLACE_RUN_ID'
  AND event_type IN (
    'job.required_tools.satisfied',
    'job.required_tools.missing',
    'job.required_tools.retry_enqueued',
    'job.required_tools.exhausted',
    'job.output_contract.satisfied',
    'job.output_contract.missing',
    'job.output_contract.exhausted'
  )
ORDER BY timestamp;
```

## Incident Triage Checklist

1. Confirm run status in `workflow_runs`.
2. Confirm each required job emitted `job.queued` with expected `requiredToolCalls` and `outputTool`.
3. Confirm required-tools events exist and are consistent with run outcome.
4. If run fails, check for `job.required_tools.exhausted` and `job.output_contract.exhausted` payloads and retry counters.
5. Cross-check mirrored `event_ledger` records when auditing end-to-end traceability.
