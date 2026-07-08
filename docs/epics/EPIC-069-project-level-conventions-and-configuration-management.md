# EPIC-069: Project-Level Conventions and Configuration Management

Status: Superseded by EPIC-071
Priority: P1
Created: 2026-04-10
Last Updated: 2026-04-11
Owner: TBD
Theme: Project governance, onboarding consistency, and adaptive execution quality

Superseded On: 2026-04-11
Superseded By: `docs/epics/EPIC-071-agents-md-standardization-and-nexus-decommissioning.md`

---

> Superseded: This epic is retained for historical context only. The active direction is AGENTS.md-first behavior and decommissioning of the `.nexus` subsystem under EPIC-071.

## 1. Executive Summary

This epic introduces a first-class project-level conventions system in `.nexus/` so every orchestration run, agent delegation, and quality gate executes against explicit local rules.

The core outcome is deterministic local governance:

1. New and imported projects get idempotent `.nexus/` bootstrapping.
2. Agent/runtime tools can read and validate project conventions directly.
3. Convention changes require explicit human approval through draft-and-approve workflow semantics.
4. Recurring convention conflicts can trigger evidence-based draft updates over time.

---

## 2. Current-State Analysis (Codebase vs Epic Intent)

### 2.1 Existing strengths to preserve

1. Event-driven orchestration bootstrap chain is already in place and contract-tested:
   - `seed/workflows/project-discovery-ceo.workflow.yaml`
   - `seed/workflows/project-spec-revision-ceo.workflow.yaml`
   - `seed/workflows/project-work-item-generation-ceo.workflow.yaml`
   - `apps/api/src/database/seeds/workflows.seed.contract.spec.ts`
2. Import-aware onboarding lifecycle is already modeled with explicit states:
   - `awaiting_import_readiness`, `import_assessment`, `import_ready`
   - `apps/api/src/project/project-orchestration.service.types.ts`
   - `apps/api/src/project/project-orchestration.service.ts`
3. Workflow bootstrap validation exists and can be extended:
   - `apps/api/src/workflow/workflow-bootstrap-validator.service.ts`
4. Runtime capability framework and API callback plumbing already exist:
   - `apps/api/src/tool/capability-manifest.runtime.entries.ts`
   - `apps/api/src/workflow/workflow-runtime-tools.controller.ts`
   - `apps/api/src/workflow/workflow-runtime-tools.service.ts`
5. Human approval pipeline for mutating orchestration actions already exists and is reusable:
   - `apps/api/src/database/entities/project-orchestration-action-request.entity.ts`
   - `apps/api/src/project/project-orchestration-action-request-approval.operations.ts`
   - `apps/web/src/pages/Notifications.tsx`

### 2.2 High-priority gaps this epic closes

1. No `.nexus/` bootstrap service currently exists in API lifecycle or discovery workflows.
2. No `.nexus` directory exists in repository templates by default.
3. Conventions precedence is only partially enforced in prompts (currently only subset of agents).
4. No runtime capability exists for:
   - `read_conventions`
   - `validate_convention_conflict`
   - `propose_convention_update`
5. `seed/workflows/automated-quality-check.workflow.yaml` references `.nexus/validation.yaml`, but there is no active event emitter for `QualityCheckRequestedEvent` in current runtime paths.
6. No retrospective-driven convention evolution path exists yet (dependency on EPIC-067 outcomes).

---

## 3. Problem Statement

Without a first-class project convention subsystem, agents rely on mixed global defaults, partial prompt guidance, and inferred stack behavior. This creates drift, repeated corrections, and inconsistent quality gates across projects.

We need local repository rules to be:

1. Automatically present.
2. Automatically consulted.
3. Automatically conflict-checked.
4. Human-governed when changed.

---

## 4. Goals

1. Bootstrap `.nexus/` for every onboarded project (new and imported) with stack-aware defaults.
2. Guarantee local conventions take precedence over global SOP/prompt defaults.
3. Provide callable runtime capabilities for reading conventions and validating conflicts.
4. Add a governance-safe draft approval flow for convention updates.
5. Connect recurring violations to retrospective intelligence and draft recommendations.
6. Expose diagnostics so operators can see convention status and enforcement outcomes.

---

## 5. Non-Goals

1. Replacing existing orchestration lifecycle model from EPIC-065.
2. Building a fully external marketplace for convention templates in this epic.
3. Auto-merging convention updates without user approval.
4. Reworking global model/provider precedence rules.

---

## 6. Scope

In scope:

1. `.nexus/` bootstrap contract and stack template seeding.
2. Runtime convention read/validate/propose capabilities.
3. Prompt/profile enforcement updates for all seeded agents.
4. Governance workflow for draft convention updates.
5. Quality-check integration path using `.nexus/validation.yaml`.
6. Observability, tests, rollout, and runbook updates.

Out of scope:

1. Full UI redesign for all orchestration screens.
2. Non-project-level policy engines unrelated to `.nexus/`.

---

## 7. Desired End-State Behavior

### 7.1 New project onboarding

1. Starting orchestration ensures `.nexus/CONVENTIONS.md` and `.nexus/validation.yaml` exist (or are created).
2. Generated files are stack-aware and idempotent.
3. Bootstrapping is auditable in orchestration decision timeline.

### 7.2 Imported repository onboarding

1. Existing `.nexus/` files are preserved (never overwritten silently).
2. Missing required files are created with merge-safe defaults.
3. Import readiness diagnostics include convention bootstrap state.

### 7.3 Runtime execution

1. Agents can explicitly call `read_conventions` before planning/implementation.
2. Agents can call `validate_convention_conflict` before mutating actions.
3. Quality checks resolve from `.nexus/validation.yaml` when present.

### 7.4 Convention evolution

1. Agents may propose updates only by creating draft artifacts.
2. Human approval is required before drafts become canonical `CONVENTIONS.md`.
3. Repeated conflict signals can produce draft recommendations with evidence.

---

## 8. Workstreams and Detailed Tasks

### WS1: Conventions Contract and Template Library

Objective: define a deterministic `.nexus` contract and ship baseline stack templates.

### Task E069-001: Define `.nexus` artifact contract and precedence matrix

Description:
Define required files, optional files, schema rules, and explicit precedence order.

Acceptance Criteria:

1. Contract defines required files: `CONVENTIONS.md` and `validation.yaml`.
2. Contract defines precedence: local `.nexus` overrides seeded/global SOP guidance.
3. Conflict semantics are documented with deterministic resolution outcomes.

References:

1. `docs/epics/EPIC-069-project-level-conventions-and-configuration-management.md`
2. `seed/workflows/automated-quality-check.workflow.yaml`
3. `seed/agents/senior_dev/PROMPT.md`
4. `seed/agents/staff_engineer/PROMPT.md`

### Task E069-002: Create stack-aware template library for `.nexus` seeding

Description:
Add reusable templates for Node, Python, Go, and generic repositories.

Acceptance Criteria:

1. Template location and naming are deterministic and documented.
2. Each template includes both conventions and validation command defaults.
3. Templates are consumable by startup/bootstrap logic without hardcoded per-project branches.

References:

1. `seed/README.md`
2. `apps/api/src/database/seeds/startup-seed.service.ts`
3. `seed/workflows/automated-quality-check.workflow.yaml`

### Task E069-003: Add typed conventions parser/validator service

Description:
Introduce a service that reads `.nexus` files from workspace context and returns normalized typed data plus validation errors.

Acceptance Criteria:

1. Parser returns structured model for conventions and validation commands.
2. Parser distinguishes syntax errors, missing required files, and semantic conflicts.
3. Service is reusable by runtime tools, diagnostics, and quality workflows.

References:

1. `apps/api/src/workflow/workflow-runtime-tools.service.ts`
2. `apps/api/src/workflow/workflow-runtime-tools.controller.ts`
3. `apps/api/src/project/project-brief.service.ts`

---

### WS2: Bootstrap Integration in Orchestration Lifecycle

Objective: ensure `.nexus` exists and is valid during onboarding lifecycle paths.

### Task E069-004: Implement idempotent `nexus-init` bootstrap service

Description:
Create API-side bootstrap service that materializes `.nexus` files in the project workspace and records bootstrap metadata.

Acceptance Criteria:

1. Service creates `.nexus/` only when missing and never destroys existing rules.
2. Repeated execution is idempotent.
3. Service records bootstrap result (created/skipped/errors) in orchestration metadata or decision log.

References:

1. `apps/api/src/project/project-orchestration.service.ts`
2. `apps/api/src/project/project-orchestration-lifecycle.operations.ts`
3. `apps/api/src/common/git/git-init.service.ts`

### Task E069-005: Wire `nexus-init` into discovery/start workflow path

Description:
Integrate bootstrap invocation before or during discovery so downstream agents operate with local conventions context.

Acceptance Criteria:

1. Discovery/start path always attempts bootstrap once per project lifecycle start.
2. Bootstrap failures return actionable orchestration diagnostics.
3. Critical workflow contracts remain valid after integration.

References:

1. `seed/workflows/project-discovery-ceo.workflow.yaml`
2. `apps/api/src/workflow/workflow-bootstrap-validator.service.ts`
3. `apps/api/src/database/seeds/workflows.seed.contract.spec.ts`
4. `apps/api/src/project/events/project-orchestration.events.ts`

### Task E069-006: Add import-aware merge policy for existing repos

Description:
For imported repositories, preserve existing `.nexus` files and only fill missing artifacts while reporting compatibility.

Acceptance Criteria:

1. Existing `.nexus/CONVENTIONS.md` is never overwritten without explicit approval.
2. Missing required files are created with template defaults.
3. Import readiness/diagnostics surfaces compatibility status and remediation guidance.

References:

1. `apps/api/src/project/project-import-readiness.service.ts`
2. `apps/api/src/project/project-orchestration.service.ts`
3. `apps/api/src/project/project-brief.service.ts`

### Task E069-007: Expose conventions bootstrap status in diagnostics

Description:
Extend project brief/run diagnostics payloads with conventions readiness and validation summary.

Acceptance Criteria:

1. Diagnostics include `conventions_status` and `validation_config_status`.
2. Blocking convention issues appear as structured reasons with remediation.
3. UI consumers can render convention readiness without parsing raw logs.

References:

1. `apps/api/src/project/project-brief.service.ts`
2. `apps/api/src/workflow/workflow-runtime-tools.service.ts`
3. `apps/web/src/pages/project-workspace/OrchestrationTab.state.tsx`

---

### WS3: Runtime Convention Management Capabilities

Objective: add first-class capabilities required by the epic scope.

### Task E069-008: Add `read_conventions` runtime capability

Description:
Expose a read-only runtime capability to fetch resolved `.nexus` conventions and provenance.

Acceptance Criteria:

1. Capability is registered in capability manifest and routed through runtime API callback.
2. Response includes normalized convention content and source metadata.
3. Capability is available to orchestration and specialist agents that need it.

References:

1. `apps/api/src/tool/capability-manifest.runtime.entries.ts`
2. `apps/api/src/workflow/workflow-runtime-tools.controller.ts`
3. `apps/api/src/workflow/workflow-runtime-tools.service.ts`

### Task E069-009: Add `validate_convention_conflict` runtime capability

Description:
Provide deterministic conflict analysis between intended action and local conventions.

Acceptance Criteria:

1. Capability returns `ok`, `violations`, and remediation guidance.
2. Violations are machine-readable for policy enforcement and decision logging.
3. Capability is side-effect free and safe for repeated use.

References:

1. `apps/api/src/tool/capability-manifest.runtime.entries.ts`
2. `apps/api/src/workflow/workflow-runtime-tools.controller.ts`
3. `apps/api/src/workflow/workflow-runtime-tools.service.ts`

### Task E069-010: Add `propose_convention_update` capability with draft-only behavior

Description:
Allow agents to propose changes by creating draft artifacts and metadata, not direct canonical updates.

Acceptance Criteria:

1. Capability can only write draft artifacts (for example `CONVENTIONS.DRAFT.md`).
2. Canonical `CONVENTIONS.md` updates require approval workflow completion.
3. Result payload includes draft location and approval request identifier.

References:

1. `apps/api/src/project/project-orchestration.service.ts`
2. `apps/api/src/project/project-orchestration.service.types.ts`
3. `apps/api/src/workflow/workflow-runtime-orchestration-actions.service.ts`

### Task E069-011: Wire new capability contracts across runtime and bridge layers

Description:
Ensure runtime manifest, API handlers, agent profile allowed tools, and bridge-level schemas stay aligned.

Acceptance Criteria:

1. No tool appears callable unless explicitly wired end-to-end.
2. Capability preflight reflects allow/deny/approval requirements correctly.
3. Contract tests fail on schema drift.

References:

1. `apps/api/src/tool/capability-manifest.runtime.entries.ts`
2. `apps/api/src/workflow/workflow-runtime-tools.controller.ts`
3. `apps/api/src/workflow/workflow-runtime-tools.service.ts`
4. `packages/pi-runner/src/nexus-bridge-tools/nexus-orchestrator-parameters.ts`

### Task E069-012: Enforce `.nexus`-first behavior across all seeded agent prompts/profiles

Description:
Extend currently partial prompt-level enforcement to every seeded agent profile used in orchestration lifecycle.

Acceptance Criteria:

1. All seeded agent prompts include explicit `.nexus` precedence guidance.
2. Agent profile tool lists include required convention capabilities where appropriate.
3. Seeding updates apply consistently on startup and setup initialization.

References:

1. `seed/agents/ceo-agent/PROMPT.md`
2. `seed/agents/orchestrator/PROMPT.md`
3. `seed/agents/product-manager/PROMPT.md`
4. `seed/agents/architect-agent/PROMPT.md`
5. `seed/agents/spec-generator/PROMPT.md`
6. `seed/agents/qa_automation/PROMPT.md`
7. `seed/agents/senior_dev/PROMPT.md`
8. `seed/agents/junior_dev/PROMPT.md`
9. `seed/agents/staff_engineer/PROMPT.md`

---

### WS4: Governance and Approval Workflow

Objective: guarantee human-in-the-loop approval for convention law changes.

### Task E069-013: Implement draft-to-approval workflow for convention updates

Description:
Create explicit flow from draft generation to approval/rejection and finalization.

Acceptance Criteria:

1. Draft proposals create pending action requests.
2. Approval applies draft to canonical conventions with audit metadata.
3. Rejection preserves draft history and records reason.

References:

1. `apps/api/src/database/entities/project-orchestration-action-request.entity.ts`
2. `apps/api/src/project/project-orchestration-action-request-approval.operations.ts`
3. `apps/api/src/project/project-orchestration.service.ts`

### Task E069-014: Add convention update audit trail and decision logging

Description:
Persist structured evidence for who proposed, approved, rejected, and applied convention updates.

Acceptance Criteria:

1. Decision logs capture proposal/approval/rejection lifecycle.
2. Timeline tooling can show convention updates in chronological context.
3. Audit records include actor, timestamp, and changed artifact summary.

References:

1. `apps/api/src/project/project-orchestration.service.ts`
2. `apps/api/src/workflow/workflow-runtime-tools.service.ts`
3. `apps/api/src/project/project-brief.service.ts`

### Task E069-015: Surface pending convention approvals in existing web notifications flow

Description:
Reuse existing notifications/action approval UX to handle convention update approvals.

Acceptance Criteria:

1. Pending convention updates appear in notifications and orchestration surfaces.
2. Approve/reject actions work through existing API paths.
3. UI displays draft summary and reason context for informed review.

References:

1. `apps/web/src/pages/Notifications.tsx`
2. `apps/web/src/hooks/useProjectOrchestration.ts`
3. `apps/web/src/lib/api/client.projects.ts`

---

### WS5: Learning Loop and Retrospective Integration

Objective: evolve conventions from repeated observed failures, with governance controls.

### Task E069-016: Add recurring convention conflict signal aggregation

Description:
Aggregate convention-related failures/warnings from QA, dispatch denials, and runtime diagnostics.

Acceptance Criteria:

1. Signal aggregation identifies repeated issue classes by code and context.
2. Aggregation thresholds are configurable.
3. Aggregated signals are queryable for recommendation generation.

References:

1. `apps/api/src/project/project-brief.service.ts`
2. `apps/api/src/workflow/workflow-runtime-tools.service.ts`
3. `docs/epics/EPIC-067-memory-driven-learning-and-automated-retrospectives.md`

### Task E069-017: Generate convention draft recommendations from retrospective signals

Description:
When thresholds are met, generate draft updates with rationale and link to source evidence.

Acceptance Criteria:

1. Draft recommendation includes evidence list and rationale.
2. Recommendations are never auto-applied.
3. Recommendation generation is idempotent per signal window.

References:

1. `apps/api/src/memory/distillation.consumer.ts`
2. `apps/api/src/session/session-hydration.service.ts`
3. `docs/epics/EPIC-067-memory-driven-learning-and-automated-retrospectives.md`

---

### WS6: Quality Gates, Testing, and Rollout Readiness

Objective: ensure `.nexus/validation.yaml` is truly enforceable and operationally safe.

### Task E069-018: Activate deterministic trigger path for automated quality-check workflow

Description:
Either wire `QualityCheckRequestedEvent` emission into lifecycle paths or align workflow trigger model to existing review hooks.

Acceptance Criteria:

1. Automated quality-check workflow has at least one verified live trigger path.
2. Trigger behavior is covered by integration tests.
3. Dead/unreachable trigger definitions are removed or documented as disabled.

References:

1. `seed/workflows/automated-quality-check.workflow.yaml`
2. `seed/workflows/work-item-in-review-default.workflow.yaml`
3. `apps/api/test/workflow-event-trigger-integration.e2e-spec.ts`

### Task E069-019: Enforce `.nexus/validation.yaml` execution semantics

Description:
Normalize command execution order, timeout behavior, and failure reporting for project validation config.

Acceptance Criteria:

1. Validation command execution is deterministic and ordered.
2. Failures return structured output mapped to actionable diagnostics.
3. Fallback auto-detection still works when `.nexus/validation.yaml` is absent.

References:

1. `seed/workflows/automated-quality-check.workflow.yaml`
2. `apps/api/src/workflow/workflow-runtime-tools.service.ts`
3. `apps/api/src/project/project-brief.service.ts`

### Task E069-020: Add full test coverage for conventions lifecycle

Description:
Add unit, integration, and deterministic E2E coverage for bootstrap, enforcement, conflict detection, and approval flow.

Acceptance Criteria:

1. Unit tests cover parser, precedence resolver, and conflict validator.
2. Integration tests cover runtime capabilities and action approval paths.
3. E2E tests validate discovery/bootstrap to review with `.nexus` enabled.

References:

1. `apps/api/src/database/seeds/workflows.seed.contract.spec.ts`
2. `apps/api/test/workflow-event-trigger-integration.e2e-spec.ts`
3. `packages/e2e-tests/src/kanban-lifecycle/kanban-lifecycle-runner.ts`

### Task E069-021: Update architecture and operations documentation

Description:
Document `.nexus` lifecycle, precedence model, and operational troubleshooting paths.

Acceptance Criteria:

1. Architecture docs describe where and when conventions are read and enforced.
2. Operations docs include failure diagnostics and recovery procedures.
3. Setup/onboarding docs include `.nexus` bootstrap behavior.

References:

1. `docs/architecture/tool-registry.md`
2. `docs/architecture/workflow-engine.md`
3. `docs/operations/README.md`
4. `apps/api/README.md`

---

## 9. Cross-Cutting Acceptance Criteria

1. Local `.nexus` conventions always override seeded/global SOP guidance.
2. Canonical convention files are never modified without explicit approval event.
3. Every convention update is auditable with actor, reason, and artifact delta.
4. Imported repositories preserve existing conventions unless explicitly migrated.
5. No regression is introduced in bootstrap chain events:
   - `ProjectOrchestrationStartedEvent`
   - `ProjectOrchestrationSpecsReadyEvent`
   - `ProjectOrchestrationBootstrapCompletedEvent`

---

## 10. Testing Strategy

### 10.1 Unit tests

1. `.nexus` parser and schema validation.
2. Precedence resolver.
3. Conflict validator.
4. Draft proposal payload validation.

### 10.2 Integration tests

1. Runtime tool endpoints for read/validate/propose.
2. Orchestration action request lifecycle for convention drafts.
3. Diagnostics payload enrichment.

### 10.3 E2E tests

1. New project bootstrap creates `.nexus` and proceeds through orchestration lifecycle.
2. Imported project with existing `.nexus` preserves local rules.
3. Quality-check path uses `.nexus/validation.yaml` when present.

### 10.4 Regression suites

1. Existing bootstrap workflow contract tests continue passing.
2. Deterministic kanban lifecycle suites pass with conventions enabled.

---

## 11. Rollout Plan

### Phase A: Behind-flag implementation

1. Introduce parser, bootstrap, and runtime capabilities behind feature flags.
2. Run targeted integration tests and deterministic E2E flow.

### Phase B: Prompt/profile enforcement rollout

1. Expand prompt-level `.nexus` precedence to all seeded agents.
2. Enable read/validate capabilities for selected orchestration profiles first.

### Phase C: Governance and retrospective integration

1. Enable propose/update draft flow and approval surfaces.
2. Turn on retrospective recommendation generation after EPIC-067 dependencies are ready.

### Rollback controls

1. Feature flags can disable runtime convention enforcement while preserving read-only diagnostics.
2. Bootstrap service can switch to no-op mode if filesystem/path regressions appear.

---

## 12. Risks and Mitigations

1. Risk: Convention parser false positives block execution.
   - Mitigation: soft-fail mode with diagnostics during initial rollout.
2. Risk: Overwriting imported repo conventions.
   - Mitigation: strict merge policy and immutable existing-file default.
3. Risk: Capability drift between manifest, controller, and bridge layers.
   - Mitigation: contract tests and startup validation checks.
4. Risk: Dead quality-check workflow trigger path.
   - Mitigation: explicit trigger contract tests and operational telemetry.
5. Risk: Excessive recommendation noise from retrospective signals.
   - Mitigation: thresholding, deduplication, and manual approval gate.

---

## 13. Dependencies

1. EPIC-065 for lifecycle hardening and import-aware orchestration baseline.
2. EPIC-067 for retrospective signal and memory-driven recommendation pipeline.
3. EPIC-066 for broader blueprint/template ecosystem alignment.

---

## 14. Deliverables

1. `.nexus` conventions contract specification and template library.
2. Idempotent bootstrap integration in orchestration lifecycle.
3. Runtime capabilities: `read_conventions`, `validate_convention_conflict`, `propose_convention_update`.
4. Approval-governed draft update pipeline and audit trail.
5. Active quality-check trigger path and `.nexus/validation.yaml` enforcement.
6. Comprehensive tests and updated architecture/operations documentation.

---

## 15. Definition of Done

1. All tasks E069-001 through E069-021 satisfy acceptance criteria.
2. New and imported onboarding paths deterministically handle `.nexus` bootstrap behavior.
3. Runtime convention capabilities are callable, policy-aware, and tested.
4. Convention updates cannot bypass human approval.
5. Quality-check workflow path is live, test-covered, and `.nexus/validation.yaml` aware.
6. Diagnostics expose convention readiness and conflict outcomes.
7. Targeted unit/integration tests pass and relevant E2E coverage is green.
8. Architecture and operations docs are updated and consistent with implementation.

---

## 16. Open Questions

1. Should stack templates live strictly in `seed/` or be shared from a package-level library in `packages/core`?
2. Should convention draft approvals reuse existing orchestration action request actions or introduce dedicated action types?
3. Should quality checks run only at `in-review`, or also on dispatch/start for early feedback loops?

---

## 17. References

### Related epics

1. `docs/epics/EPIC-065-orchestration-lifecycle-hardening-import-aware-onboarding.md`
2. `docs/epics/EPIC-066-ecosystem-expansion-specialized-skills-and-blueprints.md`
3. `docs/epics/EPIC-067-memory-driven-learning-and-automated-retrospectives.md`

### Key implementation anchors

1. `apps/api/src/project/project-orchestration.service.ts`
2. `apps/api/src/project/project-brief.service.ts`
3. `apps/api/src/workflow/workflow-runtime-tools.service.ts`
4. `apps/api/src/workflow/workflow-runtime-tools.controller.ts`
5. `apps/api/src/tool/capability-manifest.runtime.entries.ts`
6. `seed/workflows/project-discovery-ceo.workflow.yaml`
7. `seed/workflows/automated-quality-check.workflow.yaml`
8. `seed/agents/`
