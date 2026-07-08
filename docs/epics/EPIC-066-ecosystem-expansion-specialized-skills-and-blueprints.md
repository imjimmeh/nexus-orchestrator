# EPIC-066: Ecosystem Expansion - Specialized Skills and Task Blueprints

Status: Proposed
Priority: P1 (High)
Created: 2026-04-10
Last Updated: 2026-04-10
Owner: TBD
Theme: Reusable capability packs and repeatable delivery flows

---

## 1. Executive Summary

EPIC-066 expands the orchestrator from "platform primitives" to "ready-to-use delivery accelerators" by shipping:

1. A curated set of specialized mounted skills for common middle-lifecycle work.
2. A set of reusable workflow blueprints that encode standard engineering paths.

This epic is intentionally built on top of existing foundations already in the codebase:

1. Filesystem-backed mounted skills and profile assignment.
2. Stage-aware skill selection policy.
3. Workflow composition primitives (`invoke_workflow`).
4. Orchestration delegation primitives (`invoke_agent_workflow`).

The net-new work is not core runtime plumbing. It is productizing concrete, high-value skill packs and blueprint workflows with strict acceptance criteria and deterministic tests.

---

## 2. Context and Codebase Analysis

### 2.1 Existing capabilities we can leverage

1. Agent skill lifecycle and runtime mount already exist.
   - Skills are filesystem-native (`NEXUS_SKILLS_LIBRARY_PATH`) and mounted read-only in runner containers.
   - Profile assignment and stage-aware skill policy are documented and implemented.
   - References:
     - `docs/architecture/agent-skills.md`
     - `seed/skills/*`

2. Delegation to agent workflows already exists and is production-grade.
   - `invoke_agent_workflow` supports `workflow_id` and/or `agent_profile`, includes guardrails, and can route through a generic delegation workflow.
   - References:
     - `apps/api/src/project/project-orchestration-workflow-invocation.service.ts`
     - `seed/workflows/orchestration-invoke-agent-default.workflow.yaml`

3. Blueprint composition primitives already exist in the workflow engine.
   - `invoke_workflow` is validated and supported in runtime.
   - References:
     - `docs/architecture/workflow-engine.md`
     - `docs/architecture/agent-capability-orchestration.md`

4. A QA building block already exists.
   - `automated_quality_check` provides a base event-driven QA flow with project-type detection.
   - Reference:
     - `seed/workflows/automated-quality-check.workflow.yaml`

### 2.2 Gaps EPIC-066 must close

1. No seeded skills currently exist for:
   - `test-generator`
   - `api-doc-sync`
   - `refactor-expert`
   - `dependency-updater`

2. No seeded blueprint workflows currently exist for:
   - `standard-feature-flow`
   - `hotfix-flow`
   - `documentation-audit`

3. No explicit compatibility contract exists that standardizes how specialized skills stay language-agnostic while still being deterministic.

4. No dedicated E2E validation matrix currently proves end-to-end behavior for these blueprints.

### 2.3 Design constraints to preserve

1. Preserve AI config precedence behavior (step override -> profile -> DB defaults -> env fallback).
2. Preserve orchestration safety guardrails around `invoke_agent_workflow` (especially orchestrating-state restrictions).
3. Preserve existing bounded contexts:
   - `apps/api`: workflow runtime, orchestration, seeding, validation.
   - `apps/web`: only if UI exposure is in scope.
   - `packages/e2e-tests`: integration and deterministic behavior checks.

---

## 3. Goals

1. Provide specialized, reusable, language-agnostic mounted skills for testing, docs sync, refactoring, and dependency updates.
2. Ship reusable blueprint workflows that reduce custom workflow authoring for common delivery patterns.
3. Keep blueprints auditable and composable through existing workflow and orchestration primitives.
4. Improve out-of-the-box project acceleration while maintaining governance and deterministic validation.

---

## 4. Non-Goals

1. Rebuilding the core skills runtime or replacing EPIC-057 skill architecture.
2. Introducing a public marketplace/registry for external skill distribution.
3. Replacing existing lifecycle workflows (refinement, in-progress, review, merge, hydration).
4. Adding new model/provider orchestration semantics in this epic.

---

## 5. Scope Overview

This epic is delivered in six workstreams:

1. WS1: Specialized Skill Pack Authoring
2. WS2: Skill Assignment and Stage Policy Integration
3. WS3: Task Blueprint Workflow Authoring
4. WS4: Orchestration Integration and Governance
5. WS5: Validation and Regression Coverage
6. WS6: Documentation, Rollout, and Operational Readiness

---

## 6. Workstreams and Detailed Tasks

### WS1: Specialized Skill Pack Authoring

Objective: create production-ready mounted skill packs for the four targeted domains.

### Task E066-001: Define specialized skill contract and authoring template

Description:
Create a standard contract for EPIC-066 skill packs that enforces consistency across frontmatter, activation criteria, command policy, and output format.

Acceptance Criteria:

1. A reusable authoring template exists and is applied to all EPIC-066 skills.
2. Each skill has explicit sections for:
   - when to activate,
   - required inputs/context,
   - execution guidance,
   - safety constraints,
   - output expectations.
3. Contract explicitly defines language-agnostic discovery order (project config first, then auto-detection).

References:

1. `docs/architecture/agent-skills.md`
2. `seed/skills/`

### Task E066-002: Implement `test-generator` mounted skill

Description:
Add a new `test-generator` skill pack to guide agents through targeted test generation and validation with minimal-noise first passes.

Acceptance Criteria:

1. New skill exists at `seed/skills/test-generator/SKILL.md` with valid frontmatter.
2. Guidance covers unit/integration test strategy and edge-case checklist.
3. Guidance enforces "targeted tests first, broad suite second" behavior.
4. Skill includes language-agnostic detection guidance for common test runners.

References:

1. `seed/skills/qa-regression-check/SKILL.md`
2. `packages/e2e-tests/`

### Task E066-003: Implement `api-doc-sync` mounted skill

Description:
Add `api-doc-sync` to align code, API contracts, and docs artifacts (OpenAPI/Swagger/README) after code changes.

Acceptance Criteria:

1. New skill exists at `seed/skills/api-doc-sync/SKILL.md` with valid frontmatter.
2. Skill defines concrete "code vs docs drift" checks.
3. Skill includes update order: contract/source of truth first, generated or mirrored docs second.
4. Skill includes failure handling for incomplete API context.

References:

1. `apps/api/README.md`
2. `docs/architecture/rest-api.md`
3. `README.md`

### Task E066-004: Implement `refactor-expert` mounted skill

Description:
Add `refactor-expert` for safe structural improvements with focus on small surface area changes and regression safety.

Acceptance Criteria:

1. New skill exists at `seed/skills/refactor-expert/SKILL.md` with valid frontmatter.
2. Skill includes explicit guardrails for incremental refactors and invariant preservation.
3. Skill includes "before/after verification" steps (tests, typecheck, lint).
4. Skill includes anti-pattern checklist (large unrelated rewrites, accidental behavior drift).

References:

1. `docs/SDD.md`
2. `docs/architecture/workflow-engine.md`

### Task E066-005: Implement `dependency-updater` mounted skill

Description:
Add `dependency-updater` for safe dependency upgrades with lockfile integrity, targeted risk control, and rollback guidance.

Acceptance Criteria:

1. New skill exists at `seed/skills/dependency-updater/SKILL.md` with valid frontmatter.
2. Skill defines patch/minor/major upgrade policy and required validation depth for each.
3. Skill includes lockfile and workspace impact checks.
4. Skill requires explicit rollback notes when update risk is non-trivial.

References:

1. `package.json`
2. `package-lock.json`
3. `docs/operations/`

---

### WS2: Skill Assignment and Stage Policy Integration

Objective: make EPIC-066 skills operationally usable through profile assignment and lifecycle stage policy.

### Task E066-006: Integrate new skills into stage-specific policy defaults

Description:
Update stage policy defaults to include/exclude the new skills per lifecycle stage and profile responsibilities.

Acceptance Criteria:

1. Stage-policy mapping for EPIC-066 skills is explicitly documented.
2. Discovery/decomposition stages do not over-activate implementation-only skills.
3. Implementation/review stages include relevant specialized skills.
4. Policy fallback behavior remains profile-safe when policy is absent.

References:

1. `docs/architecture/agent-skills.md`
2. `docs/epics/EPIC-065-orchestration-lifecycle-hardening-import-aware-onboarding.md`

### Task E066-007: Seed and validate profile skill assignments

Description:
Assign EPIC-066 skills to relevant agent profiles and validate assignment integrity during seed/startup.

Acceptance Criteria:

1. Profiles used in orchestration flows have deterministic EPIC-066 skill assignments.
2. Startup/seed validation fails fast on unknown skill references.
3. Assignment changes are reflected in runtime diagnostics (`effective_skills`).

References:

1. `seed/agents/`
2. `seed/skills/`
3. `docs/architecture/agent-skills.md`

### Task E066-008: Add diagnostics for specialized skill activation

Description:
Improve diagnostics payloads and logs to expose when and why a specialized skill is effective for a run.

Acceptance Criteria:

1. Diagnostics include stage, profile, included skills, excluded skills, and policy source.
2. Troubleshooting output is sufficient to explain missing-skill behavior without manual DB inspection.
3. No sensitive data is logged.

References:

1. `docs/architecture/agent-skills.md`
2. `docs/operations/`

---

### WS3: Task Blueprint Workflow Authoring

Objective: deliver reusable workflow blueprints for common engineering patterns.

### Task E066-009: Implement `standard-feature-flow` blueprint workflow

Description:
Create a workflow blueprint that orchestrates Discovery -> SDD -> Implementation -> Automated QA -> Review.

Acceptance Criteria:

1. New seeded workflow exists (workflow ID `standard_feature_flow`).
2. Blueprint composes existing primitives (`invoke_workflow`, `invoke_agent_workflow`) instead of duplicating logic.
3. QA stage reuses or invokes `automated_quality_check`.
4. Workflow emits clear status transitions and terminal outcomes.

References:

1. `seed/workflows/`
2. `seed/workflows/automated-quality-check.workflow.yaml`
3. `seed/workflows/project-discovery-ceo.workflow.yaml`
4. `seed/workflows/project-spec-revision-ceo.workflow.yaml`

### Task E066-010: Implement `hotfix-flow` blueprint workflow

Description:
Create a fast-path blueprint for urgent fixes: direct implementation -> automated QA -> review, while preserving governance.

Acceptance Criteria:

1. New seeded workflow exists (workflow ID `hotfix_flow`).
2. Deep discovery/spec generation is skipped by design, but risk context and scope statement are mandatory.
3. Automated QA and review are mandatory gates before completion.
4. Failure path includes rollback guidance output.

References:

1. `seed/workflows/`
2. `seed/workflows/automated-quality-check.workflow.yaml`

### Task E066-011: Implement `documentation-audit` blueprint workflow

Description:
Create a blueprint that audits documentation against code and produces actionable drift findings.

Acceptance Criteria:

1. New seeded workflow exists (workflow ID `documentation_audit`).
2. Blueprint evaluates API docs, architecture docs, and operational runbooks where applicable.
3. Output includes categorized findings: missing docs, stale docs, conflicting docs.
4. Output includes remediation plan with prioritized actions.

References:

1. `docs/architecture/`
2. `docs/operations/`
3. `README.md`

### Task E066-012: Add common blueprint input contract and validation rules

Description:
Define and enforce a consistent trigger/input contract across all EPIC-066 blueprints.

Acceptance Criteria:

1. Shared required fields are documented and validated (for example: `projectId`, `objective`, `requested_by`).
2. Optional fields have explicit defaults (for example: risk level, scope boundaries, artifacts paths).
3. Validation failures are precise and actionable.

References:

1. `apps/api/src/workflow/validation/`
2. `docs/architecture/workflow-engine.md`

---

### WS4: Orchestration Integration and Governance

Objective: ensure blueprints can be invoked safely and observably from orchestration flows.

### Task E066-013: Integrate blueprint invocation into orchestration pathways

Description:
Enable CEO/orchestration flows to invoke blueprint workflows by stable symbolic IDs, aligned with existing invocation guardrails.

Acceptance Criteria:

1. Orchestration can invoke EPIC-066 blueprint workflows through existing approved mechanisms.
2. Symbolic ID resolution is deterministic and covered by tests.
3. Orchestrating-state restrictions continue to block disallowed bootstrap targets while allowing approved blueprint targets.

References:

1. `apps/api/src/project/project-orchestration-workflow-invocation.service.ts`
2. `apps/api/src/project/project-orchestration-workflow-invocation.helpers.ts`
3. `seed/workflows/project-orchestration-cycle-ceo.workflow.yaml`

### Task E066-014: Update prompts and operating guidance for blueprint-aware delegation

Description:
Update CEO and specialist prompt guidance to choose blueprint workflows when appropriate and avoid ad-hoc orchestration boilerplate.

Acceptance Criteria:

1. Prompt guidance clearly differentiates when to use standard feature, hotfix, and documentation audit blueprints.
2. Guidance preserves existing governance language around delegation and approval flow.
3. No conflict is introduced with current workflow IDs and allowed action sets.

References:

1. `seed/agents/ceo-agent/PROMPT.md`
2. `seed/workflows/project-orchestration-cycle-ceo.workflow.yaml`
3. `seed/workflows/project-orchestration-refinement-ceo.workflow.yaml`

---

### WS5: Validation and Regression Coverage

Objective: prove EPIC-066 behavior with deterministic unit/integration/E2E coverage.

### Task E066-015: Add API/runtime tests for skill and blueprint contract enforcement

Description:
Add targeted tests for workflow validation, invocation helpers, and skill-policy resolution where EPIC-066 adds behavior.

Acceptance Criteria:

1. Validation tests cover required blueprint fields and rejection messages.
2. Invocation tests cover symbolic IDs, allowed/blocked targets, and profile/workflow mismatch paths.
3. Skill-policy tests cover stage/profile inclusion and fallback behavior.

References:

1. `apps/api/src/workflow/workflow-validation.service.spec.ts`
2. `apps/api/src/project/project-orchestration.service.spec.ts`
3. `apps/api/src/project/project-orchestration-actions.e2e-spec.ts`

### Task E066-016: Add deterministic blueprint E2E scenarios

Description:
Add E2E scenarios for each new blueprint with at least one success and one controlled failure path.

Acceptance Criteria:

1. `standard_feature_flow` success path validates final outcomes and emitted events.
2. `hotfix_flow` validates QA/review gates and failure-to-rollback reporting.
3. `documentation_audit` validates categorized drift output.
4. Tests run in deterministic mode and are CI-stable.

References:

1. `packages/e2e-tests/`
2. `e2e-test-kanban-lifecycle.mjs`

### Task E066-017: Regression checks for existing lifecycle workflows

Description:
Verify EPIC-066 additions do not regress discovery/spec/work-item orchestration flows.

Acceptance Criteria:

1. Existing baseline orchestration E2E suite remains green after EPIC-066 changes.
2. No regression in dispatch, phase transitions, or completion behavior.
3. Any intentional behavior changes are documented with migration notes.

References:

1. `seed/workflows/project-discovery-ceo.workflow.yaml`
2. `seed/workflows/project-spec-revision-ceo.workflow.yaml`
3. `seed/workflows/project-work-item-generation-ceo.workflow.yaml`

---

### WS6: Documentation, Rollout, and Operational Readiness

Objective: make EPIC-066 operable by default and easy to adopt safely.

### Task E066-018: Update architecture and operator docs for specialized skills and blueprints

Description:
Document blueprint contracts, invocation semantics, and skill assignment expectations.

Acceptance Criteria:

1. Architecture docs include EPIC-066 blueprint model and runtime interaction points.
2. Operational docs include troubleshooting for missing skills and failed blueprint invocations.
3. Documentation links to existing source-of-truth architecture docs instead of duplicating internals.

References:

1. `docs/architecture/agent-skills.md`
2. `docs/architecture/workflow-engine.md`
3. `docs/architecture/rest-api.md`
4. `docs/operations/`

### Task E066-019: Define rollout, feature toggles, and fallback plan

Description:
Introduce a safe rollout sequence with optional gating and explicit rollback behavior.

Acceptance Criteria:

1. Rollout plan defines dev -> staging -> production promotion gates.
2. If a blueprint fails in production, fallback to existing non-blueprint orchestration remains possible.
3. Rollback procedure for seeded workflow/skill artifacts is documented and tested in staging.

References:

1. `docs/operations/`
2. `seed/workflows/`
3. `seed/skills/`

### Task E066-020: Add operational telemetry for blueprint adoption and outcomes

Description:
Track blueprint invocation counts, success/failure rates, and top failure reasons.

Acceptance Criteria:

1. Telemetry events can distinguish blueprint type and terminal outcome.
2. Dashboard or report view can identify failing blueprint patterns.
3. Metrics can support a post-rollout quality review.

References:

1. `apps/api/src/telemetry/`
2. `docs/architecture/telemetry-gateway.md`

---

## 7. Cross-Cutting Acceptance Criteria

1. All four specialized skills exist as valid mounted skills with consistent contracts.
2. All three blueprints are seeded, validated, and runnable with deterministic inputs.
3. Blueprint execution composes existing runtime primitives instead of duplicating orchestration logic.
4. Stage/profile skill selection remains deterministic and diagnosable.
5. Orchestration governance guardrails remain intact (no unauthorized or unsafe invocation paths).
6. Targeted unit/integration tests and deterministic E2E coverage are green for EPIC-066 paths.
7. Existing orchestration lifecycle baseline tests remain green (no major regression).
8. Documentation and runbooks are updated for operators and maintainers.

---

## 8. Delivery Sequence (Recommended)

1. WS1 first: author skill packs.
2. WS2 second: assignment and stage policy integration.
3. WS3 third: implement blueprints using existing workflow primitives.
4. WS4 fourth: integrate safe invocation from orchestration paths.
5. WS5 fifth: lock quality and regression coverage.
6. WS6 last: finalize docs, telemetry, and rollout.

---

## 9. Risks and Mitigations

1. Risk: blueprint sprawl or overlap with existing workflows.
   - Mitigation: enforce clear input contracts and map each blueprint to a distinct use case.

2. Risk: over-activation of specialized skills causing noisy behavior.
   - Mitigation: stage-specific include/exclude policy with diagnostics and fallback.

3. Risk: language-agnostic guidance becomes too generic and ineffective.
   - Mitigation: define project-config-first detection and language-specific fallback trees.

4. Risk: regressions in orchestration guardrails.
   - Mitigation: extend existing invocation helper tests and add deterministic E2E for blocked/allowed paths.

5. Risk: operational confusion during rollout.
   - Mitigation: document fallback playbooks and publish telemetry-backed rollout checkpoints.

---

## 10. Dependencies

1. EPIC-057 skill lifecycle architecture must remain stable (`docs/epics/EPIC-057-agent-skills-management-and-runner-sync.md`).
2. EPIC-065 stage-aware orchestration and skill policy semantics should be preserved (`docs/epics/EPIC-065-orchestration-lifecycle-hardening-import-aware-onboarding.md`).
3. Existing workflow seeding and validation tooling must support new blueprint artifacts.

---

## 11. Open Questions

1. Should blueprint workflows be event-triggered only, manually invocable only, or both?
2. Should EPIC-066 include a Web UI picker for blueprint launch in this phase, or keep API/workflow-driven invocation only?
3. Do we require per-blueprint policy controls (allow/deny by profile) in v1, or rely on existing orchestration controls?
4. Do we want blueprint version pinning semantics in v1 or defer to a follow-up epic?

---

## 12. Definition of Done

EPIC-066 is done when all of the following are true:

1. `test-generator`, `api-doc-sync`, `refactor-expert`, and `dependency-updater` are seeded and operational as mounted skills.
2. `standard_feature_flow`, `hotfix_flow`, and `documentation_audit` are seeded, validated, and runnable in deterministic environments.
3. Stage/profile policy integration for EPIC-066 skills is documented and observable in diagnostics.
4. Invocation guardrails are preserved and covered by tests for allowed and blocked pathways.
5. Targeted API/runtime tests and deterministic E2E tests for EPIC-066 paths are green.
6. Existing orchestration baseline tests remain green after EPIC-066 changes.
7. Architecture and operations documentation is updated with rollout and fallback guidance.
8. Telemetry exists for blueprint adoption and failure analysis.
