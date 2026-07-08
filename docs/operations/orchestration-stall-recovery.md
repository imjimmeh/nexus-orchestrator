# Orchestration Stall Recovery Runbook

## Symptoms

1. Project orchestration status remains `orchestrating` with no active workflow run.
2. No new CEO cycles are requested for prolonged periods.
3. Project progress remains flat with zero dispatch activity.

## Primary Signals

1. Dispatch poll reconcile events continue, but no cycle requests are emitted.
2. Event ledger lacks recent orchestration cycle requests.
3. Work item backlog does not change despite active orchestration mode.

## Diagnosis

### 1) Find stale orchestrations

```sql
SELECT
  id,
  project_id,
  status,
  updated_at,
  CURRENT_TIMESTAMP - updated_at AS age
FROM project_orchestrations
WHERE status = 'orchestrating'
  AND CURRENT_TIMESTAMP - updated_at > interval '20 minutes'
ORDER BY age DESC;
```

### 2) Check dispatchable work-item state

```sql
SELECT
  project_id,
  COUNT(*) FILTER (WHERE status = 'todo') AS todo_count,
  COUNT(*) FILTER (WHERE status IN ('refinement', 'in-progress', 'in-review', 'ready-to-merge')) AS active_count,
  COUNT(*) FILTER (WHERE status = 'done') AS done_count
FROM work_items
GROUP BY project_id
ORDER BY project_id;
```

### 3) Check recent orchestration stall telemetry

```sql
SELECT occurred_at, project_id, event_name, outcome, payload
FROM event_ledger
WHERE domain = 'orchestration'
  AND event_name IN (
    'orchestration_stale_cycle_triggered',
    'delegation_completion_cycle_requested'
  )
ORDER BY occurred_at DESC
LIMIT 200;
```

### 4) Check recent cycle-request events for a project

```sql
SELECT occurred_at, event_name, outcome, source, payload
FROM event_ledger
WHERE domain = 'orchestration'
  AND project_id = :project_id
ORDER BY occurred_at DESC
LIMIT 200;
```

### 5) Find stale running workflow jobs with persisted output

Use this when a run appears stuck after the agent called `set_job_output` and then `step_complete` in the same turn.

```sql
SELECT
  id,
  workflow_id,
  current_step_id,
  status,
  state_variables #> ARRAY['jobs', current_step_id, 'output'] AS current_job_output,
  updated_at,
  CURRENT_TIMESTAMP - updated_at AS age
FROM workflow_runs
WHERE status = 'RUNNING'
  AND current_step_id IS NOT NULL
  AND state_variables #> ARRAY['jobs', current_step_id, 'output'] IS NOT NULL
ORDER BY updated_at ASC
LIMIT 50;
```

### 6) Check recent denied `step_complete` calls

```sql
SELECT occurred_at, workflow_run_id, step_id, tool_name, error_code, payload
FROM event_ledger
WHERE tool_name = 'step_complete'
  AND (
    error_code = 'output_contract_missing_fields'
    OR payload::text ILIKE '%output_contract%'
    OR payload::text ILIKE '%missing%'
  )
ORDER BY occurred_at DESC
LIMIT 100;
```

### 7) Find target-branch blocked todo work

```sql
WITH item_branches AS (
  SELECT
    id,
    title,
    scope_id,
    status,
    linked_run_id,
    current_execution_id,
    execution_config->>'targetBranch' AS target_branch
  FROM kanban_work_items
  WHERE execution_config->>'targetBranch' IS NOT NULL
)
SELECT
  todo.scope_id,
  todo.id AS todo_id,
  todo.title AS todo_title,
  todo.target_branch,
  owner.id AS owner_id,
  owner.title AS owner_title,
  owner.status AS owner_status,
  owner.linked_run_id,
  owner.current_execution_id
FROM item_branches todo
JOIN item_branches owner
  ON owner.scope_id = todo.scope_id
 AND owner.target_branch = todo.target_branch
 AND owner.id <> todo.id
WHERE todo.status = 'todo'
  AND (
    owner.status IN ('in-progress', 'in-review', 'ready-to-merge')
    OR owner.linked_run_id IS NOT NULL
    OR owner.current_execution_id IS NOT NULL
  )
ORDER BY todo.scope_id, todo.target_branch;
```

## Recovery

### 1) Verify stale-threshold configuration

1. System setting key: `orchestration_stale_threshold_minutes`.
2. Environment override: `ORCHESTRATION_STALE_THRESHOLD_MINUTES`.
3. Default behavior assumes `20` minutes.

### 2) Force a cycle manually (API fallback)

Use the orchestration start/resume endpoint for the target project when no automatic cycle is triggered.

### 3) Verify delegation flow hydration

1. Confirm delegation workflow `orchestration_invoke_agent_default` completed.
2. Confirm post-delegation `kanban.publish_specs` hydration ran when spec publication was expected.
3. Confirm expected spec-backed work items are present in `work_items`.

## Prevention and Monitoring

1. Alert when `orchestration_stale_cycle_triggered` spikes for a single project.
2. Alert when `delegation_completion_cycle_requested` emits repeated `denied` or `failure` outcomes.
3. Periodically audit projects with long `orchestrating` age and null `current_workflow_run_id`.

## Scheduler Terminalized State

### Symptoms

1. CEO cycles fail with `Decision is not launchable: terminalized` on `kanban.work_item_transition_status`.
2. All mutation attempts return `terminalized` regardless of board state.
3. Repeated CEO cycles create new blocked intents without clearing the backlog.
4. Board has ready backlog items but zero todo items, and none can be promoted.

### Root Cause

Blocked and launchable `kanban_orchestration_intents` accumulate across CEO cycles. Each intent carries `conflict_keys` (work_item or workflow_scope) that block new intents from launching. The stale_reconciler background service (runs every 60s) can re-create `workflow_scope` intents via idempotency key matching, keeping the scheduler clogged even after manual resets.

### Diagnosis

```sql
-- Check blocked/launchable intents for a project
SELECT status, lane, type, reason, conflict_keys, created_at
FROM kanban_orchestration_intents
WHERE project_id = :project_id
  AND status IN ('blocked', 'launchable', 'running', 'pending')
ORDER BY created_at DESC;

-- Count by status
SELECT status, count(*)
FROM kanban_orchestration_intents
WHERE project_id = :project_id
GROUP BY status;
```

### Recovery — Option A: CEO Self-Healing (autonomous)

The CEO agent has access to `kanban.reset_orchestration_intents` via its workflow `allow_tools`. When the CEO detects terminalized errors across ≥2 distinct mutation attempts, it can call this tool to suppress all blocked/launchable/pending/running intents, then record a `blocked` decision and complete the cycle. The next cycle starts clean.

**Tool**: `kanban.reset_orchestration_intents({ project_id: "..." })`
**Returns**: `{ ok: true, project_id, reset_count, message }`

### Recovery — Option B: Frontend Button (manual)

1. Navigate to the project workspace → **Orchestration** tab.
2. Click **"Reset Blocked Intents"** in the Orchestration Controls card.
3. The button calls `POST /api/projects/:id/orchestration/reset-intents` on the kanban service.
4. All blocked, launchable, running, and pending intents are set to `suppressed`.
5. Click **Start** (or **Restart**) to begin a fresh CEO cycle.

### Recovery — Option C: Direct Database (emergency)

```sql
UPDATE kanban_orchestration_intents
SET status = 'suppressed', terminal_outcome = 'suppressed'
WHERE project_id = :project_id
  AND status IN ('blocked', 'launchable', 'running', 'pending');
```

### Prevention

1. **Idempotency key skip**: `createIntent` skips existing intents in terminal states (`blocked`/`suppressed`) and creates new ones instead. This prevents the stale_reconciler from resurrecting suppressed wakeup intents. See `KanbanOrchestrationIntentRepository.createIntent()`.
2. **Stale reconciler cooldown**: The stale_reconciler enforces a 5-minute cooldown between wakeups (see `ProjectOrchestrationWakeupService.isInsideStaleWakeupCooldown`).
3. **Active cycle check**: `requestWakeup` returns `no_launch` when a CEO cycle is already active for the project.

## Notes

1. Stale-heartbeat behavior is additive and still respects cycle cooldown.
2. Delegation completion event emission is best-effort and non-fatal by design.
3. Mandatory delegation post-step hydration is idempotent and safe when no specs are present.
4. The `kanban.reset_orchestration_intents` tool is available to both the CEO agent (autonomous) and the frontend (manual). It resets intents to `suppressed` — a terminal state that does not participate in conflict resolution.
