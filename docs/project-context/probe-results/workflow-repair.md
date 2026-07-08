---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: workflow-repair
outcome: success
inferred_status: implemented
confidence_score: 0.92
evidence_refs:
  - apps/api/src/workflow/workflow-repair/workflow-repair.module.ts
  - apps/api/src/workflow/workflow-repair/failure-classification.rules.ts
  - apps/api/src/workflow/workflow-repair/repair-policy.service.ts
  - apps/api/src/workflow/workflow-repair/workflow-repair-dispatch.service.ts
  - apps/api/src/workflow/workflow-repair/repair-executor-registry.service.ts
  - apps/api/src/workflow/workflow-repair/workflow-failure-classification.service.ts
  - apps/api/src/workflow/workflow-repair/workflow-repair-completion.listener.ts
  - apps/api/src/workflow/workflow-repair/workflow-failure-doctor-completion.listener.ts
  - apps/api/src/workflow/workflow-repair/sysadmin-repair-completion.listener.ts
  - apps/api/src/workflow/workflow-repair/workflow-failure-evidence.collector.ts
  - apps/api/src/workflow/workflow-repair/completion-message-sanitizer.ts
  - apps/api/src/workflow/workflow-repair/workflow-repair-delegation.integration.spec.ts
  - apps/api/src/workflow/workflow-repair/failure-classification-rules.spec.ts
source_paths:
  - apps/api/src/workflow/workflow-repair
updated_at: 2026-06-02T00:00:00.000Z
---

# Probe Result: Workflow Repair

## Narrative Summary

The workflow-repair module implements a complete autonomous repair pipeline for failed workflow runs. It classifies failures using rule-based pattern matching across error messages, job outputs, event ledger entries, and runtime diagnostics; applies policy gates based on confidence thresholds and safety tags; dispatches repair actions to either the workflow-failure-doctor or environment-repair sysadmin workflow; and handles completion by recording state, emitting audits, and triggering job retries.

The module is well-structured as a NestJS module with 26 files (12 test specs) covering classification rules, policy evaluation, dispatch orchestration, executor registry, evidence collection, completion listeners, and secret sanitization.

## Capability Updates

**Classification System**
- `classifyFailureEvidence()` in `failure-classification-rules.ts` implements rule-based classification across 6 policy classes: `credential_missing`, `dependency_missing`, `config_missing_local`, `runtime_artifact_stale`, `tool_contract_mismatch`, `ambiguous_failure`
- Patterns detect missing credentials (API keys, tokens), missing modules/dependencies, local config files, tool contract mismatches, and destructive operations
- `safetyTags` including `destructive_operation` deny automated repair regardless of class
- Confidence scores range from 0.3 (ambiguous) to 0.95 (credential)

**Policy Engine**
- `RepairPolicyService.applyPolicy()` enforces eligibility: `allow`, `deny`, `human_required`
- Confidence thresholds (minimumConfidence: 0.7) gate automated repair
- Policy config in `repair-policy.config.ts` maps each class to allowed repair action IDs and default executors
- Destructive operations always denied; credential_missing always denied; tool_contract_mismatch and ambiguous_failure require human review

**Dispatch System**
- `WorkflowRepairDispatchService.dispatchIfAllowed()` orchestrates repair delegation
- Retry limits controlled by `WORKFLOW_REPAIR_DELEGATION_MAX_ATTEMPTS_SETTING` (default: 1)
- Dispatch locks prevent concurrent repair attempts for same run/action
- Emits `workflow.repair-delegation.doctor.requested` or `workflow.repair-delegation.sysadmin.requested` events
- State stored under `_internal.repair_delegation` key per workflow run

**Executor Registry**
- `RepairExecutorRegistryService.resolveExecutionPlan()` maps policy action IDs to execution paths
- `doctor.runtime_artifact.refresh_stale_artifacts` → doctor path with `prune_orphaned_runtime_artifacts` action
- `repair.dependency.add_declared_package` and `repair.config.create_local_placeholder` → sysadmin_workflow path

**Evidence Collection**
- `WorkflowFailureEvidenceCollectorService.collect()` aggregates evidence from: event ledger (up to 100 events), job output, session tree transcript references, runtime diagnostics (skill mounts and host mounts)
- Handles gzip/base64 compressed JSONL from session trees
- Best-effort diagnostics collection with error tracking

**Completion Handlers**
- `WorkflowFailureDoctorCompletionListener` handles doctor workflow completion, reading `diagnose_failure` job output for `fixable`/`not_fixable` decision, triggering job retry with remediation instructions
- `SysadminRepairCompletionListener` handles environment repair workflow completion, reading `repair_environment` job output for status
- `WorkflowRepairCompletionListener` processes `repair_delegation.completed` events, recording state, auditing, and triggering failed job retry on success

**Secret Sanitization**
- `completion-message-sanitizer.ts` redacts API keys, bearer tokens, bare provider tokens (sk-*, pk-*, rk-*), and YAML block secrets from completion messages
- Evidence references sanitized for session tree references (summary replaced with safe placeholder)
- Truncation at 500 characters with suffix

## Health Findings

- **Test Coverage**: 12 test files covering unit, integration, and contract tests
- `failure-classification-rules.spec.ts`: Rule classification, safety tags, secret redaction, runtime diagnostics
- `workflow-failure-classification.integration.spec.ts`: Classification end-to-end with policy application
- `workflow-repair-dispatch.service.spec.ts`: Dispatch logic, retry limits, concurrent dispatch, secret sanitization
- `workflow-repair-delegation.integration.spec.ts`: Full integration flow from classification through dispatch, execution, completion, and retry
- `workflow-failure-evidence.collector.spec.ts`: Evidence collection, transcript expansion, diagnostics
- `workflow-failure-classification.service.spec.ts`: Classification service with runtime feedback ingestion
- `workflow-failure-doctor-completion.listener.spec.ts`: Doctor completion handling, retry prompting
- **Code Quality**: Clean separation between services, types, and specs; comprehensive TypeScript types; no TODO comments observed
- **Churn Indicators**: Stable module with mature test coverage; no recent refactoring artifacts

## Open Questions

- The `WorkflowFailureClassificationListener` currently listens only to `WORKFLOW_RUN_FAILED_EVENT`. If the failure classification or repair delegation logic needs to handle other failure modes (e.g., timeouts, cancellation), additional event handlers may be required.
- The `RepairExecutorRegistryService` uses hardcoded switch cases for policy action mapping. If new repair actions are added, the registry must be updated manually; no plugin/extension mechanism exists.
- Runtime diagnostics collection is best-effort and errors are recorded but not surfaced to operators. If diagnostics failures mask root causes, additional alerting may be warranted.