# EPIC-167: Autonomous Kanban Orchestration Reliability and Product Management Completeness

Status: Completed
Priority: P0
Created: 2026-05-11
Last Updated: 2026-05-11
Owner: Kanban + Workflow Platform
Depends On: EPIC-166
Related PRD: `docs/specs/PRD-autonomous-kanban-product-orchestration.md`
Related SDD: `docs/specs/SDD-autonomous-kanban-product-orchestration.md`
Related Analysis: `docs/analysis/ANALYSIS-autonomous-kanban-orchestration-system-review-2026-05-11.md`

---

## 1. Why This Epic Exists

The platform has most components required for autonomous product orchestration, but critical seams prevent dependable end-to-end behavior. Trigger chaining, lifecycle event emission, canonical dispatch semantics, kickoff clarification, imported-repo triage quality, spec synchronization, diagnostics, recovery, and memory learning writeback are not yet reliable enough to behave like one cohesive autonomous product management loop.

EPIC-166 owns the immediate trigger bridge and payload hardening work. This epic owns the broader product-management completeness layer that sits on top of that foundation.

---

## 2. Desired Outcomes

1. Lifecycle workflows trigger reliably from work-item status transitions.
2. Dispatch is canonical, stateful, dependency-aware, capacity-aware, and auditable.
3. Startup can optionally run a user kickoff interview for clarity before autonomous planning.
4. Imported repositories are analyzed with higher-fidelity classification and evidence quality.
5. Memory evolves from read-only context into governed learning writeback.
6. Canonical specs remain synchronized with project, work-item, review, merge, and implementation reality.
7. Unified diagnostics can explain stalled projects caused by trigger, dispatch, policy, spec, run, event, memory, or dependency issues.
8. Deterministic E2E tests prove greenfield and imported-repo autonomous paths.

---

## 3. Scope

### In Scope

1. `apps/api` workflow trigger wiring, webhook handling, and trigger diagnostics.
2. `apps/kanban` status transition event bridge and continuation reliability.
3. `apps/kanban/src/dispatch/dispatch.service.ts` canonical dispatch behavior.
4. `apps/kanban/src/orchestration/orchestration.service.ts` startup context, action names, and diagnostics.
5. `apps/kanban/src/orchestration/orchestration-continuation.service.ts` continuation and recovery behavior.
6. `apps/kanban/src/orchestration/startup-route-router.service.ts` kickoff route support.
7. `apps/kanban/src/orchestration/imported-repository-backlog-reconciler.ts` reality-mapping improvements.
8. `apps/kanban/src/project/project.service.ts` and project state tools for normalized goals exposure.
9. Seed workflows/prompts for startup interview, orchestration cycle, lifecycle, and PM loop improvements.
10. Memory capability extension for writeback and retrospective integration.
11. Spec publication, spec health, and repository artifact contracts.
12. Deterministic E2E tests for greenfield and imported-repo autonomy paths.

### Out of Scope

1. Full deployment orchestration.
2. Unrelated chat UX features.
3. New non-kanban workflow products.
4. Full external issue-tracker integration.

---

## 4. Workstreams

### WS-1: Trigger Chain Reliability (P0)

Goal:

Guarantee webhook-trigger workflows are registered and invocable, not only event triggers.

Deliverables:

1. Add webhook trigger registration service parallel to event trigger registrar or a unified trigger dispatcher that preserves webhook trigger type.
2. Register webhook bindings at startup with telemetry and health counters.
3. Add trigger diagnostics endpoint showing event and webhook registrations, last trigger times, and last failures.
4. Add integration tests for webhook-triggered workflow start.

Acceptance:

1. All active workflows with `trigger.type=webhook` are registered.
2. Trigger diagnostics exposes webhook registration count and state.
3. Missing critical webhook bindings are visible before a board stalls.

### WS-2: Status Transition Event Bridge (P0)

Goal:

Emit required `kanban.work_item.status_changed.v1` events on every relevant work-item status transition with complete payload contract. Seeded status workflows route through workflow-owned conditions over `trigger.status`.

Deliverables:

1. Add domain event publisher in kanban status mutation path.
2. Add payload contract builder with required fields: `event`, `scopeId`, `contextId`, `workItemId`, `previousStatus`, `status`, `actor`, and `resource`.
3. Add `suppressAutomation`, actor, origin, reason, correlation ID, and causation ID support to transition paths.
4. Guard against duplicate emission on same-status or idempotent updates.
5. Add integration tests for `in-progress` -> `in-review` -> `ready-to-merge` lifecycle chain.

Acceptance:

1. Transition triggers downstream workflows deterministically.
2. Payload contracts satisfy seeded prompt dependencies.
3. `ready-to-merge` -> `done` with automation suppression emits merge-completed behavior without requiring a generic `done` status workflow.

### WS-3: Canonical Dispatch Semantics (P0)

Goal:

Make dispatch a confirmed kanban state mutation, not a workflow launch that can be misreported as board progress.

Deliverables:

1. Audit every workflow/tool path that can claim dispatch.
2. Choose canonical dispatch strategy: transition-first, run-first with transition confirmation, or single dispatcher operation.
3. Standardize dispatch workflow input shape on canonical context names: `scopeId`, `contextId`, and work-item resource payload.
4. Ensure dispatch returns confirmed status, linkage, and run mutation results.
5. Restrict or relabel `invoke_agent_workflow` in CEO-cycle dispatch prompt/tool policy so generic workflow launches are not represented as kanban dispatch.
6. Add dependency cycle detection to work-item dependency mutation or dispatch diagnostics.
7. Add dispatch diagnostics for skipped, blocked, idempotent, and selected candidates.

Acceptance:

1. No workflow path can report a work item as dispatched unless kanban status/linkage confirms it.
2. Repeated dispatch with the same idempotency key does not duplicate runs.
3. Dispatch skips blocked, dependency-incomplete, missing-spec, and capacity-exceeded candidates with explicit reasons.

### WS-4: Startup Context and Kickoff Interview Route (P0/P1)

Goal:

Support optional user conversation at project start to disambiguate goals and constraints, while ensuring startup workflows receive complete project context.

Deliverables:

1. Ensure project state includes normalized `ProjectGoal` records.
2. Include `orchestrationId` in startup workflow input or prove workflow-engine injection with tests.
3. Add startup route for kickoff interview when confidence/goals quality is low or policy requests it.
4. Add workflow and prompt for structured clarification and normalized project brief output.
5. Persist assumptions, constraints, non-goals, acceptance criteria, and unanswered questions in project context docs.
6. Feed normalized kickoff output into discovery/spec generation input contracts.
7. Add diagnostics for selected route, route confidence, and kickoff status.

Acceptance:

1. Kickoff route can be enabled by policy and route rules.
2. Discovery receives improved structured context from kickoff output.
3. Autonomous projects can skip kickoff when confidence is sufficient.
4. Startup child workflows receive goals, mode, policy, route, source context, and orchestration ID in contract tests.

### WS-5: Imported-Repo Reality Mapping V2 (P1)

Goal:

Improve reconciliation quality from heuristic keywording to a richer evidence-based classifier.

Deliverables:

1. Define probe artifact schemas for capability map, architecture map, health findings, open questions, and spec drift.
2. Extend classification taxonomy: `existing_capability`, `gap`, `partial_capability`, `defect`, `test_gap`, `docs_gap`, `architecture_risk`, `security_risk`, `performance_risk`, `human_decision`, `duplicate`, `obsolete`, and `ignored`.
3. Add confidence scoring model with explainable rationale fields.
4. Add contradiction detector across capability map, codebase health, open questions, and probe artifacts.
5. Improve publishing metadata for traceability and user override handling.
6. Track ignored imported findings with explicit reasons.
7. Add mixed-repository fixtures with implemented, partial, broken, missing, and ambiguous findings.
8. Mark legacy hydrate/synthesize tools as legacy or remove/route through canonical reconciler.

Acceptance:

1. Reconciliation summaries include category counts, confidence bands, and contradiction diagnostics.
2. Imported repository fixture produces mixed board state.
3. Every created work item includes evidence and source hash.
4. Autonomous mode does not over-block resolvable human-decision findings.

### WS-6: Spec Lifecycle Integrity Hardening (P1)

Goal:

Ensure PRD, SDD, work-item plans, implementation plans, review plans, and retrospectives remain synchronized with implementation reality.

Deliverables:

1. Define canonical paths and minimum schema for PRD, SDD, roadmap, work-item specs, implementation plans, review plans, and retrospectives.
2. Harden `kanban.publish_specs` with source path, source hash, version, and provenance validation.
3. Add conformance checks in cycle and review paths when implementation diverges materially from specs.
4. Add artifact freshness metadata with last validated run/time.
5. Add spec-to-DB consistency checker and drift detector for stale specs or mismatched acceptance criteria coverage.
6. Enforce dispatch readiness based on required spec artifacts.
7. Verify post-merge hydration updates relevant specs or records a no-op reason.

Acceptance:

1. Every active work item maps to a spec or explicit exception.
2. Spec publication is idempotent by source ID/hash.
3. Drift signals are surfaced before dispatching new related work.
4. Project-level spec health is available in diagnostics.

### WS-7: Review, Recovery, and Execution History (P1)

Goal:

Make work-item execution attempts inspectable, restartable, and recoverable without duplicate side effects.

Deliverables:

1. Implement work-item execution history API/tooling.
2. Implement restart execution semantics.
3. Ensure review rejection feedback is stored and consumed by the next implementation run.
4. Add repeated review/implementation failure escalation to blocked or refinement.
5. Reconcile stale `linked_run_id` and `current_execution_id` consistently.
6. Add restart/recovery tests for lifecycle chains.

Acceptance:

1. Operators can inspect all execution attempts for a work item.
2. Restarting an execution does not duplicate active runs.
3. Review rejection feedback appears in the subsequent implementation trigger context.

### WS-8: Memory Learning Writeback (P1)

Goal:

Add governed write-memory capability so retrospectives improve future decisions.

Deliverables:

1. Choose memory write seam: kanban MCP, core runtime, or memory service.
2. Introduce memory write tool contract for project-scoped learning notes.
3. Add retrospective workflow that writes structured lessons with confidence and provenance.
4. Update cycle decision prompts to consume prior lessons explicitly with citation fields.
5. Add safety policy to prevent noisy or low-confidence memory pollution.
6. Add tests for memory write and subsequent read influence.

Acceptance:

1. New memory entries appear after retrospective runs.
2. Subsequent cycle decisions reference prior memory and show behavior change.
3. Low-confidence lessons are not written automatically.

### WS-9: Unified Diagnostics (P1/P2)

Goal:

Expose a single project health surface that answers why an autonomous project is stalled or unsafe to continue.

Deliverables:

1. Build or extend diagnostics endpoint to include project, orchestration, work-item, run, trigger, spec, dispatch, memory, and policy sections.
2. Add trigger health for event and webhook bindings.
3. Add lifecycle payload validation failure reporting.
4. Add dispatch candidate diagnostics.
5. Add event emission failure and dead-letter diagnostics.
6. Add recommended operator action.

Acceptance:

1. A stalled project can be diagnosed from one endpoint or view.
2. Missing webhook binding is visible.
3. Lost or failed lifecycle event is visible.
4. Blocked, paused, stale, and policy-gated states include remediation guidance.

### WS-10: Policy and Prompt Hygiene (P1/P2)

Goal:

Reduce runtime uncertainty from configuration drift.

Deliverables:

1. CI validation for `allow_tools`/`deny_tools` overlap.
2. Prompt boundary tests for mandatory tool calls and output contracts.
3. Route/rule consistency checks between startup router code and config.
4. Contract tests proving `kanban.work_item_transition_status` accepts fields used by workflow YAML.
5. Contract tests proving workflow child invocations pass required mode, policy, route, and orchestration context.

Acceptance:

1. Policy conflicts fail CI.
2. Prompt contract regressions are caught pre-merge.
3. Action request vocabulary matches current tool/action names.

### WS-11: Deterministic E2E Reliability Suite (P0-P2)

Goal:

Prove end-to-end autonomy and detect regressions after split-service changes.

Deliverables:

1. Greenfield deterministic path test to first done work item.
2. Imported-repo deterministic path test with mixed capability outcomes.
3. Restart/reconciliation test for stale linked runs and lifecycle event recovery.
4. Supervised human-decision blocked/resume test.
5. Review rejection feedback loop test.
6. Merge success and post-merge hydration test.

Acceptance:

1. All critical lifecycle tests pass in deterministic mode.
2. Failure artifacts are sufficient for root-cause triage.
3. Greenfield and imported-repo paths both exercise canonical dispatch.

---

## 5. Actionable Work Items

- [ ] E167-001 Complete EPIC-166 lifecycle trigger bridge prerequisite work.
- [ ] E167-002 Add webhook trigger diagnostics for registration count, state, and last trigger.
- [ ] E167-003 Choose canonical dispatch strategy and document decision.
- [ ] E167-004 Add failing test for false dispatch claim where workflow launches but kanban item remains blocked/unlinked.
- [ ] E167-005 Update `DispatchService` to return confirmed mutation results.
- [ ] E167-006 Standardize dispatch run input shape on canonical context names.
- [ ] E167-007 Restrict or relabel `invoke_agent_workflow` in CEO cycle dispatch prompt/tool policy.
- [ ] E167-008 Add dependency cycle detection to work-item dependency mutation or dispatch diagnostics.
- [ ] E167-009 Ensure project state includes normalized `ProjectGoal` records.
- [ ] E167-010 Include `orchestrationId` in startup workflow input or prove engine injection with tests.
- [ ] E167-011 Add startup route rule for optional kickoff.
- [ ] E167-012 Create kickoff brief persistence contract.
- [ ] E167-013 Add kickoff workflow/prompt with bounded question policy.
- [ ] E167-014 Define imported repository probe artifact schemas.
- [ ] E167-015 Replace imported repository marker classifier with taxonomy/confidence classifier.
- [ ] E167-016 Add mixed imported repository fixture tests.
- [ ] E167-017 Track ignored imported findings with reasons.
- [ ] E167-018 Mark legacy hydrate/synthesize tools as legacy or remove/route through canonical reconciler.
- [ ] E167-019 Define repository spec artifact path/schema contract.
- [ ] E167-020 Harden `kanban.publish_specs` with source hash/version/provenance validation.
- [ ] E167-021 Add spec-to-DB consistency checker.
- [ ] E167-022 Enforce dispatch readiness based on required spec artifacts.
- [ ] E167-023 Implement work-item execution history.
- [ ] E167-024 Implement work-item restart execution semantics.
- [ ] E167-025 Add repeated review/implementation failure escalation policy.
- [ ] E167-026 Choose memory write seam and document it.
- [ ] E167-027 Add governed `record_learning`/memory write tool contract.
- [ ] E167-028 Add retrospective-to-memory workflow.
- [ ] E167-029 Build unified project diagnostics endpoint/view.
- [ ] E167-030 Add trigger health and webhook binding diagnostics.
- [ ] E167-031 Add lifecycle event failure/dead-letter diagnostics.
- [ ] E167-032 Add greenfield autonomous E2E to first done item.
- [ ] E167-033 Add imported repository autonomous E2E with mixed classification.
- [ ] E167-034 Add restart recovery E2E for lifecycle chain.
- [ ] E167-035 Add review rejection feedback loop E2E.
- [ ] E167-036 Add merge success and post-merge hydration E2E.

---

## 6. Milestones

1. Milestone A (P0): WS-1 + WS-2 complete through EPIC-166, with trigger diagnostics and lifecycle tests.
2. Milestone B (P0): WS-3 canonical dispatch complete and false-dispatch regression covered.
3. Milestone C (P1): WS-4 + WS-5 baseline complete for kickoff and imported-repo reality mapping.
4. Milestone D (P1): WS-6 + WS-7 complete for spec integrity, review recovery, and execution history.
5. Milestone E (P1/P2): WS-8 + WS-9 + WS-10 complete for memory, diagnostics, and hygiene.
6. Milestone F (P2): WS-11 full deterministic suite green in CI.

---

## 7. Dependencies

1. EPIC-166 lifecycle trigger bridge and contract hardening.
2. Existing kanban/core auth and internal service contracts.
3. Seed workflow loading and validation pipeline.
4. Deterministic test harness environment for cross-service integration.
5. Repository workspace and artifact path conventions.
6. Memory provider or MCP/runtime tool seam.

---

## 8. Acceptance Criteria

1. Greenfield autonomous project can reach first done work item in deterministic E2E coverage.
2. Imported repository autonomous project can produce mixed done/todo/blocked work items from fixture evidence.
3. Dispatch cannot be falsely reported without kanban mutation/linkage confirmation.
4. Startup workflows always receive goals, mode, policy, route, source context, and orchestration ID.
5. Optional kickoff produces a persisted project brief and does not violate autonomous/supervised policy.
6. Every active work item maps to a canonical spec artifact or explicit exception.
7. Review rejection feedback loops back into implementation context.
8. Merge success transitions to done, emits merge-completed event, and hydrates specs.
9. Unified diagnostics can explain stalled projects due to trigger, dispatch, policy, spec, run, event, memory, or dependency issues.
10. Project memory writeback stores evidence-backed lessons and later cycles can cite relevant memories.
11. Legacy imported-repo hydration/synthesis paths are removed, routed through canonical reconciliation, or clearly prevented from seed workflow usage.
12. Policy conflicts and prompt contract regressions fail validation before runtime.

---

## 9. Quality Gates

1. `npm run test --workspace=apps/kanban -- src/seeds/workflows.seed.contract.spec.ts`.
2. Focused kanban work-item lifecycle tests for status/event chaining.
3. Focused dispatch service tests for dependency/capacity/idempotency/false-dispatch behavior.
4. Focused orchestration service tests for startup input context and action names.
5. Imported repository reconciler fixture tests.
6. Spec publication contract tests.
7. Diagnostics endpoint tests.
8. Greenfield and imported repository E2E smoke tests.
9. `git diff --check` for documentation/code whitespace sanity.

---

## 10. Risks and Mitigations

1. Risk: EPIC-167 duplicates EPIC-166 work.
   Mitigation: keep EPIC-166 as prerequisite and limit this epic to broader product-loop completion.
2. Risk: Trigger bridge causes duplicate runs.
   Mitigation: idempotency keys and dedupe guard at transition emitter.
3. Risk: Canonical dispatch change breaks existing workflows.
   Mitigation: add contract tests around current seed workflows before refactor.
4. Risk: Kickoff interview adds latency.
   Mitigation: policy-gated and confidence-threshold based activation.
5. Risk: Imported repository classifier complexity increases false certainty.
   Mitigation: uncertainty fields, evidence requirements, and mandatory diagnostics.
6. Risk: Memory writeback introduces noisy bias.
   Mitigation: confidence thresholds and provenance metadata.
7. Risk: Diagnostics become broad but shallow.
   Mitigation: use "why stalled?" acceptance scenarios for each failure type.

---

## 11. Definition of Done

This epic is complete when the autonomous kanban product loop is demonstrably reliable for both greenfield and imported repository projects: project start, optional kickoff, spec generation, work-item publication, canonical dispatch, lifecycle-triggered implementation/review/merge, post-merge hydration, recovery, unified diagnostics, and memory learning all pass deterministic tests and match the PRD/SDD contracts.
