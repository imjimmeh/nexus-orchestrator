# EPIC-144: Failure Classification and Repair Policy

Status: Implemented
Priority: P1
Beads: kanban-6ue
Depends On: EPIC-082, EPIC-119, EPIC-140
Last Updated: 2026-04-28

---

## 1. Summary

Define the policy layer that decides whether a failed workflow, job, or agent execution is eligible for autonomous repair.

This epic does not perform repairs. It classifies failures into safe, unsafe, and human-decision categories so later repair delegation can be constrained and auditable.

---

## 2. Problem

Agents can encounter missing libraries, configuration errors, stale runtime artifacts, or environment drift. Today those failures usually surface as failed jobs or require operator-driven doctor actions.

Before adding autonomous repair, the platform needs explicit policy boundaries for what may be fixed automatically.

---

## 3. Goals

1. Normalize failure evidence from `event_ledger`, workflow events, job output, and session logs.
2. Classify common failure signatures into repair policy classes.
3. Allowlist safe repair classes and deny unsafe classes.
4. Emit audit events for every classification decision.
5. Provide a stable contract for future SysAdmin repair delegation.

## 4. Non-Goals

1. Running repair workflows.
2. Installing dependencies automatically.
3. Fixing credentials or secrets.
4. Making destructive git or infrastructure changes.

---

## 5. Architecture

### 5.1 Failure Evidence Model

Create a normalized view of failure evidence including:

1. workflow run ID,
2. job and step IDs,
3. error code and message,
4. relevant event ledger rows,
5. relevant transcript snippets or references,
6. runtime artifact diagnostics when available.

### 5.2 Policy Classes

Initial classes:

1. `dependency_missing`: candidate for bounded repair,
2. `config_missing_local`: candidate when no secrets are involved,
3. `runtime_artifact_stale`: candidate through Operations Doctor,
4. `tool_contract_mismatch`: usually human or developer review,
5. `credential_missing`: denied,
6. `ambiguous_failure`: human decision required.

### 5.3 Decision Contract

Classification should return:

1. class,
2. confidence,
3. eligibility: `allow`, `deny`, or `human_required`,
4. rationale,
5. evidence references,
6. allowed repair action IDs when eligible.

---

## 6. Workstreams

1. Add failure evidence normalization helpers.
2. Add classification rules and policy configuration.
3. Integrate classification with workflow failure events or diagnostics APIs.
4. Emit audit events for classifications.
5. Add tests for safe, unsafe, and ambiguous failure signatures.

---

## 7. Backlog

- [x] E144-001 Define failure evidence and classification contract types.
- [x] E144-002 Add event-ledger and job-output evidence collector.
- [x] E144-003 Add initial rule-based classifier.
- [x] E144-004 Add policy allow/deny/human-required decision layer.
- [x] E144-005 Emit classification audit events.
- [x] E144-006 Add unit tests for representative failure classes.

---

## 8. Acceptance Criteria

1. The system can classify failed runs into explicit repair policy classes.
2. Credential and destructive-operation failures are denied.
3. Ambiguous failures require human review.
4. Safe classes include bounded allowed repair actions.
5. Every classification decision is auditable.

---

## 9. Risks and Mitigation

1. False positives may allow unsafe repairs.
   - Mitigate with conservative rules, confidence thresholds, and deny-by-default behavior.
2. Classifiers may miss real repair opportunities.
   - Mitigate with observable `human_required` outcomes and iterative rule expansion.
3. Policy may drift from capability governance.
   - Mitigate by aligning decisions with EPIC-140 runtime governance rules.

---

## 10. Implementation Notes

1. `WorkflowFailureEvidenceCollectorService` normalizes workflow failure evidence from run state, `event_ledger`, session-tree references, and runtime diagnostics.
2. `classifyFailureEvidence` is a deterministic rule engine for dependency, local config, runtime artifact, tool contract, credential, destructive-operation, and ambiguous failure signatures.
3. `RepairPolicyService` applies the allow/deny/human-required layer and only exposes bounded repair action IDs for eligible safe classes.
4. `workflow.failure.classification.decided` audit events are emitted through `EventLedgerService.emitBestEffort` with decision data and evidence counts, not raw transcript, job output, or event payload values.
5. `POST /workflows/runs/:runId/failure-classification` provides a manual classification endpoint for Admin and Developer roles.
6. Non-goal: this epic does not launch repair workflows or perform automated repairs.
