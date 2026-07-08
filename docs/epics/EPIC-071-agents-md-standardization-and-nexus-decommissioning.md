# EPIC-071: AGENTS.md Standardization and `.nexus` Conventions Decommissioning

Status: In Progress  
Priority: P1  
Created: 2026-04-11  
Last Updated: 2026-04-11  
Owner: TBD  
Theme: Convention simplification, standards alignment, and project-level editing UX

---

## 1. Executive Summary

EPIC-069 introduced a custom `.nexus` convention subsystem (`.nexus/CONVENTIONS.md`, `.nexus/validation.yaml`) with dedicated runtime capabilities and approval workflows. The platform should now pivot to the open `AGENTS.md` convention standard, which is already supported by `pi-runner` and aligns with broader ecosystem tooling.

This epic replaces bespoke convention plumbing with `AGENTS.md`-first behavior via direct decommissioning of `.nexus` convention mechanics, and adds a project-scoped frontend editor so teams can update `AGENTS.md` directly from the web workspace.

Expected outcomes:

1. `AGENTS.md` becomes the canonical project instruction contract.
2. `.nexus`-specific runtime capabilities and convention update branches are removed.
3. Seeded prompts/workflows/tool permissions stop referencing `.nexus` and deprecated convention tools.
4. Project workspace users can view and edit root `AGENTS.md` per project through the web UI.
5. Diagnostics, tests, and docs reflect the new standard.
6. No backfill workstream is included because conventions have not yet been adopted in active project flows.

### 1.1 Implementation Notes (2026-04-11)

Completed in current implementation slice:

1. Runtime/tooling decommission landed for `read_conventions`, `validate_convention_conflict`, and `propose_convention_update`.
2. `.nexus` convention service stack under `apps/api/src/project/project-conventions.*` was removed.
3. Project orchestration/import/brief paths were migrated to `AGENTS.md` snapshot semantics.
4. Project API now exposes AGENTS file read/write endpoints:
   - `GET /projects/:id/repository/agents-file`
   - `PUT /projects/:id/repository/agents-file`
5. Web workspace now includes an AGENTS tab with etag-aware save, conflict messaging, and unsaved-change safeguards.
6. Seed prompts/workflow allowlists were migrated to remove deprecated convention-tool references and `.nexus` path usage.

---

## 2. Context and Current-State Analysis

### 2.1 Existing implementation from EPIC-069

The codebase currently includes a substantial `.nexus` implementation surface:

1. Parser/bootstrap/service stack:
   - `apps/api/src/project/project-conventions.*`
2. Orchestration hooks:
   - `apps/api/src/project/project-orchestration.service.ts`
   - `apps/api/src/project/project-import-readiness.service.ts`
   - `apps/api/src/project/project-brief.service.ts`
3. Runtime capabilities and routes:
   - `read_conventions`
   - `validate_convention_conflict`
   - `propose_convention_update`
4. Mutating-action governance specialization:
   - `propose_convention_update` mode policy + approval/apply logic.
5. Seed-level references:
   - `seed/agents/*/PROMPT.md`
   - `seed/agents/*/agent.json`
   - `seed/workflows/*.workflow.yaml`
   - `seed/project-conventions/*`

### 2.2 Current gap for project maintainers

1. There is no first-class frontend surface to edit project instructions in `AGENTS.md`.
2. Teams must currently edit repository files outside the orchestrator UI.
3. This creates friction for per-project convention updates by PM/architect/owner roles working primarily in the workspace UI.

### 2.3 Why pivot now

1. `AGENTS.md` is an open convention with growing cross-tool adoption: <https://agents.md/>.
2. `pi-runner` already supports this convention model, reducing custom maintenance burden.
3. Current `.nexus` features duplicate behavior that can be handled by standard repository files + existing git/PR governance.
4. Removing custom capability/action branches reduces policy drift and orchestration complexity.

### 2.4 Design constraints to preserve

1. Preserve orchestration lifecycle stability.
2. Preserve capability contract integrity and preflight determinism.
3. Preserve existing safety posture for mutating actions unrelated to conventions.
4. Perform a direct cleanup without introducing temporary convention compatibility branches.
5. Keep project-level AGENTS editing secure, auditable, and bounded to the project repository path.

---

## 3. Problem Statement

The current `.nexus` subsystem creates extra product-specific surface area that is now unnecessary given first-class `AGENTS.md` support in the runner ecosystem.

At the same time, maintainers lack a first-class project-scoped UI path to update `AGENTS.md`, which slows operational convention updates.

Without this pivot:

1. Instruction management remains fragmented (`AGENTS.md` ecosystem vs `.nexus` custom path).
2. Runtime/tooling complexity remains higher than needed.
3. Seeded prompts and workflow contracts continue to carry bespoke references that reduce interoperability.
4. Future onboarding and documentation remain less standard than industry tooling expects.
5. Project owners cannot quickly update `AGENTS.md` in-app.

---

## 4. Goals

1. Make `AGENTS.md` the canonical project-level instruction source.
2. Decommission `.nexus`-specific convention capabilities and mutating-action branches.
3. Add frontend ability to view/edit root `AGENTS.md` per project.
4. Provide API support for secure project-scoped read/write of `AGENTS.md`.
5. Align seeded agents/workflows/tool permissions with the new convention model.
6. Update diagnostics/tests/docs to a stable `AGENTS.md`-first contract.
7. Complete the pivot without a backfill workstream.

---

## 5. Non-Goals

1. Reworking unrelated orchestration lifecycle states from EPIC-065.
2. Introducing a new policy engine for generic repository governance.
3. Building a full multi-file collaborative document suite beyond `AGENTS.md`.
4. Changing model/provider precedence behavior.
5. Building backfill or compatibility shims for legacy convention flows.

---

## 6. Scope Overview

This epic is delivered in six workstreams:

1. **WS1: Contract and Cutover Decisions**
2. **WS2: Backend Convention Service Refactor**
3. **WS3: Runtime Capability and Governance Simplification**
4. **WS4: Seeded Agent/Workflow Alignment**
5. **WS5: Project AGENTS.md Editing Experience (API + Frontend)**
6. **WS6: Testing, Documentation, and Rollout**

---

## 7. Desired End-State Behavior

### 7.1 Project instruction source

1. `AGENTS.md` is the canonical project instruction file.
2. Nested `AGENTS.md` precedence follows standard nearest-file behavior where applicable.
3. `.nexus/CONVENTIONS.md` is no longer treated as canonical policy input.

### 7.2 Runtime behavior

1. Convention-specific capabilities (`read_conventions`, `validate_convention_conflict`, `propose_convention_update`) are removed.
2. Orchestration mode/governance has no convention-specific mutating-action special case.
3. Quality automation references `AGENTS.md` guidance and deterministic project-type checks.

### 7.3 Project editing behavior

1. Project workspace provides an `AGENTS.md` editor surface for authorized users.
2. Users can load current root `AGENTS.md`, edit, and save changes per project.
3. Save flow returns clear errors for missing repo path, missing permissions, and file write failures.
4. UI provides explicit save status and conflict-safe refresh path.

### 7.4 Decommission baseline

1. No convention compatibility aliases are exposed in runtime capability surface.
2. No convention draft/apply workflow remains in orchestration mutation flows.
3. Seeded prompts/workflows do not instruct agents to use `.nexus` convention files or removed convention tools.

---

## 8. Workstreams and Detailed Tasks

### WS1: Contract and Cutover Decisions

#### Task E071-001: Define `AGENTS.md` contract and precedence policy

Description:
Define project-level instruction contract around `AGENTS.md`, including root + nested behavior and explicit precedence semantics.

Acceptance Criteria:

1. Contract specifies canonical file: `AGENTS.md`.
2. Contract documents precedence and nearest-file resolution.
3. Contract explicitly states `.nexus` convention artifacts are decommissioned.

#### Task E071-002: Lock direct decommission scope

Description:
Finalize direct removal scope for convention capabilities and branches with no backfill or compatibility workstream.

Acceptance Criteria:

1. Scope is explicit and documented.
2. Deprecated capability/action removal list is finalized.
3. Rollback strategy is defined without introducing legacy convention compatibility surfaces.

---

### WS2: Backend Convention Service Refactor

#### Task E071-003: Refactor project conventions service to `AGENTS.md` source model

Description:
Replace `.nexus` parser/bootstrap assumptions with `AGENTS.md`-centric read and diagnostics behavior.

Acceptance Criteria:

1. Service reads and reports `AGENTS.md` status as primary contract.
2. `.nexus/validation.yaml`-specific parsing/policy semantics are removed.
3. Service output shape reflects `AGENTS.md`-first diagnostics.

References:

1. `apps/api/src/project/project-conventions.service.ts`
2. `apps/api/src/project/project-conventions.io.ts`
3. `apps/api/src/project/project-conventions.parsing.ts`
4. `apps/api/src/project/project-conventions.service.types.ts`

#### Task E071-004: Update orchestration/import/brief integration to new contract

Description:
Rewire orchestration start/import-readiness/project-brief diagnostics to consume `AGENTS.md`-based results.

Acceptance Criteria:

1. Start/import paths no longer bootstrap `.nexus` artifacts as canonical convention outputs.
2. Project brief and run diagnostics expose `AGENTS.md` readiness state.
3. Blocking reason mapping remains deterministic.

References:

1. `apps/api/src/project/project-orchestration.service.ts`
2. `apps/api/src/project/project-import-readiness.service.ts`
3. `apps/api/src/project/project-brief.service.ts`
4. `apps/api/src/project/project-brief.helpers.ts`

---

### WS3: Runtime Capability and Governance Simplification

#### Task E071-005: Remove convention-specific runtime capabilities and routes

Description:
Remove `read_conventions`, `validate_convention_conflict`, and `propose_convention_update` from manifest/controller/service wiring.

Acceptance Criteria:

1. Capability manifest/runtime entries no longer expose those tools.
2. Runtime controller/service endpoints for those tools are removed.
3. Capability contract validator and preflight tests are updated.

References:

1. `apps/api/src/tool/capability-manifest.runtime.entries.ts`
2. `apps/api/src/workflow/workflow-runtime-tools.controller.ts`
3. `apps/api/src/workflow/workflow-runtime-tools.service.ts`
4. `apps/api/src/tool/capability-contract-validator.service.spec.ts`

#### Task E071-006: Remove `propose_convention_update` mutating action specialization

Description:
Remove mutating-action enum entry, mode-policy branch, and approval apply path dedicated to convention drafts.

Acceptance Criteria:

1. `propose_convention_update` is removed from mutating-action type contracts.
2. Mode policy and preflight no longer special-case convention update action.
3. Approval operations no longer auto-apply convention drafts.

References:

1. `apps/api/src/project/project-orchestration.service.types.ts`
2. `apps/api/src/project/project-orchestration-mode-policy.service.ts`
3. `apps/api/src/project/project-orchestration-action-request-approval.operations.ts`
4. `apps/api/src/project/project-orchestration-mutating-action.execution.ts`

---

### WS4: Seeded Agent/Workflow Alignment

#### Task E071-007: Update seeded prompts from `.nexus` language to `AGENTS.md`

Description:
Update all seeded `PROMPT.md` files that currently instruct agents to consult `.nexus/CONVENTIONS.md`.

Acceptance Criteria:

1. Prompts reference nearest relevant `AGENTS.md`.
2. Prompts remove deprecated convention-tool instructions.
3. Prompt guidance remains coherent with existing orchestration expectations.

References:

1. `seed/agents/*/PROMPT.md`

#### Task E071-008: Remove deprecated convention tools from seeded profile/tool policies

Description:
Update `agent.json` and workflow permission blocks to remove deprecated convention capability names.

Acceptance Criteria:

1. `allowed_tools` lists no longer include removed convention capability names.
2. Workflow `allow_tools` lists and prompts are aligned with available capabilities.
3. Seed startup contract validation passes.

References:

1. `seed/agents/*/agent.json`
2. `seed/workflows/*.workflow.yaml`
3. `apps/api/src/database/seeds/workflows.seed.contract.spec.ts`

#### Task E071-009: Replace `.nexus/validation.yaml` quality-check instruction path

Description:
Update quality-check workflow guidance to use `AGENTS.md` testing/build instructions as primary context plus deterministic auto-detection checks.

Acceptance Criteria:

1. `automated-quality-check` prompt no longer requires `.nexus/validation.yaml`.
2. Quality-check behavior remains deterministic and auditable.
3. Regression tests cover updated prompt/contract assumptions.

References:

1. `seed/workflows/automated-quality-check.workflow.yaml`
2. `apps/api/src/workflow/workflow-bootstrap-validator.service.ts`

---

### WS5: Project AGENTS.md Editing Experience (API + Frontend)

#### Task E071-010: Add project-scoped AGENTS.md read/write API endpoints

Description:
Expose API operations to read and update root `AGENTS.md` for a project by resolving the project's repository path.

Acceptance Criteria:

1. Read endpoint returns current `AGENTS.md` content and metadata for a given project.
2. Update endpoint writes provided markdown to root `AGENTS.md` for that project.
3. Endpoints enforce project authorization and return deterministic error codes/messages.
4. Endpoint behavior is auditable via existing request/decision telemetry patterns.

References:

1. `apps/api/src/project/project.controller.ts`
2. `apps/api/src/project/project.service.ts`
3. `apps/api/src/common/git/path/git-path.service.ts`

#### Task E071-011: Add AGENTS.md editor surface in project workspace UI

Description:
Add a project-level UI surface where authorized users can view/edit/save root `AGENTS.md`.

Acceptance Criteria:

1. Workspace includes a clear `AGENTS.md` editor entry point per project.
2. Editor loads current server content, supports editing, and saves through API.
3. UI displays save status, validation errors, and retry flow.
4. Unsaved changes are preserved or warned before navigation.

References:

1. `apps/web/src/pages/project-workspace/`
2. `apps/web/src/lib/api/client.projects.ts`
3. `apps/web/src/hooks/`

#### Task E071-012: Add conflict-safe save UX and editor state safeguards

Description:
Ensure editor save flow is robust against stale content and concurrent updates.

Acceptance Criteria:

1. Save API supports version/concurrency token or equivalent conflict detection.
2. UI shows conflict state with reload/merge guidance when stale updates occur.
3. Editor provides explicit reset/reload actions.

References:

1. `apps/api/src/project/`
2. `apps/web/src/pages/project-workspace/`

---

### WS6: Testing, Documentation, and Rollout

#### Task E071-013: Update and expand automated test coverage for pivot and editor

Description:
Update tests previously bound to `.nexus` capabilities and add coverage for AGENTS editor API/UI flows.

Acceptance Criteria:

1. Unit tests cover `AGENTS.md` read/missing semantics and editor state transitions.
2. Integration tests cover removed capability surfaces and AGENTS read/write endpoints.
3. Frontend tests cover edit/save/error/conflict paths.
4. Deterministic orchestration paths remain stable.

#### Task E071-014: Update architecture/operations/docs for the new standard and UI flow

Description:
Update epic/architecture/README guidance to clearly state `AGENTS.md` as canonical and document project editor usage.

Acceptance Criteria:

1. EPIC-069 is marked superseded or amended by EPIC-071 decisions.
2. Setup/operations docs no longer claim `.nexus` as canonical convention system.
3. Documentation includes project-level AGENTS editor behavior and limitations.
4. Documentation links point to `AGENTS.md` standard references.

---

## 9. Cross-Cutting Acceptance Criteria

1. `AGENTS.md` is the canonical convention source across runtime, seeds, and docs.
2. Deprecated convention capabilities and mutating-action branches are removed.
3. Seeded workflows/prompts/profiles contain no required references to deprecated `.nexus` convention tooling.
4. Project workspace provides secure per-project `AGENTS.md` editing.
5. Workflow/capability preflight and contract validation remain green.
6. No regression is introduced in orchestration lifecycle progression.

---

## 10. Testing Strategy

### 10.1 Unit tests

1. `AGENTS.md` read/missing resolution.
2. Removal of convention-specific mode-policy and mutating-action logic.
3. Project diagnostics mapping after decommission.
4. Frontend editor state (dirty state, save success/error/conflict handling).

### 10.2 Integration tests

1. Capability manifest/registry contract after capability removals.
2. Runtime controller/service surface no longer exposes deprecated endpoints.
3. Project AGENTS read/write endpoint auth/validation/concurrency behavior.

### 10.3 E2E / deterministic regression

1. Deterministic kanban lifecycle still progresses without deprecated convention tools.
2. Quality-check workflow remains functional with updated instruction model.
3. Project user can edit/save `AGENTS.md` in workspace and observe persisted result.

---

## 11. Rollout Plan

### Phase A: Contract and service refactor

1. Introduce `AGENTS.md`-first service behavior.
2. Remove `.nexus` canonical assumptions from project convention service outputs.

### Phase B: Capability and seed cleanup

1. Remove deprecated convention capabilities and mutating-action branches.
2. Update seeded prompts/workflows/profiles in same release slice.

### Phase C: AGENTS editor rollout

1. Release project AGENTS read/write API endpoints.
2. Release frontend AGENTS editor in project workspace with conflict-safe save UX.

### Phase D: Documentation and closure

1. Publish documentation updates and supersession notes.
2. Verify no remaining runtime references to removed convention tooling.

---

## 12. Risks and Mitigations

1. **Risk:** Workflow jobs reference removed tools and fail preflight.  
   **Mitigation:** Update manifest + seed workflow permissions atomically with contract tests.

2. **Risk:** Hidden `.nexus` assumptions remain in seed prompts or workflow text.  
   **Mitigation:** Explicit seed-wide audit and contract tests for prompt/permission references.

3. **Risk:** Orchestration approval behavior regresses due action-type removal.  
   **Mitigation:** Remove action enum, mode policy, and approval specialization together with targeted tests.

4. **Risk:** Unauthorized or conflicting AGENTS edits in UI.  
   **Mitigation:** Project auth checks, deterministic validation errors, and optimistic concurrency/conflict handling.

5. **Risk:** Documentation ambiguity between EPIC-069 and EPIC-071.  
   **Mitigation:** Explicit supersession note and docs sweep in WS6.

---

## 13. Dependencies

1. EPIC-069 implementation baseline (to be superseded by this epic).
2. EPIC-065 lifecycle hardening contracts.
3. EPIC-070 prompt/agent capability alignment work (for seed surface consistency).
4. Existing project workspace UX patterns from EPIC-047 (for clean frontend integration).

---

## 14. Deliverables

1. `AGENTS.md`-first convention contract in API services.
2. Removed `.nexus` convention capability surface.
3. Updated seeded agents/workflows/profile tool policies.
4. Project-scoped AGENTS read/write API and workspace editor UX.
5. Updated tests and documentation for the new standard.

---

## 15. Definition of Done

1. All E071 tasks satisfy acceptance criteria.
2. Deprecated convention capabilities are no longer callable.
3. No convention compatibility alias or fallback convention path remains in runtime.
4. Authorized project users can edit and save root `AGENTS.md` from the frontend.
5. API tests, frontend tests, and relevant deterministic orchestration checks pass.
6. Documentation consistently describes `AGENTS.md` as canonical convention model and includes editor usage.

---

## 16. Open Questions

1. Should project editor support only root `AGENTS.md` in this phase, or also nested files?
2. Should `seed/project-conventions/` be removed immediately or archived as historical context?
3. Should AGENTS editor support markdown preview in v1 or plain text editing only?
4. Should AGENTS edits append a structured decision log entry for audit visibility?

---

## 17. References

1. `docs/epics/EPIC-069-project-level-conventions-and-configuration-management.md`
2. `apps/api/src/project/project-conventions.service.ts`
3. `apps/api/src/tool/capability-manifest.runtime.entries.ts`
4. `apps/api/src/workflow/workflow-runtime-tools.controller.ts`
5. `apps/web/src/pages/project-workspace/`
6. `seed/agents/`
7. `seed/workflows/`
8. <https://agents.md/>

