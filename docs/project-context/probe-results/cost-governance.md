---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: cost-governance
outcome: failed
inferred_status: unknown
confidence_score: 0
evidence_refs:
  - apps/api/src/cost-governance/budget-context.provider.ts
  - apps/api/src/cost-governance/budget-decision.service.ts
  - apps/api/src/cost-governance/budget-policy.service.ts
  - apps/api/src/cost-governance/cost-estimator.service.ts
  - apps/api/src/cost-governance/cost-governance.controller.ts
  - apps/api/src/cost-governance/cost-governance.module.ts
  - apps/api/src/cost-governance/turn-usage-recorder.service.ts
  - apps/api/src/cost-governance/usage-token-normalizer.ts
source_paths:
  - apps/api/src/cost-governance
updated_at: 2026-06-15T17:50:00.000Z
---

# Probe Result: Cost Governance and Budgets (FAILED)

## Narrative Summary

The probe for the `cost-governance` scope **failed** during execution. While the
source directory `apps/api/src/cost-governance/` exists and contains substantial
implementation files (services, controllers, module, database entities, DTOs,
and spec files for budget policy, decision, estimator, context provider, and
turn-usage recorder), the probe subagent was unable to write a structured probe
result to disk. This is a recovery failure: the previous probe loop orchestrator
reported all 49 manifest scopes as probed and written, but this finalization pass
discovered that `docs/project-context/probe-results/cost-governance.md` does not
exist on disk.

**Error summary:**

- The probe subagent that was supposed to investigate the cost-governance scope
  did not successfully complete its write step.
- The previous job's recovery claim ("All 49 manifest scope probe result files
  exist on disk") was incorrect; this scope is one of five where the file is
  missing (along with `oauth.md`, `gitops.md`, `war-room.md`, and
  `execution-lifecycle.md`).
- The source code does exist and is well-structured (10 production files, 6+
  spec files covering budget policy, decision, estimator, context, controller,
  module). The scope appears to be substantially implemented, but no first-hand
  probe narrative can be produced without re-running the investigation.
- Recommended remediation: re-probe this scope (and the four other missing
  scopes) in the next investigation cycle. The pre-existing code is a strong
  signal that the re-probe will succeed; the prior failure was a write-pipeline
  issue, not an investigation failure.

The cost governance capability is described in the manifest as: budget-policy,
budget-decision, cost-estimator, turn-usage-recorder, usage-token-normalizer.
