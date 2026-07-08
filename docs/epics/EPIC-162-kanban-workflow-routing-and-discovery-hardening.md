# EPIC-162: Kanban Workflow Routing and Discovery Hardening

Status: Completed
Priority: P0
Depends On: EPIC-138, EPIC-152
Related: docs/analysis/ANALYSIS-kanban-workflow-issues.md
Last Updated: 2026-05-07

---

## 1. Summary

Harden kanban startup routing, imported-repository discovery, refinement automation, and hydration reliability so project orchestration enters the correct workflow path and produces trustworthy work items from discovered repository state.

The immediate priority is fixing imported repository routing. First-run imported repositories currently match the generic first-run rule before imported-repository bootstrap rules, and imported synthesis readiness still depends on an externally supplied boolean. This epic makes route selection deterministic from project state, then tightens the downstream discovery and hydration workflow gates.

---

## 2. Problem Statement

The kanban workflow analysis identified remaining issues after the imported-repository work item bridge was completed:

1. First-run imported repositories route through generic first-run discovery instead of imported-repository bootstrap.
2. `importReady` depends on `readinessContext.isReady`, which has no reliable automatic setter.
3. Startup route signals for recovery, health, and confidence are hardcoded, leaving some route rules dead or misleading.
4. Refinement and split workflows can both trigger from `kanban.ticket.refinement` for large work items.
5. A malformed work-item spec can block hydration of every valid spec in the same batch.
6. Probe results do not have a strong quality gate before synthesis and hydration.
7. Discovery DAG paths and probe loop behavior need regression coverage and observability.

These gaps can cause imported projects to miss codebase-aware discovery, create unreliable work items, or launch conflicting automation from the same kanban transition.

---

## 3. Goals

1. Route first-run imported repositories to imported-repository bootstrap before generic first-run handling.
2. Derive imported synthesis readiness from actual project artifacts and orchestration metadata instead of caller-supplied booleans.
3. Replace hardcoded startup route health, recovery, and confidence signals with explicit project and orchestration state signals.
4. Make refinement and split triggers mutually exclusive for `kanban.ticket.refinement`.
5. Allow hydration to continue when individual spec files are malformed, while reporting parse failures clearly.
6. Add probe-result quality gates before synthesis and hydration consume discovery output.
7. Add regression coverage for startup route paths and discovery workflow conditional DAG behavior.
8. Improve route and probe observability enough to diagnose future routing and discovery failures.

---

## 4. Non-Goals

1. Replacing the workflow engine DAG scheduler.
2. Rewriting the imported-repository synthesis-and-hydration bridge completed under EPIC-138.
3. Changing kanban status transition semantics outside the refinement and split trigger conflict.
4. Building a full analytics dashboard for route metrics.
5. Migrating historical orchestration records.

---

## 5. Scope

### In Scope

1. `apps/kanban/src/orchestration/startup-route-rules.config.yaml`
2. `apps/kanban/src/orchestration/startup-route-router.service.ts`
3. `apps/kanban/src/orchestration/orchestration.service.ts`
4. `seed/workflows/work-item-refinement-default.workflow.yaml`
5. `seed/workflows/work-item-split-default.workflow.yaml`
6. `seed/workflows/project-discovery-ceo.workflow.yaml`
7. `seed/workflows/prompts/project-codebase-deep-investigation/probe-loop.md`
8. `seed/workflows/prompts/project-codebase-deep-investigation/coordinator.md`
9. `apps/kanban/src/mcp/tools/mutation/hydrate-discovery-work-items.tool.ts`
10. Focused tests in `apps/kanban` and workflow seed validation coverage where available.

### Out of Scope

1. Public API contract changes unless required to expose already-owned kanban route diagnostics.
2. Broad workflow YAML schema changes.
3. New database tables for route metrics.

---

## 6. Proposed Implementation

### Phase 1: Critical Routing Fixes

1. Add a `first_run_imported_repo` route rule before `first_run`.
2. Route `first_run_imported_repo` to `imported-repo-bootstrap`.
3. Derive `importReady` from existing work-item spec artifacts and `readinessSignals.specs_ready`.
4. Add tests proving fresh imported repositories do not hit generic first-run discovery.

### Phase 2: Real Startup Signals

1. Replace `isRecoveryNeeded: false` with a derived signal from failed orchestration state, failed linked workflow metadata where available, clone/import failure markers, or validation errors.
2. Replace `projectHealthy: true` with an explicit health signal that accounts for paused/failed orchestration state and blocking diagnostics.
3. Replace `confidenceOverall: 100` with a derived confidence value based on specs, work items, import readiness, and recent failure signals.
4. Add unit tests for triage recovery, investigation, project-state review, and next-cycle route reachability.

### Phase 3: Refinement Trigger Exclusivity

1. Keep large work items on the split workflow path.
2. Prevent the refinement workflow from also starting for large work items that still require splitting.
3. Preserve normal refinement behavior for non-large items and already-split children.
4. Add seed workflow validation or trigger condition tests for mutually exclusive matching.

### Phase 4: Hydration Resilience

1. Catch spec parse errors per file inside `hydrate_discovery_work_items`.
2. Continue creating or updating work items from valid specs.
3. Include parse error details and skipped counts in the hydration summary.
4. Add tests for mixed valid and invalid spec batches.

### Phase 5: Probe Quality Gates

1. Define required probe-result fields for successful probes: outcome, inferred status, confidence score, evidence references, and narrative summary.
2. Reject or mark low-quality probe results before synthesis uses them.
3. Update probe prompts to return per-scope outcomes, not only aggregate counts.
4. Add tests around runtime probe-result validation and synthesis behavior for invalid probe data.

### Phase 6: Discovery DAG and Probe Throughput

1. Add route-path regression coverage for standard discovery, imported bootstrap, and imported synthesis paths.
2. Verify `discovery_and_specs` handles skipped conditional predecessors correctly.
3. Batch-dispatch independent file-backed probe scopes with a bounded concurrency limit.
4. Keep dependent or overlapping-path scopes serialized.

### Phase 7: Observability and Cleanup

1. Add structured logs for successful startup route selections with route, rule ID, and sanitized input signals.
2. Replace word-count based narrow-scope detection with an actual tokenizer or shared token-counting utility.
3. Clarify architecture stub persistence by either adding an explicit persistence step or removing misleading committed-state wording.

---

## 7. Actionable Tasks

- [ ] E162-001 Add `first_run_imported_repo` route precedence before `first_run`.
- [ ] E162-002 Derive imported synthesis readiness from specs and readiness metadata.
- [ ] E162-003 Replace hardcoded recovery, health, and confidence startup signals.
- [ ] E162-004 Add startup route reachability unit tests.
- [ ] E162-005 Make refinement and split workflow triggers mutually exclusive.
- [ ] E162-006 Continue hydration when individual spec files fail to parse.
- [ ] E162-007 Report hydration parse errors and skipped files in summary output.
- [ ] E162-008 Add probe-result validation before synthesis and hydration.
- [ ] E162-009 Return per-scope probe outcomes from the probe loop.
- [ ] E162-010 Add discovery workflow conditional-DAG regression coverage.
- [ ] E162-011 Batch independent probe scopes with bounded concurrency.
- [ ] E162-012 Add structured route-selection logging.
- [ ] E162-013 Replace narrow-scope word counting with token counting.
- [ ] E162-014 Clarify architecture-stub persistence behavior.

---

## 8. Acceptance Criteria

1. A fresh imported repository routes to `imported-repo-bootstrap`, not `first-run`.
2. An imported repository with existing work-item specs or ready metadata routes to `imported-repo-synthesis-and-hydration`.
3. Triage recovery and investigation route rules are reachable under tested unhealthy or low-confidence conditions.
4. Large work items entering refinement trigger split automation without also launching normal refinement.
5. Hydration creates or updates work items from valid specs even when another spec file is malformed.
6. Hydration output reports parse failures with enough detail to identify the bad file.
7. Probe results missing required evidence or summary fields cannot silently feed synthesis as successful findings.
8. Standard, imported bootstrap, and imported synthesis discovery paths have regression coverage.
9. Route-selection logs include selected route, selected rule ID, and sanitized signal values.

---

## 9. Suggested Quality Gates

1. `npm run test --workspace=apps/kanban -- src/orchestration/orchestration.service.spec.ts`
2. `npm run test --workspace=apps/kanban -- src/mcp/tools/mutation/hydrate-discovery-work-items.tool.spec.ts`
3. `npm run test:kanban`
4. `npm run build:kanban`
5. `npm run validate:seed-data`

---

## 10. Risks

1. Risk: route rule reordering changes behavior for non-imported first-run projects.
2. Mitigation: add explicit tests proving non-imported first-run projects still select `first-run`.
3. Risk: derived health and confidence signals become too broad and over-route to recovery or investigation.
4. Mitigation: keep signals small, named, and covered by route matrix tests.
5. Risk: mutually exclusive refinement triggers skip a legitimate refinement for a previously split item.
6. Mitigation: key the refinement condition on both scope and split/refinement metadata.
7. Risk: per-file hydration error handling hides systemic spec format failures.
8. Mitigation: return parse error counts and fail only when every spec is invalid or no work can be hydrated.
