# EPIC-145: SysAdmin Repair Delegation

Status: Implemented
Priority: P1
Beads: kanban-iuk
Depends On: EPIC-144, EPIC-082, EPIC-083
Last Updated: 2026-04-28

---

## 1. Summary

Add constrained autonomous repair delegation for failures that EPIC-144 classifies as safe to repair.

The repair path should use existing Operations Doctor guardrails where possible and a narrowly scoped SysAdmin agent or repair workflow where agentic diagnosis is useful.

---

## 2. Problem

When agents hit missing dependencies or local configuration drift, the current step usually fails. Operators can run doctor checks and repairs, but the failing workflow does not have a bounded self-repair path.

Autonomous repair is useful only if it is tightly constrained by policy, tool permissions, retry limits, and auditability.

---

## 3. Goals

1. Spawn repair work only for policy-allowed failure classes.
2. Use a constrained SysAdmin profile or workflow with narrow tools.
3. Reuse Operations Doctor repair actions for platform-level fixes.
4. Rerun the failed job or step only after successful repair.
5. Audit every repair attempt, denial, success, and retry.

## 4. Non-Goals

1. Repairing credential or secret configuration failures.
2. Performing destructive git operations.
3. Unlimited retry or repair loops.
4. Allowing repair agents broad write access by default.

---

## 5. Architecture

### 5.1 Repair Dispatch

When a failure is classified as eligible, the workflow engine or failure handler should dispatch a repair attempt with:

1. failure evidence,
2. allowed repair class,
3. allowed tool set,
4. target workspace or runtime scope,
5. retry budget.

### 5.2 Repair Execution

Two execution paths should be supported:

1. deterministic Operations Doctor repair actions for known platform issues,
2. constrained SysAdmin agent workflow for dependency or local config changes.

### 5.3 Retry and Resume

After a successful repair:

1. rerun the failed job or step when supported,
2. record repair metadata on the workflow run,
3. stop after a bounded number of repair attempts,
4. surface failure clearly when repair does not resolve the issue.

---

## 6. Workstreams

1. Add SysAdmin profile and repair workflow seed.
2. Add repair dispatcher that consumes EPIC-144 classification output.
3. Integrate deterministic doctor repairs for eligible runtime issues.
4. Add bounded retry and rerun behavior.
5. Add event-ledger and doctor-history audit records.
6. Add tests for allowed, denied, failed, and successful repair paths.

---

## 7. Backlog

- [x] E145-001 Add constrained SysAdmin agent profile seed.
- [x] E145-002 Add environment repair workflow seed.
- [x] E145-003 Add repair dispatch service from classification decisions.
- [x] E145-004 Integrate Operations Doctor repair actions for platform classes.
- [x] E145-005 Add bounded rerun behavior after successful repair.
- [x] E145-006 Add audit and retry-limit tests.

---

## 8. Implementation Notes

1. The feature is gated by `workflow_repair_delegation_enabled`, which defaults to `false`.
2. Repair attempts are bounded by `workflow_repair_delegation_max_attempts`.
3. Repair delegation emits `workflow.repair-delegation.doctor.requested`, `workflow.repair-delegation.sysadmin.requested`, and `workflow.repair-delegation.completed`.
4. Per-run attempt state is stored at `_internal.repair_delegation`.
5. `doctor.runtime_artifact.refresh_stale_artifacts` uses the Operations Doctor path with `prune_orphaned_runtime_artifacts`; dependency and local config repairs use the `workflow_environment_repair` SysAdmin workflow path.
6. Repair delegation audit records use `workflow.repair-delegation.decided`.
7. Integration coverage exercises both Doctor and SysAdmin completion paths through repair completion, audit, state update, and failed-job retry.

---

## 9. Acceptance Criteria

1. Only allowlisted repair classes can start autonomous repair.
2. Repair agents cannot access denied tools or secrets.
3. Repair attempts are bounded and auditable.
4. Successful repair can rerun the failed job or step within retry limits.
5. Failed or denied repair attempts produce clear operator-facing evidence.

---

## 10. Risks and Mitigation

1. Repair agents may make broad or unrelated changes.
   - Mitigate with scoped prompts, tool allowlists, and policy-bound workspaces.
2. Repairs may mask deeper product defects.
   - Mitigate with audit events and retry limits.
3. Automatic dependency changes may alter behavior unexpectedly.
   - Mitigate with normal tests, commits, and critic/QA gates before merge.
