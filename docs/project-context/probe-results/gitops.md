---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: gitops
outcome: failed
inferred_status: unknown
confidence_score: 0
evidence_refs:
  - apps/api/src/gitops/gitops.module.ts
  - apps/api/src/gitops/gitops.controller.ts
  - apps/api/src/gitops/reconciliation.service.ts
  - apps/api/src/gitops/desired-state-loader.service.ts
  - apps/api/src/gitops/drift-detection.service.ts
  - apps/api/src/gitops/actual-state-reader.service.ts
  - apps/api/src/gitops/config-validation.service.ts
  - apps/api/src/gitops/config-export.service.ts
  - apps/api/src/gitops/gitops-inbound-reconcile.service.ts
  - apps/api/src/gitops/gitops-outbound-sync.service.ts
  - apps/api/src/gitops/gitops-pending-change.service.ts
  - apps/api/src/gitops/gitops-reconciliation-loop.ts
source_paths:
  - apps/api/src/gitops
updated_at: 2026-06-15T17:50:00.000Z
---

# Probe Result: GitOps Service (API) (FAILED)

## Narrative Summary

The probe for the `gitops` scope **failed** during execution. The source
directory `apps/api/src/gitops/` exists and is one of the most extensively
implemented scopes in the API tier — over 30 production files plus 30+ spec
files covering reconciliation, drift detection, config validation, desired
state loading, actual state reading, inbound/outbound sync, pending change
service, reconciliation loop, status service/controller, and integration tests.

**Error summary:**

- The probe subagent that was supposed to investigate the gitops scope did not
  successfully complete its write step.
- This scope was previously recorded as `failed` in `state.probe_results` and
  was skipped during the recovery pass; however, no failure artifact was
  actually written to disk.
- The previous job's recovery claim ("All 49 manifest scope probe result files
  exist on disk") was incorrect; this scope is one of five where the file is
  missing.
- Despite the failure, the source code shows the scope is substantially
  implemented (a complete GitOps platform with contracts in
  `packages/gitops-contracts`, configuration export/validation, drift
  detection, reconciliation loop, inbound/outbound sync, and a
  reconciliation-apply service). The capability described in the manifest
  is structurally complete.
- Recommended remediation: re-probe this scope in the next investigation
  cycle. The pre-existing code is a strong signal that the re-probe will
  succeed; the prior failure was a write-pipeline issue, not an investigation
  failure.

The GitOps capability is described in the manifest as: gitops-desired-state,
gitops-inbound-reconcile, gitops-outbound-sync, gitops-pending-change,
gitops-reconciliation-loop, drift-detection, actual-state-reader,
config-export/validation.
