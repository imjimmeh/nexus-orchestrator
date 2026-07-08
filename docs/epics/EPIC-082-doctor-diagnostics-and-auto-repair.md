# EPIC-082: Doctor Diagnostics and Auto-Repair

Status: Proposed
Priority: P1
Depends On: EPIC-078, EPIC-080, EPIC-081
Last Updated: 2026-04-12

---

## 1. Summary

Create a unified doctor diagnostics surface for runtime health, contract drift, queue backlogs, stuck workflows, and recoverable misconfigurations.

This closes an important operational gap versus OpenClaw doctor flows.

---

## 2. Problem

Diagnostics today are fragmented across logs and ad hoc endpoints. Operators lack one command and one report model for platform health and safe repairs.

---

## 3. Goals

1. Add doctor report API with machine-readable and human-readable outputs.
2. Add modular checks for core runtime domains.
3. Add safe auto-repair actions for selected classes of issues.
4. Add audit trail for all repair attempts.

## 4. Non-Goals

1. Fully automatic repairs for destructive operations.
2. Replacing existing logs and metrics stack.

---

## 5. Architecture

### 5.1 Doctor Check Registry

Each check returns:

1. check_id
2. status (ok, warn, fail)
3. evidence
4. optional repair action id

Initial check modules:

1. Workflow run stuck-state detector.
2. Queue lag and dead-letter detector.
3. Container orphan and stale runtime check.
4. Contract schema version mismatch check.
5. Tool and plugin registry integrity check.

### 5.2 Repair Actions

Repair actions are explicit and gated:

1. clear stale polling markers
2. requeue recoverable workflow runs
3. prune orphaned runtime artifacts
4. refresh MCP/plugin catalogs

### 5.3 API

1. GET /operations/doctor
2. POST /operations/doctor/repair
3. GET /operations/doctor/history

---

## 6. Workstreams

1. Doctor registry and check interfaces.
2. Core check implementations.
3. Repair action runner with guardrails.
4. API and report formatter.
5. UI and operations history view.

---

## 7. Backlog

- [ ] E082-001 Add doctor check interface and registry.
- [ ] E082-002 Implement workflow stuck-state check.
- [ ] E082-003 Implement queue lag and dead-letter check.
- [ ] E082-004 Implement container runtime integrity check.
- [ ] E082-005 Implement contract and schema mismatch check.
- [ ] E082-006 Implement safe repair action executor.
- [ ] E082-007 Add doctor APIs and history persistence.
- [ ] E082-008 Add operations UI for doctor report and repair history.
- [ ] E082-009 Add tests for check correctness and repair authorization.

---

## 8. Acceptance Criteria

1. One endpoint returns consolidated doctor health report.
2. Operators can run approved repairs with explicit confirmation.
3. Repairs are audited with actor, timestamp, and outcome.
4. High-severity runtime issues are detectable without log spelunking.

---

## 9. Risks and Mitigation

1. False positives triggering unnecessary repairs.
   - Mitigate with confidence scoring and dry-run mode.
2. Unsafe repair execution.
   - Mitigate with explicit allowlist and role-based authorization.
