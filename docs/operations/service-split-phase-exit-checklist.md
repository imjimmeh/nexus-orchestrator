# Service Split Phase Exit Checklist

Use this checklist before marking any EPIC-088+ phase complete.

## 1. Contracts

1. Cross-service request/response/event schemas are versioned and exported from `@nexus/core`.
2. New contract changes are additive for the active version.
3. Contract tests pass in producer and consumer workspaces.

## 2. Boundaries

1. Import-boundary architecture suite passes.
2. Any temporary exception has:
   - owner
   - reason
   - expiry date
3. Exception list is not growing without explicit migration justification.

## 3. Tests and Quality

1. Unit/integration coverage added for changed behavior.
2. Relevant deterministic orchestration checks pass.
3. Lint and build are clean for all touched workspaces.
4. Operations doctor includes a healthy `split_service_connectivity_check` result.

## 4. Documentation

1. Epic file task checklist reflects actual implementation status.
2. Migration dashboard status is updated.
3. Runbook notes cover rollout and rollback impact.

## 5. Rollback Path

1. Feature toggles / compatibility routes are documented.
2. Revert procedure is defined for schema and routing changes.
3. Data/event reconciliation expectations are documented for cutover windows.
