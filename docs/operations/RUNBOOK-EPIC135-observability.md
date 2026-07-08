# RUNBOOK: EPIC-135 Observability Queries

This runbook defines the canonical Event Ledger queries used to validate EPIC-135 controls.

## Query 1: Subagent-only In-Progress Runs

Goal: detect in-progress executions that used a refinement override but still ran through governed orchestration.

```sql
SELECT
  work_item_id,
  COUNT(*) AS override_events
FROM event_ledger
WHERE domain = 'workflow'
  AND event_name = 'refinement_gate_overridden'
  AND occurred_at >= NOW() - INTERVAL '30 days'
GROUP BY work_item_id
ORDER BY override_events DESC;
```

Expected: rows represent explicit and audited overrides only.

## Query 2: Large-Scope Refinement Coverage

Goal: identify work items where overrides were applied repeatedly without acknowledgement.

```sql
SELECT
  work_item_id,
  (payload->>'override_count')::int AS override_count,
  payload->>'actor' AS actor,
  payload->>'justification' AS justification,
  occurred_at
FROM event_ledger
WHERE domain = 'override_audit'
  AND event_name = 'refinement_gate_overridden'
  AND occurred_at >= NOW() - INTERVAL '30 days'
ORDER BY occurred_at DESC;
```

Expected: override_count increases per work item only when an explicit override was accepted.

## Query 3: Override Audit Stream

Goal: retrieve the full override audit timeline.

```sql
SELECT
  occurred_at,
  domain,
  event_name,
  project_id,
  work_item_id,
  actor_id,
  payload
FROM event_ledger
WHERE domain IN ('workflow', 'override_audit')
  AND event_name = 'refinement_gate_overridden'
ORDER BY occurred_at DESC;
```

Expected: every workflow-level override event has a corresponding override_audit event.

## Query 4: Plan Render Failure Rate

Goal: measure planning artifact persistence reliability.

```sql
SELECT
  DATE_TRUNC('day', occurred_at) AS day,
  COUNT(*) AS render_failures
FROM event_ledger
WHERE domain = 'workflow'
  AND event_name = 'plan_render_failed'
  AND occurred_at >= NOW() - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', occurred_at)
ORDER BY day DESC;
```

Expected: 0 failures in steady-state. Any non-zero day requires triage.

## Metric Mapping

- Metric A (override governance): Query 1 and Query 3
- Metric B (override frequency enforcement): Query 2
- Metric C (plan rendering resilience): Query 4
