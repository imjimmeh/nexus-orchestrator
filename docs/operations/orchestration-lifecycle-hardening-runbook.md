# Orchestration Lifecycle Hardening Runbook

## Scope

Use this runbook for EPIC-065 lifecycle incidents:

1. Bootstrap chain stalls or regressions
2. Completion guardrail denials
3. Import readiness failures
4. Dispatch authority mismatches

## Required Inputs

1. `project_id`
2. `orchestration_id` (if available)
3. Recent `workflow_run_id` values
4. Approximate incident window (UTC)

## Fast API Checks

1. Project diagnostics:

- `GET /workflow/runtime/projects/:projectId/diagnostics`
- Check:
  - `bootstrap_chain_status`
  - `completion_readiness`
  - `dispatch_authority_source`
  - `import_stage_status`
  - `stage_skill_diagnostics`
  - `stage_skill_diagnostics.included_skills`
  - `stage_skill_diagnostics.excluded_skills`

2. Project brief:

- `GET /projects/:projectId/orchestration/brief`

3. Pending action requests:

- `GET /projects/:projectId/orchestration/action-requests?status=pending`

## SQL Verification Queries

Use these read-only checks in Postgres.

1. Orchestration status and metadata:

```sql
SELECT
  id,
  project_id,
  status,
  specs_completed,
  orchestration_mode,
  current_workflow_run_id,
  metadata,
  updated_at
FROM project_orchestrations
WHERE project_id = $1;
```

2. Recent orchestration action requests:

```sql
SELECT
  id,
  action,
  status,
  requested_by,
  workflow_run_id,
  correlation_id,
  rejection_reason,
  error_message,
  created_at,
  updated_at
FROM project_orchestration_action_requests
WHERE project_id = $1
ORDER BY created_at DESC
LIMIT 50;
```

3. Recent workflow runs tied to project:

```sql
SELECT
  id,
  workflow_id,
  status,
  current_step_id,
  created_at,
  updated_at
FROM workflow_runs
WHERE state_variables -> 'trigger' ->> 'projectId' = $1
ORDER BY created_at DESC
LIMIT 50;
```

4. Lifecycle denial/fallback telemetry:

```sql
SELECT
  occurred_at,
  event_name,
  outcome,
  workflow_run_id,
  project_id,
  error_code,
  payload
FROM event_ledger
WHERE project_id = $1
  AND event_name IN (
    'orchestration.completion.denied',
    'orchestration.import.validation_failed',
    'orchestration.dispatch.authority_fallback'
  )
ORDER BY occurred_at DESC
LIMIT 100;
```

## Incident Playbooks

### 1. Bootstrap Chain Failure

Symptoms:

1. `bootstrap_chain_status` stays `discovery_or_revision_pending` or `awaiting_approval` unexpectedly.
2. No specs-ready or bootstrap-completed transitions.

Actions:

1. Validate critical workflow contracts at startup logs.
2. Confirm seeds include valid `emit_event` jobs for:
  - `ProjectOrchestrationSpecsReadyEvent`
  - `ProjectOrchestrationBootstrapCompletedEvent`
3. Check `workflow_runs` status for discovery/spec/work-item-generation workflows.

### 2. Completion Denied

Symptoms:

1. Complete endpoint or runtime complete action returns guardrail denial.
2. Event ledger contains `orchestration.completion.denied`.

Actions:

1. Inspect diagnostics `completion_readiness.blocking_reasons`.
2. Confirm blocking reason codes map to real project state (active work items, unresolved goals, pending approvals).
3. Re-run completion only after remediating all blocker codes.

### 3. Import Validation Failure

Symptoms:

1. Start orchestration fails with `import_validation_failed`.
2. Orchestration status transitions to `failed` from import stage.

Actions:

1. Check `metadata.importContext.readiness.issues` in `project_orchestrations`.
2. Validate `repository_url` and `base_path` correctness.
3. Verify remote branch discovery and credentials.

### 4. Dispatch Authority Mismatch

Symptoms:

1. Dispatch denied with authority mismatch recommendation.
2. Diagnostics show unexpected `dispatch_authority_source`.
3. Event ledger contains `orchestration.dispatch.authority_fallback` repeatedly.

Actions:

1. Read current setting:

```sql
SELECT key, value
FROM system_settings
WHERE key = 'orchestration_dispatch_authority_mode';
```

2. Ensure source aligns with authority mode:
  - `scheduler` mode expects scheduler source
  - `ceo` mode expects CEO cycle source
3. If fallback source (`workflow` or `unknown`) persists, inspect calling workflow/tool path for missing source context.

### 5. Blueprint Invocation Failure (EPIC-066)

Symptoms:

1. `invoke_agent_workflow` fails for `standard_feature_flow`, `hotfix_flow`, or `documentation_audit`.
2. Error indicates missing blueprint inputs (`objective`, `requested_by`) or disallowed target.
3. Quality/review gate completion events are missing for blueprint runs.

Actions:

1. Confirm request payload includes blueprint contract fields:
   - `objective`
   - `requested_by`
   - optional: `risk_level`, `scope_boundaries`, `artifact_paths`
2. Inspect workflow run history for:
   - `AutomatedQualityCheckCompletedEvent`
   - `StandardFeatureFlowCompletedEvent`
   - `HotfixFlowCompletedEvent`
   - `HotfixFlowRollbackSuggestedEvent`
   - `DocumentationAuditCompletedEvent`
3. If stage skill behavior appears incorrect, inspect `stage_skill_diagnostics` to verify `included_skills` and `excluded_skills`.

## Feature Flags and Rollback Procedures

1. Bootstrap contract enforcement:
  - Env: `WORKFLOW_ENFORCE_CRITICAL_ORCHESTRATION_WORKFLOW_VALIDATION`
  - Rollback: set `false` for temporary startup bypass.

2. Dispatch authority mode:
  - Setting: `orchestration_dispatch_authority_mode`
  - Values: `scheduler` (default) or `ceo`

3. Stage-skill policy:
  - Setting: `workflow_stage_skill_policy`
  - Rollback: set to `{}` to restore profile-only skill behavior.

4. Import strategy:
   - Start request `import_strategy` values:
     - `assess_only`
     - `assess_and_bootstrap`

5. Blueprint fallback procedure:
   - If blueprint execution is unstable in production, route orchestration actions back to existing non-blueprint workflow IDs (`project_discovery_ceo`, `project_spec_revision_ceo`, `project_work_item_generation_ceo`, `project_orchestration_refinement_ceo`) while triaging.

## On-Call Handoff Checklist

1. Incident summary with exact failing transition.
2. Current `project_orchestrations.status` and `metadata.importContext` snapshot.
3. Top 3 recent `event_ledger` lifecycle events.
4. Any setting changes applied (`orchestration_dispatch_authority_mode`, `workflow_stage_skill_policy`, validation env flag).
5. Verified recovery command/API and expected follow-up monitoring window.
