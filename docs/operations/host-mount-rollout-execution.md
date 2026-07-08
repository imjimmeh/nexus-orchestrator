# Host-Mount Rollout Execution

This runbook records EPIC-100 rollout execution in a deterministic local environment and defines production rollout gates.

## Scope

1. Stage 1: Read-only canary
2. Stage 2: Limited read-write with approval gating
3. Stage 3: Hardening verification and temporary-flag removal

## Stage 1: Read-Only Canary

### Objective

Validate alias resolution, policy intersection, diagnostics, and lifecycle audit events for read-only mounts.

### Entry Criteria

1. Host mount catalog configured
2. Startup validation passes
3. Workflow validation accepts `host_mounts` contracts

### Execution Evidence (2026-04-15)

Command set and outcomes:

1. `npm run build:api` -> passed
2. `npm run test --workspace=apps/api -- src/workflow/host-mount-resolution.service.spec.ts` -> passed (`9` tests)
3. `npm run test --workspace=apps/api -- src/workflow/workflow-validation.service.spec.ts src/docker/container-orchestrator.service.spec.ts` -> passed (`53` tests)
4. Targeted ESLint on touched host-mount workflow/operations files -> passed (`0` errors)

### Canary Exit Criteria

1. No traversal/symlink escape acceptance paths
2. Diagnostics endpoint returns container and manifest drift details
3. Event ledger captures request/approve/deny and attach/remove events

Status: Completed in deterministic local validation.

## Stage 2: Limited Read-Write Rollout (Approval-Gated)

### Objective

Allow explicit read-write mounts only under RW allow-lists and approval-required outcomes.

### Entry Criteria

1. Stage 1 complete
2. Approval gate behavior validated (`approval_required` preflight)
3. Operator runbooks ready for deny/rollback response

### Execution Evidence (2026-04-15)

Command set and outcomes:

1. `npm run test --workspace=apps/api -- src/workflow/step-agent-step-executor.service.spec.ts` -> passed (`16` tests)
2. Added and verified explicit approval-required failure path test for provisioning
3. `npm run test --workspace=apps/api -- src/workflow/host-mount-startup-validation.service.spec.ts src/operations/runtime-artifacts-inspector.service.spec.ts` -> passed (`4` tests)

### Stage 2 Exit Criteria

1. RW requests without approval do not provision containers
2. Approval-required outcomes are observable in workflow lifecycle and tests
3. Stale host-share mount diagnostics appear in operations doctor evidence

Status: Completed in deterministic local validation.

## Stage 3: Hardening Verification

### Objective

Remove temporary host-mount toggles and verify secure defaults.

### Execution Evidence (2026-04-15)

1. Removed `workflow_host_mount_rw_approval_bypass` default and resolution logic
2. Verified no repository references remain:
   - `rg "workflow_host_mount_rw_approval_bypass|host_mount_rw_approval_bypass" apps packages docs .env.example docker-compose.yaml`
   - result: no matches
3. Confirmed startup validation, diagnostics, and audit services are wired in workflow module

Status: Completed.

## Production Rollout Checklist

1. Enable read-only aliases for selected projects first
2. Observe `workflow.host_mount.*` event rates and denied reasons
3. Validate `/api/workflows/runs/:runId/host-mounts/diagnostics` during incidents
4. Enable RW only for explicitly approved aliases and profiles
5. Keep `workflow_host_mount_rw_approval_required=true` during initial production RW window

## Related Docs

1. `docs/architecture/host-mount-governance.md`
2. `docs/architecture/container-orchestration.md`
3. `docs/guides/workflow-host-mount-authoring.md`
