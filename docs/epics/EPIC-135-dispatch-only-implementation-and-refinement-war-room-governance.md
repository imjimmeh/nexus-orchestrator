# EPIC-135: Dispatch-Only Implementation and Refinement War Room Governance

**Epic ID:** EPIC-135  
**Status:** Proposed  
**Created:** 2026-04-22  
**Last Updated:** 2026-04-22  
**Priority:** P0 - Critical  
**Theme:** Execution Safety, Refinement Quality, and Autonomous Multi-Agent Governance

---

## 1. Executive Summary

This epic hardens the work-item delivery lifecycle so autonomous implementation quality is achieved without mandatory human-in-the-loop intervention.

The target operating model is:

1. Refinement produces a concrete, reviewable implementation plan.
2. Planning quality is validated by a real multi-agent war room with defined roles, participation thresholds, and structured signoffs.
3. Implementation orchestration cannot directly read files, edit files, or run commands.
4. Every implementation task is executed only via subagent dispatch loops.
5. Each milestone output is reviewed by a quality-checker subagent before the next milestone begins.
6. Verification and targeted fixes run milestone by milestone before final commit.
7. Work items that skip refinement are prevented from entering in-progress silently.
8. In-flight work items are migrated safely before new guards activate.

This epic consolidates already-applied changes and remaining fixes into one governed rollout.

---

## 2. Background and Problem Statement

For work item cb8f8469-67f7-4d3b-be18-56b23005a285 (run 3935a430-b663-409c-a374-fc5f94142f16), execution quality failed for three reasons:

1. Refinement was never triggered before in-progress.
2. War room alignment was ceremonial (open, invite, post one message, close).
3. The orchestrator directly implemented code instead of delegating to implementation specialists.

Consequence: planning drift and full autonomous implementation by the wrong role, with weak verification boundaries.

Additional evidence from the same run highlights reliability defects that this epic also covers:

1. set_job_output failed validation because data was sent as a JSON string instead of an object.
2. war room alignment tool call failed with missing required body parameter.
3. implementation attempted reads on missing paths, causing ENOENT failures.
4. implementation command execution hit timeout (180s) during bash step.
5. investigation SQL scripts drifted from current workflow_runs schema assumptions.

---

## 3. Goals

1. Enforce a dispatch-only implementation orchestrator boundary.
2. Make war-room planning and alignment behavior genuinely multi-agent with concrete participation requirements.
3. Persist implementation plans from a single authoritative store with a derived human-readable artifact.
4. Add readiness gates so unrefined items cannot quietly bypass planning quality controls.
5. Improve plan schema quality (file targets, verification criteria, dependency ordering).
6. Add subagent output quality validation at each implementation milestone.
7. Instrument all new guards with typed telemetry events and queryable success metrics.
8. Safely migrate in-flight work items before new constraints activate.
9. Keep fallback resilience when subagent commit or verification paths fail.

---

## 4. Non-Goals

1. Introducing mandatory human approval for every implementation step.
2. Replacing the full work-item lifecycle model.
3. Rewriting all existing workflows from scratch.
4. Changing unrelated orchestration domains outside refinement and in-progress pipelines.

---

## 5. Scope Summary

### 5.1 Already Applied in This Iteration

1. Dispatch-only permissions for in-progress implementation orchestration in [seed/workflows/work-item-in-progress-default.workflow.yaml](../../seed/workflows/work-item-in-progress-default.workflow.yaml).
2. Dispatch-loop implementation prompt in [seed/workflows/prompts/work-item-in-progress-default/implement.md](../../seed/workflows/prompts/work-item-in-progress-default/implement.md).
3. War-room alignment host moved to architect role with subagent capability in [seed/workflows/work-item-in-progress-default.workflow.yaml](../../seed/workflows/work-item-in-progress-default.workflow.yaml).
4. Dedicated war-room alignment prompt in [seed/workflows/prompts/work-item-in-progress-default/war-room-align.md](../../seed/workflows/prompts/work-item-in-progress-default/war-room-align.md).

### 5.2 Remaining Work in This Epic

1. Refinement war room must become mandatory, truly multi-agent, and conform to the concrete protocol defined in WS2.
2. Refinement must persist plan markdown as a derived render from `executionConfig.implementationPlan` (single authoritative store).
3. Refinement entry/exit and in-progress transition guards must enforce readiness with governed override path.
4. Plan output contract must require actionable task metadata with subagent quality review at each milestone.
5. Planning model quality fallback and profile policy must be hardened with a defined large-scope threshold.
6. All new guards and workflow steps must emit typed telemetry events with queryable success metrics (WS7).
7. In-flight work items must be audited and migrated before guards activate (WS8).
8. Add focused tests for workflow behavior and guard regressions with a concrete harness spec (WS6).

---

## 6. Workstreams and Phasing

### WS1: Dispatch-Only Execution Hardening

Status: Partially complete.

Deliverables:

1. Keep implement-and-commit orchestrator tool deny-list immutable for direct code operations.
2. Validate no backdoor path allows orchestrator direct file/command execution during implementation milestones.
3. Preserve commit fallback step chain in the workflow for operational resilience.

Primary files:

1. [seed/workflows/work-item-in-progress-default.workflow.yaml](../../seed/workflows/work-item-in-progress-default.workflow.yaml)
2. [seed/workflows/prompts/work-item-in-progress-default/implement.md](../../seed/workflows/prompts/work-item-in-progress-default/implement.md)

Acceptance criteria:

1. Implementation orchestrator cannot call read_file, write_file, edit, or bash in implement step context.
2. Each milestone runs implement -> quality-check -> verify -> optional fix dispatch order.
3. Final step_complete summary includes milestone outcomes and commit hash or explicit nothing-to-commit signal.

---

### WS9: Tool Contract and Runtime Reliability Hardening

Status: Planned.

Deliverables:

1. Enforce set_job_output contract usage so data is always an object and never string-encoded JSON.
2. Add strict nexus_orchestrator envelope validation with actionable errors for missing required fields.
3. Add path-existence checks and corrected file-target derivation before read operations in implementation prompts.
4. Add timeout-safe command decomposition guidance for implementation subagents.
5. Add operations query cookbook updates for current workflow_runs schema and joins.

Primary files:

1. [seed/workflows/prompts/work-item-in-progress-default/implement.md](../../seed/workflows/prompts/work-item-in-progress-default/implement.md)
2. [seed/workflows/prompts/work-item-in-progress-default/war-room-align.md](../../seed/workflows/prompts/work-item-in-progress-default/war-room-align.md)
3. apps/api workflow runtime tool validation and handler modules.
4. docs/operations runbook updates for DB investigation queries.

Acceptance criteria:

1. set_job_output payload-shape violations are rejected with deterministic diagnostics and corrected prompt examples.
2. missing nexus_orchestrator envelope fields are surfaced before dispatch with explicit remediation hints.
3. ENOENT read failures are prevented by existence checks or corrected targets in generated plans.
4. bash timeout incidence is reduced via smaller command units and retry-safe execution guidance.
5. documented workflow_runs diagnostic queries execute against current schema without manual trial-and-error.

---

### WS2: Refinement War Room Enforcement

Status: Planned.

Deliverables:

1. War room opens with a fixed participant set: Architect (host), Security Reviewer, Domain Expert, QA Lead.
2. Each participant turn is dispatched as a subagent with read-only access to the work item spec and current plan draft.
3. Participant output must conform to the Concern schema: `{ role, concern_id, concern, severity: critical|major|minor, suggested_resolution }`.
4. The blackboard accumulates all concerns until all required participants have posted or a 3-retry timeout triggers a degraded-signoff path.
5. Minimum participation threshold: Architect + at least 2 other roles must post before the room can close as approved.
6. Signoff is a structured field: `{ role, decision: approved|approved_with_conditions|blocked, conditions?: string[] }`.
7. Architect reconciliation pass explicitly maps each critical/major concern to a resolution or accepted-risk note before plan approval, using a `resolution_map: { concern_id, resolution | accepted_risk }[]`.
8. Room closure without minimum participation writes `status: needs_rework` with `reason: insufficient_war_room_participation`.

Primary files:

1. [seed/workflows/work-item-refinement-default.workflow.yaml](../../seed/workflows/work-item-refinement-default.workflow.yaml)
2. [seed/workflows/prompts/work-item-refinement-default/architect-refine.md](../../seed/workflows/prompts/work-item-refinement-default/architect-refine.md)
3. Add prompt file: seed/workflows/prompts/work-item-refinement-default/war-room-align.md

Acceptance criteria:

1. War room cannot close as approved with fewer than 3 participant signoffs (Architect + 2).
2. Concern schema is validated on write; malformed concern entries are rejected with a remediation message.
3. Architect output includes a `resolution_map` that references each critical/major concern by `concern_id`.
4. Degraded-signoff path produces deterministic telemetry: `war_room_degraded_signoff` event with `missing_roles[]`.
5. Plan approval is blocked if any concern with `severity: critical` has no resolution or `accepted_risk` entry in the resolution map.

---

### WS3: Plan Persistence in Repository

Status: Planned.

Deliverables:

1. `executionConfig.implementationPlan` is the single authoritative source of truth for the implementation plan.
2. `docs/plans/PLAN-<workItemId>.md` is a human-readable render of `executionConfig.implementationPlan`, generated on write and regenerated on any update.
3. The plan renderer is a deterministic pure function: the same `executionConfig` input always produces the same markdown output.
4. No agent reads `docs/plans/` directly for execution decisions; they read `executionConfig` via the work-item API.
5. `docs/plans/` files are auditable artifacts only — they carry a `<!-- generated: do not edit manually — source: work_item_id={id} rendered: {timestamp} -->` header.
6. If the render step fails, refinement is marked `needs_rework` rather than silently skipping the artifact.

Primary files:

1. [seed/workflows/work-item-refinement-default.workflow.yaml](../../seed/workflows/work-item-refinement-default.workflow.yaml)
2. [seed/workflows/prompts/work-item-refinement-default/architect-refine.md](../../seed/workflows/prompts/work-item-refinement-default/architect-refine.md)

Acceptance criteria:

1. A single write path updates `executionConfig` and immediately re-renders `docs/plans/PLAN-<id>.md`.
2. `docs/plans/` files include the generated header with source work item ID and render timestamp.
3. No code path reads `docs/plans/` to drive execution logic.
4. Render failure produces a deterministic event: `plan_render_failed` with `work_item_id` and `reason`.

---

### WS4: Readiness Gate and Transition Safety

Status: Planned.

Deliverables:

1. Enforce `hasClearedRefinementOnce` + implementation plan presence before in-progress.
2. Auto-reroute unready work items to refinement with explicit reason tags.
3. Add fail-fast signal if in-progress workflow is triggered without required readiness metadata.
4. Override path governance:
   - Override requires an explicit `override_justification` field (non-empty string) on the transition request.
   - Override is only permitted for work items with `priority: P0` as set by a project lead role.
   - Each override emits a deterministic event: `refinement_gate_overridden` with `work_item_id`, `actor`, `justification`, and `timestamp`.
   - Work items that entered in-progress via override are automatically queued for retroactive refinement on completion (`retroactive_refinement_required: true`).
   - Override frequency cap: no single work item may be overridden more than once without a manual project-lead acknowledgement.
   - Override decisions are surfaced in the event ledger under a dedicated `override_audit` stream.

Primary files:

1. [seed/workflows/work-item-in-progress-default.workflow.yaml](../../seed/workflows/work-item-in-progress-default.workflow.yaml)
2. [seed/workflows/work-item-refinement-default.workflow.yaml](../../seed/workflows/work-item-refinement-default.workflow.yaml)
3. [apps/api/src/project/project-orchestration-dispatch.execution.ts](../../apps/api/src/project/project-orchestration-dispatch.execution.ts)

Acceptance criteria:

1. Items that never cleared refinement do not execute implementation steps directly.
2. Rerouted items produce deterministic telemetry reason codes.
3. No deadlock path where item remains in todo without actionable next transition.
4. Override attempts without a P0 priority flag are rejected with `reason: override_requires_p0_priority`.
5. Post-override work items have `retroactive_refinement_required: true` in their metadata on completion.
6. Override audit stream is queryable and includes all required fields.

---

### WS5: Plan Contract Quality and Model Policy

Status: Planned.

Deliverables:

1. Require each plan task to include target files, verification criteria, and dependency references.
2. Add contract validation before plan persistence.
3. Large-scope is defined as: `task_count >= 5` OR `estimated_token_cost > 50k`. Large-scope plans are routed to the high-capability model profile.
4. After each implementation milestone, a lightweight quality-reviewer subagent (separate from the implementer) inspects the output:
   - Checks that modified files match the plan's `target_files` list.
   - Checks that verification criteria for the milestone are addressed in the diff.
   - Emits `milestone_quality_check_passed` or `milestone_quality_check_failed` with a `findings[]` list.
5. On `milestone_quality_check_failed`, the orchestrator dispatches a targeted fix subagent (max 2 retries) before escalating to `needs_rework`.

Primary files:

1. [seed/workflows/work-item-refinement-default.workflow.yaml](../../seed/workflows/work-item-refinement-default.workflow.yaml)
2. [seed/workflows/prompts/work-item-refinement-default/architect-refine.md](../../seed/workflows/prompts/work-item-refinement-default/architect-refine.md)
3. [seed/workflows/work-item-in-progress-default.workflow.yaml](../../seed/workflows/work-item-in-progress-default.workflow.yaml)

Acceptance criteria:

1. Incomplete plans are rejected with explicit remediation messages.
2. Large-scope plans pass schema checks before implementation orchestration begins.
3. Every milestone produces a `milestone_quality_check` event before the next milestone begins.
4. Large-scope detection uses the `task_count >= 5` OR `estimated_token_cost > 50k` threshold and routes to the high-capability profile accordingly.
5. Quality check findings are attached to the work item event ledger entry for the milestone.
6. Delta replan paths preserve the same contract constraints.

---

### WS6: Verification and Regression Coverage

Status: Planned.

Deliverables:

1. Dispatch-only constraint tests (apps/api):
   - Unit tests that assert the tool deny-list blocks `read_file`, `write_file`, `edit`, and `bash` in implement-step context.
   - Use a mock tool-permission resolver; inject the denied tool list; assert `ExecutionPermissionError` is thrown.

2. War room signoff enforcement tests:
   - Integration tests that simulate a war room with fewer than 3 participants; assert room closes with `needs_rework` status and `reason: insufficient_war_room_participation`.
   - Simulate Architect + 2 signoffs; assert plan proceeds to approval.
   - Simulate a concern with `severity: critical` and no resolution in the `resolution_map`; assert plan approval is blocked.

3. Plan persistence tests:
   - Unit test for the plan renderer: given a fixture `executionConfig`, assert markdown output matches a stored snapshot.
   - Assert render failure produces a `plan_render_failed` event with correct `work_item_id` and `reason` fields.
   - Assert no execution path reads `docs/plans/` for dispatch decisions.

4. Readiness gate tests:
   - Integration test: trigger in-progress on an item without `hasClearedRefinementOnce`; assert reroute to refinement with a deterministic reason tag.
   - Trigger in-progress on a P0 item with `override_justification`; assert `refinement_gate_overridden` event is emitted with required fields.
   - Trigger override on a non-P0 item; assert rejection with `reason: override_requires_p0_priority`.

5. All new tests must:
   - Fail on the old (pre-epic) behavior and pass on the corrected behavior.
   - Mock only specific external boundaries (tool resolver, event emitter) — not entire modules.
   - Contain no lint suppressions or ts-ignore additions.
   - Be co-located with the module under test per existing project conventions.

Primary test targets:

1. apps/api workflow engine tests around execution permissions and transitions.
2. Workflow prompt-driven contract tests where present.
3. Deterministic integration scenarios in packages/e2e-tests only when explicitly resumed.

Acceptance criteria:

1. All test categories listed above exist and pass.
2. Each category has at least one test verifying the failure mode (not only the happy path).
3. No new eslint-disable or ts-ignore introduced.
4. Every acceptance criterion in WS1–WS5 has a corresponding test category entry here.

---

### WS7: Observability and Telemetry

Status: Planned.

Deliverables:

1. Define the canonical typed event set emitted by all new guards and workflows:
   - `refinement_gate_overridden`: `{ work_item_id, actor, justification, timestamp }`
   - `war_room_degraded_signoff`: `{ work_item_id, missing_roles: string[], timestamp }`
   - `plan_render_failed`: `{ work_item_id, reason, timestamp }`
   - `milestone_quality_check_passed` / `milestone_quality_check_failed`: `{ work_item_id, milestone_id, findings: Finding[], timestamp }`
   - `plan_contract_violation`: `{ work_item_id, violations: string[], timestamp }`

2. Each event is emitted to the existing event ledger with the above field contracts. All payload types are fully typed (no `any`).

3. Add a telemetry query reference at `docs/operations/RUNBOOK-EPIC135-observability.md` showing how to query:
   - All in-progress runs that executed exclusively via subagents (Section 9 metric 1).
   - All large-scope refinement runs with multi-agent war-room artifacts (Section 9 metric 2).
   - All override events in the last 30 days.
   - Milestone quality check failure rate over a rolling window.

4. Each Section 9 success metric references a specific event ledger query defined in the runbook.

Primary files:

1. `apps/api/src/telemetry/` (event type definitions)
2. `docs/operations/RUNBOOK-EPIC135-observability.md` (new)

Acceptance criteria:

1. Every new guard and workflow step emits its defined event on both the happy path and the failure path.
2. All event payloads are fully typed with no `any` fields.
3. The operations runbook query reference exists and returns correct results against a seeded test ledger.
4. Every metric in Section 9 references a specific named query in the runbook.

---

### WS8: Migration Safety for In-Flight Work Items

Status: Planned.

Deliverables:

1. Audit all work items currently in `in-progress` or `todo` state before rollout.
2. Items in `in-progress` dispatched under the old (direct-execution) model are tagged with `legacy_execution_model: true`.
3. `legacy_execution_model` items complete under the old constraint set; dispatch-only is not enforced mid-run.
4. On completion, `legacy_execution_model` items are automatically queued for a retroactive quality review using the WS5 milestone quality reviewer.
5. Items in `todo` state without `hasClearedRefinementOnce` are rerouted to refinement during rollout rather than silently left in place.
6. New guards activate only after the migration audit is complete and all legacy items are tagged. Rollout is gated on migration completion.

Primary files:

1. `apps/api/src/project/project-orchestration-dispatch.execution.ts`
2. Migration script: `apps/api/src/migrations/` (one-time, idempotent)

Acceptance criteria:

1. Zero in-flight items have dispatch-only enforced mid-run during rollout.
2. All `todo` items without refinement clearance are rerouted with a deterministic reason tag before guards activate.
3. Migration script is idempotent: running it twice produces the same state.
4. `legacy_execution_model` tag is visible in work item metadata and queryable via the event ledger.

---

## 7. Detailed Task Plan

### Phase A: Lock Execution Boundary and Migration Audit (parallel)

**WS1** — Validate merged changes for in-progress dispatch-only behavior; add tests; confirm commit fallback.  
**WS8** — Run migration audit; tag `legacy_execution_model` items; reroute uncleared `todo` items.
**WS9** — Hard-fix tool contract/runtime reliability defects observed in run diagnostics.

These tracks are independent. WS8 must complete before guards in Phase B/D activate.

### Phase B: Refinement Planning, Plan Persistence, and Contract Quality (parallel)

**WS2** — Replace ceremonial war-room with the concrete protocol (roles, thresholds, concern schema, signoffs).  
**WS3** — Implement single authoritative store and derived plan renderer.  
**WS5** — Add plan contract validator, subagent quality reviewer, and large-scope routing.

WS2, WS3, and WS5 have no dependency on each other and can proceed concurrently. All three require WS8 migration to be complete before activation.

### Phase C: Observability Instrumentation (parallel with Phase B)

**WS7** — Define event types, instrument all guards, write operations runbook. Can be designed and instrumented in parallel with Phase B workflow work.

### Phase D: Guard In-Progress Entry

**WS4** — Add readiness gate, override governance, and retroactive refinement queueing.

Depends on: WS2 (war room protocol must be defined before gates reference it) and WS8 (migration complete).

### Phase E: Test Coverage

**WS6** — Write all test categories against the implemented workstreams.

Depends on: all workstreams (WS1–WS5, WS7–WS9) implemented. Tests verify final behaviour across all acceptance criteria.

### Phase F: End-to-End Validation and Runbook

1. Run full targeted test suite; confirm all WS6 categories pass without lint suppressions.
2. Confirm event ledger queries in the runbook return expected values for all Section 9 metrics.
3. Publish `docs/operations/RUNBOOK-EPIC135-observability.md` and mark reviewed.
4. Confirm no `legacy_execution_model` items remain in active `in-progress` state.

---

## 8. Risks and Mitigations

1. Risk: Over-constrained workflows could stall if participant signoff never arrives.  
   Mitigation: 3-retry bounded timeout triggers degraded-signoff path; item is marked `needs_rework` with `reason: insufficient_war_room_participation` rather than hanging indefinitely.

2. Risk: Plan markdown and executionConfig drift.  
   Mitigation: Single authoritative store (`executionConfig`); `docs/plans/` is a derived render only. No sync required.

3. Risk: Override path becomes the default under deadline pressure.  
   Mitigation: Override requires P0 priority flag set by a project lead role; frequency cap of once per work item without manual acknowledgement; all overrides surface in the `override_audit` stream.

4. Risk: Increased runtime latency due to additional subagent turns (quality reviewer, war room participants).  
   Mitigation: Scope thresholds (`task_count >= 5` or `estimated_token_cost > 50k`) gate large-scope routing; quality reviewer is lightweight read-only.

5. Risk: Guard activation breaks in-flight work items mid-run.  
   Mitigation: WS8 migration audit and `legacy_execution_model` tagging must complete before guards activate; rollout is explicitly gated on migration completion.

---

## 9. Success Metrics

1. 100% of in-progress implementation runs execute code changes through subagents only.  
   **Measured by:** event ledger query — count runs where `direct_file_operation_detected: true` = 0.

2. 100% of large-scope refinement runs (`task_count >= 5` OR `estimated_token_cost > 50k`) include multi-agent war-room artifacts and signoffs.  
   **Measured by:** event ledger query — count refinement runs matching large-scope criteria where `war_room_signoff_count < 3` = 0.

3. 0 cases of unrefined work items entering in-progress without reroute or explicit P0 override.  
   **Measured by:** event ledger query — count in-progress transitions where `hasClearedRefinementOnce = false` AND `refinement_gate_overridden` event is absent = 0.

4. 100% of approved refinement outputs produce both `executionConfig` plan and rendered `docs/plans/` artifact.  
   **Measured by:** event ledger query — count `refinement_approved` events where a `plan_render_failed` event exists for the same `work_item_id` = 0.

5. Reduction in `milestone_quality_check_failed` rate over rolling 30-day window after rollout.  
   **Measured by:** event ledger query — compare `milestone_quality_check_failed` rate pre- and post-rollout activation date (keyed on `rollout_activated_at` config value).

---

## 10. Dependencies

1. Existing refinement and in-progress workflows in seed/workflows.
2. War-room orchestration tool actions in nexus_orchestrator runtime.
3. Work-item lifecycle transition services in apps/api project orchestration modules.
4. Event ledger infrastructure for typed event emission and queryability (WS7).

---

## 11. Rollout Strategy

1. Complete WS8 migration audit and tag all legacy items before any guard activation.
2. Roll out WS1/WS2/WS3/WS5/WS7 changes behind existing lifecycle trigger paths.
3. Activate WS4 readiness gates only after migration is confirmed complete.
4. Validate with targeted test runs in apps/api first.
5. Monitor event ledger for `war_room_degraded_signoff`, `plan_render_failed`, `refinement_gate_overridden`, and `milestone_quality_check_failed` events.
6. Expand to broader deterministic integration validation when e2e execution is explicitly resumed.

---

## 12. Exit Criteria

This epic is complete when all workstream acceptance criteria (WS1–WS8) are satisfied and the following integration conditions hold:

1. Phase F end-to-end validation passes without lint suppressions or policy downgrades.
2. All Section 9 success metric queries return the expected values against the live event ledger (queries defined in `docs/operations/RUNBOOK-EPIC135-observability.md`).
3. `docs/operations/RUNBOOK-EPIC135-observability.md` is published and reviewed.
4. All in-flight work items are migrated per WS8 before guards are active in production.

Workstream acceptance criteria are the authoritative definition of done for each area. This section tracks integration completeness only.
