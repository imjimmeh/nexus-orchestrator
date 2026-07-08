# 43 — Repair Diagnostics: Operator Guide

This guide walks through diagnosing and recovering stuck or failed workflow runs. Use it when:

- A workflow run is stuck in `RUNNING` state with no visible progress
- A run is marked `FAILED` and you want to understand why repair did not fire
- The repair agent is not responding to failures
- You want to manually trigger a doctor repair action

---

## Quick Reference: Which Tool to Use

| Symptom                                   | First tool                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------- |
| Run stuck in RUNNING                      | Step 4 (Reconciliation state) → Doctor check `workflow_stuck_state_detector` |
| Run marked FAILED, no repair              | Step 2 (Event ledger) — check classification and eligibility                 |
| Multiple runs failing with similar errors | Step 1 (Doctor) — check queue lag and container integrity                    |
| MCP tools returning stale results         | Step 3 (Manual repair) — `refresh_mcp_plugin_catalogs`                       |
| Docker containers orphaned                | Step 3 (Manual repair) — `prune_orphaned_runtime_artifacts`                  |

---

## Step 1: Run a Doctor Check

The Doctor framework runs 8 concurrent health checks across the system.

```bash
# Full health report (requires settings:read permission)
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:3010/api/operations/doctor \
  | jq '.checks[] | {checkId, status, summary}'
```

### Interpreting the results

| `status` | Meaning                            |
| -------- | ---------------------------------- |
| `pass`   | Healthy                            |
| `warn`   | Potential issue; may self-resolve  |
| `fail`   | Confirmed problem; action required |
| `error`  | The check itself failed to execute |

Each `fail` result includes a `suggestedRepairActionId` field. Note these — you may need them in Step 3.

### Key checks for failed workflows

| Check ID                                   | What it finds                                                           |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| `workflow_stuck_state_detector`            | Stale RUNNING runs and recoverable PENDING runs                         |
| `container_runtime_integrity_check`        | Orphaned Docker containers from dead executions                         |
| `queue_lag_and_dead_letter_detector`       | BullMQ backlogs and dead-letter jobs                                    |
| `git_worktree_integrity_detector`          | Corrupted worktrees (can block step execution)                          |
| `tool_and_plugin_registry_integrity_check` | Orphaned MCP tool entries (can cause `tool_contract_mismatch` failures) |

---

## Step 2: Read the Event Ledger for a Specific Run

The event ledger (`event_ledger` table) is the primary audit trail for a failed run.

```bash
# Get all events for a run (API endpoint — check route in your deployment)
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3010/api/workflows/runs/$RUN_ID/events" \
  | jq '.[] | {eventName, createdAt, payload}'
```

Or via the debug bundle CLI:

```bash
bd retrieve-debug-bundle $RUN_ID
```

### Key events to look for

| Event Name                                | What it tells you                                                                                    |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `workflow.failure.classification.decided` | Full classification result: `class`, `confidence`, `eligibility`, `reason`, `allowedRepairActionIds` |
| `workflow.repair.delegation.dispatched`   | Repair was dispatched; includes `policyActionId` and `attempt`                                       |
| `workflow.repair.delegation.completed`    | Repair finished; includes `status` (`succeeded`/`failed`) and message                                |
| `workflow.auto_retry.scheduled`           | Fast auto-retry was enqueued (before classification fires)                                           |
| `workflow.auto_retry.exhausted`           | All auto-retries used up — classification fires next                                                 |
| `execution.failed`                        | Individual execution failure with `failure_reason`                                                   |
| `execution.reaped`                        | Execution was reaped by the supervisor (`container_lost`, `idle_timeout`, etc.)                      |

### Interpreting the classification event

```json
{
  "eventName": "workflow.failure.classification.decided",
  "payload": {
    "class": "runtime_artifact_stale",
    "confidence": 0.8,
    "eligibility": "allow",
    "allowedRepairActionIds": [
      "doctor.runtime_artifact.refresh_stale_artifacts"
    ],
    "reason": "stale mount detected in runtime diagnostics"
  }
}
```

- `eligibility: "allow"` + no subsequent `repair.delegation.dispatched` → check that `workflow_repair_delegation_enabled` is `true` (see Step 5).
- `eligibility: "deny"` → the failure class has no automated fix; see [Failure Classes](10-workflow-repair.md#repair-policy-matrix).
- `eligibility: "human_required"` → requires manual analysis; `tool_contract_mismatch` and `ambiguous_failure` always land here.
- `class: "credential_missing"` with `eligibility: "deny"` → a required API key or secret is missing; no automated fix is possible.

---

## Step 3: Run a Manual Doctor Repair

If a Doctor check identified a fixable issue, or you want to preemptively run a repair action:

```bash
# Dry run first — see what would change without modifying state
curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action_id": "prune_orphaned_runtime_artifacts", "dry_run": true}' \
  http://localhost:3010/api/operations/doctor/repair \
  | jq '.result'

# Execute the repair (requires settings:manage permission + confirm: true)
curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action_id": "prune_orphaned_runtime_artifacts", "confirm": true}' \
  http://localhost:3010/api/operations/doctor/repair
```

### Available repair actions

| `action_id`                         | Use when                                                        |
| ----------------------------------- | --------------------------------------------------------------- |
| `requeue_recoverable_workflow_runs` | Runs are stuck in PENDING with no BullMQ job; recovers up to 25 |
| `prune_orphaned_runtime_artifacts`  | Orphaned Docker containers or stale mount directories           |
| `refresh_mcp_plugin_catalogs`       | MCP tools returning stale schemas or missing from registry      |
| `clean_git_worktrees`               | Corrupted git worktrees blocking step execution                 |
| `recover_api_fetch_failures`        | Runs stuck in API fetch failure loops                           |
| `clear_stale_polling_markers`       | Stale polling markers (currently a stub — no-op)                |

### Check repair history

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3010/api/operations/doctor/history?limit=20" \
  | jq '.[] | {action_id, status, started_at, finished_at}'
```

---

## Step 4: Check Reconciliation State for a Stuck Run

If a run is stuck in `RUNNING` with no BullMQ activity, check its internal state variables directly:

```sql
-- Find the repair delegation state for a run
SELECT
  state_variables->'_internal'->'repair_delegation' AS repair_state,
  state_variables->'_internal'->'failure_doctor' AS doctor_state,
  status,
  updated_at
FROM workflow_runs
WHERE id = '<run-id>';
```

Interpreting `repair_state`:

```json
{
  "status": "dispatched",         -- "dispatched" | "succeeded" | "failed" | "retry_limit_exceeded"
  "policyActionId": "doctor.runtime_artifact.refresh_stale_artifacts",
  "currentAttempts": 1,
  "repairWorkflowRunId": "<uuid>" -- present if sysadmin_workflow path was used
}
```

- `status: "retry_limit_exceeded"` → the maximum repair attempts cap was hit. If you want to retry, you can reset this field or increase `workflow_repair_delegation_max_attempts`.
- No `repair_state` field → classification ran but `eligibility` was not `allow`, or `workflow_repair_delegation_enabled` is `false`.

For runs stuck in `RUNNING`, also check the BullMQ state:

```bash
# Check if BullMQ still has a live job for the run (replace with your Redis host/port)
redis-cli -p 6380 KEYS "bull:workflow-steps:*" | grep <run-id>
```

The reconciliation service (`WorkflowRunReconciliationService`) will auto-recover stranded runs after `WORKFLOW_STALE_RUN_GRACE_MS` (default 5 minutes) with no live BullMQ job.

---

## Step 5: Check Operator Configuration

Verify the repair feature flags before concluding that repair is broken:

```sql
SELECT key, value
FROM system_settings
WHERE key IN (
  'workflow_repair_delegation_enabled',
  'workflow_repair_delegation_max_attempts',
  'workflow_auto_retry_enabled',
  'workflow_auto_retry_max_attempts'
);
```

Expected values for a deployment with repair enabled:

| Key                                       | Expected                                  |
| ----------------------------------------- | ----------------------------------------- |
| `workflow_repair_delegation_enabled`      | `true`                                    |
| `workflow_repair_delegation_max_attempts` | `1` or higher                             |
| `workflow_auto_retry_enabled`             | `true` (for transient failure resilience) |
| `workflow_auto_retry_max_attempts`        | `2`                                       |

If `workflow_repair_delegation_enabled` is missing or `false`, no automated repair will ever fire regardless of failure classification. See [10 — Workflow Repair: Operator Configuration](10-workflow-repair.md#operator-configuration) for how to enable it.

---

## Step 6: Re-trigger Classification Manually

After fixing an underlying environment issue, re-trigger classification on the failed run:

```bash
POST /api/workflows/runs/:runId/failure-classification
Authorization: Bearer $TOKEN
```

This re-runs evidence collection, rule classification, and (if enabled) repair delegation.

---

## Escalation: When Automated Repair Cannot Help

These failure classes cannot be automatically repaired and require human action:

| Class                    | Human action required                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| `credential_missing`     | Add the missing API key / secret to the `secret_store` via the Management UI             |
| `tool_contract_mismatch` | Review the tool schema, update the workflow YAML to match current tool signatures        |
| `ambiguous_failure`      | Read the session transcript (`bd retrieve-debug-bundle <run-id>`) to identify root cause |

For `human_required` classifications, the run is marked `FAILED` and no repair is attempted. Gather the following before escalating:

1. The full `workflow.failure.classification.decided` event payload
2. The session tree (`bd retrieve-debug-bundle <run-id>`)
3. The relevant section of the workflow YAML (`bd show <workflow-id>` or the seed YAML)
4. The Docker container logs for the failed step (via `GET /api/operations/doctor/repair` with `prune_orphaned_runtime_artifacts` dry-run for container inspection context, or direct `docker logs`)

---

## See Also

- [10 — Workflow Repair](10-workflow-repair.md) — Failure classification, repair policies, and manual operations
- [20 — Operations](20-operations.md) — Doctor framework, health checks, and repair actions
- [42 — Execution Lifecycle](42-execution-lifecycle.md) — Execution states, supervisor reaping, and reconciliation
- [18 — Telemetry & Observability](18-telemetry-observability.md) — Event ledger and debug bundle retrieval
- [docs/operations/orchestration-stall-recovery.md](../operations/orchestration-stall-recovery.md) — SQL-level recovery for stalled orchestrations
