# EPIC-113: Private Repository Import and Repository-Grounded Bootstrap

Status: Proposed
Priority: P0
Depends On: EPIC-065, EPIC-071, EPIC-074, EPIC-075
Last Updated: 2026-04-17
Owner: TBD

---

## 1. Summary

Complete the missing implementation needed to onboard an existing private GitHub repository as a first-class project, let AGENTS analyze the codebase and existing docs, find or create canonical PRD/SDD and work-item artifacts, hydrate the project state, and then continue into the normal orchestration lifecycle.

The intended end-state is:

1. A user can create or connect a project to a private GitHub repository.
2. The platform can authenticate to GitHub using a governed stored secret.
3. The platform can acquire repository access deterministically via an existing local checkout, a managed clone, or both.
4. Import-aware orchestration can inspect AGENTS.md, repository structure, existing specs, and existing planning artifacts.
5. The system can reconcile existing PRD/SDD/work-item artifacts when they already exist, and create missing canonical artifacts when they do not.
6. The system can hydrate work items into the DB projection and continue with the normal orchestration path: review, refine, create new work items, dispatch, execution, merge, and post-merge hydration.

This epic is the missing productization layer above the current partial import-aware onboarding baseline.

---

## 2. Current-State Baseline

This epic starts from a meaningful but incomplete foundation.

### 2.1 Existing capabilities already in place

1. Project creation already supports repository metadata fields:
   - `repositoryUrl`
   - `basePath`
   - `githubSecretId`
   - Files:
     - `apps/web/src/pages/projects/useProjectCreateForm.ts`
     - `apps/web/src/pages/projects/ProjectCreate.sections.tsx`
     - `apps/api/src/project/dto/create-project.dto.ts`
     - `apps/api/src/project/project.service.ts`
2. Import-aware orchestration states already exist:
   - `awaiting_import_readiness`
   - `import_assessment`
   - `import_ready`
   - File: `apps/api/src/project/project-orchestration.service.types.ts`
3. Import readiness assessment already checks repository URL presence, base path validity, branch discovery, and AGENTS.md status:
   - `apps/api/src/project/project-import-readiness.service.ts`
   - `apps/api/src/project/project-agents-file.service.ts`
4. AGENTS.md is already the canonical project instruction contract:
   - `docs/epics/EPIC-071-agents-md-standardization-and-nexus-decommissioning.md`
   - `apps/api/src/project/project-agents-file.service.ts`
   - `apps/web/src/pages/project-workspace/*`
5. Repository metadata read APIs already exist for connected repositories:
   - branches
   - file list
   - file content
   - Files:
     - `apps/api/src/project/project.controller.ts`
     - `apps/api/src/project/project-git-metadata.service.ts`
6. The orchestration bootstrap chain already exists for discovery, specs approval, and work-item generation:
   - `project_discovery_ceo`
   - `project_spec_revision_ceo`
   - `project_work_item_generation_ceo`
   - Docs:
     - `docs/architecture/ARCH-kanban-workflow.md`
     - `docs/epics/EPIC-065-orchestration-lifecycle-hardening-import-aware-onboarding.md`
7. Work-item definitions are already markdown-canonical and can be reconciled into DB state:
   - `docs/architecture/work-item-markdown-canonical-contract.md`
   - `docs/adrs/0025-markdown-work-item-publishing-pattern.md`

### 2.2 Critical gaps this epic must close

1. `githubSecretId` is stored on projects, but there is no completed end-to-end GitHub auth contract for private repository access.
2. The current repository metadata service can inspect a local checkout or call unauthenticated `git ls-remote`, but it does not use the stored project secret for private remotes.
3. Project creation binds a project to repository metadata, but does not provide a first-class managed clone/import flow for existing repositories.
4. The API supports `import_strategy`, but the current web client does not expose it.
5. Import readiness validates access prerequisites, but it does not yet perform repository-grounded discovery, spec reconciliation, or canonical artifact creation.
6. There is no explicit import pipeline that answers:
   - Which docs in the repository already function as PRD/SDD?
   - Which existing work-item or planning docs should be reconciled into canonical `docs/work-items/*.md` and planning artifacts?
   - Which artifacts are missing and must be created?
7. There is no deterministic handoff contract from repository analysis into normal orchestration once import bootstrap is complete.

---

## 3. Problem Statement

The product can currently point a project at an existing repository, and the orchestration layer has the beginning of an import-aware lifecycle, but the user outcome is still incomplete.

What the user actually needs is a full import path for a private GitHub repository:

1. Connect securely to the repository.
2. Acquire a usable workspace for analysis.
3. Let AGENTS inspect the codebase, instructions, and docs.
4. Determine whether PRD/SDD/work-item artifacts already exist.
5. Reconcile those artifacts into the platform's canonical markdown and DB-backed runtime projections.
6. Fill gaps by generating missing specs and work items.
7. Resume the normal orchestration lifecycle instead of stopping at import readiness.

Without this epic, imported-repository onboarding remains metadata-only and operator-assisted, rather than a first-class project bootstrap flow.

---

## 4. Goals

1. Support authenticated onboarding of private GitHub repositories via stored project-linked secrets.
2. Add a first-class repository acquisition strategy for import flows:
   - existing local checkout
   - managed clone
   - future-compatible hybrid refresh behavior
3. Make import orchestration repository-grounded rather than metadata-only.
4. Let AGENTS analyze AGENTS.md, repository structure, tech stack, existing docs, and git-tracked artifacts before planning.
5. Detect and reconcile existing PRD/SDD artifacts where possible instead of always regenerating from scratch.
6. Detect, reconcile, or create canonical work-item and planning artifacts from existing repository data.
7. Ensure the import flow ends in the normal lifecycle states and dispatch behavior rather than a parallel one-off mode.
8. Provide clear diagnostics, approval points, and rollback-safe behavior throughout the import flow.

## 5. Non-Goals

1. Building a generic SCM integration layer for providers beyond GitHub in this epic.
2. Replacing the existing orchestration lifecycle model from EPIC-065.
3. Replacing markdown-canonical work-item or planning artifacts.
4. Performing autonomous destructive repository rewrites during import bootstrap.
5. Solving every legacy documentation layout in one release; this epic defines detection and reconciliation rules for common, governed patterns.

---

## 6. Desired End-State Behavior

### 6.1 Project creation and repository connection

1. Users can create a project directly from an existing repository, including private GitHub repositories.
2. The Git auth secret has a defined contract and validation path.
3. The system can verify repository access during onboarding before orchestration begins.

### 6.2 Repository acquisition

1. If `basePath` points to a valid local checkout, import uses it directly.
2. If no usable local checkout exists, the platform can perform a managed clone into a governed workspace path.
3. Repository acquisition records provenance and last-sync metadata in project/orchestration state.

### 6.3 Import-aware repository analysis

1. AGENTS analyze the repository tree, AGENTS.md files, docs, package manifests, architecture docs, and planning artifacts.
2. The system emits a durable import assessment artifact summarizing:
   - stack and architecture signals
   - detected instruction sources
   - candidate PRD/SDD files
   - candidate work-item and planning files
   - gaps and ambiguities requiring approval

### 6.4 Spec reconciliation

1. If valid PRD/SDD artifacts already exist, the system adopts or normalizes them instead of blindly replacing them.
2. If only partial or non-canonical specs exist, the system can create canonical PRD/SDD artifacts derived from repository evidence.
3. If no useful specs exist, the normal discovery/spec-generation flow can create them from codebase analysis.

### 6.5 Work-item and planning reconciliation

1. Existing canonical work-item markdown under `docs/work-items/` is hydrated directly.
2. Existing non-canonical planning artifacts can be mapped into canonical work-item/planning artifacts through an explicit reconcile step.
3. New work items needed after import can be created by the normal orchestration process and published via the existing markdown-canonical path.

### 6.6 Normal orchestration handoff

1. After import bootstrap, the project enters the same orchestration phases used for native projects.
2. Review, approval, work-item generation, dispatch, implementation, merge, and post-merge hydration behave normally.
3. Import-specific context remains visible in diagnostics and summaries, but does not fork the steady-state runtime model.

---

## 7. Product and Technical Design

### 7.1 Import modes

Add explicit repository import source modes:

1. `existing_checkout`
2. `managed_clone`
3. `auto`

Rules:

1. `existing_checkout` requires a valid `basePath`.
2. `managed_clone` requires a valid repository URL and usable auth path.
3. `auto` prefers `basePath` when valid, otherwise falls back to managed clone.

### 7.2 GitHub auth secret contract

Define a first-class secret payload contract for GitHub repository access.

Minimum supported contract in this epic:

1. `type: github_pat`
2. `host: github.com` or GitHub Enterprise host
3. `token: <PAT>`
4. optional metadata:
   - `username`
   - `repo_owner`
   - `repo_name`
   - `scopes`

Rules:

1. Secret validation must happen before private-repo clone/fetch operations.
2. Secrets are referenced by ID from the project, but resolved only in controlled backend services.
3. Token material must never be surfaced in diagnostics, logs, action payloads, or prompts.

### 7.3 Repository-grounded import artifact model

Introduce an import analysis artifact stored in orchestration metadata and optionally as a canonical markdown/report artifact.

The artifact should capture:

1. repository source and acquisition strategy
2. branch and commit baseline
3. detected AGENTS.md files
4. tech stack and package/module boundaries
5. candidate PRD/SDD files and confidence
6. candidate work-item/planning artifacts and confidence
7. unresolved questions or approval-required conflicts

### 7.4 Spec reconciliation model

PRD/SDD import should be reconcile-first, not overwrite-first.

Rules:

1. Prefer adoption of existing high-confidence canonical or near-canonical specs.
2. If multiple candidate files exist, require explicit ranking and conflict reporting.
3. If existing docs are fragmentary, synthesize canonical PRD/SDD from repository evidence and preserve provenance links.
4. Generated canonical specs must reference source evidence paths where practical.

### 7.5 Work-item and planning reconciliation model

Planning artifacts remain markdown-canonical.

Rules:

1. Existing canonical markdown in `docs/work-items/` should use the existing hydrate/reconcile pipeline.
2. Existing issue backlogs, TODO docs, epics, roadmap docs, or spec task sections may be mapped into canonical work-item markdown via import reconcile workflows.
3. Imported work items must preserve source linkage metadata so operators can see where they came from.
4. Post-import authoring still uses the existing publish-and-hydrate path.

### 7.6 Handoff to steady-state orchestration

Import bootstrap should end by feeding the current orchestration lifecycle, not bypassing it.

Rules:

1. Import bootstrap must end in one of:
   - `awaiting_approval`
   - `bootstrapping`
   - `orchestrating`
   - `failed`
2. Normal work-item generation, approval, dispatch, and completion guardrails remain authoritative.
3. Import context is retained as supporting state, not a permanent alternate runtime path.

---

## 8. PR-Oriented Implementation Plan

### EPIC113-001: Define GitHub repository auth secret contract

Scope:

1. Define and document the backend secret payload contract for GitHub auth.
2. Validate project-linked secret compatibility for private repository access.

Expected files:

1. `apps/api/src/project/*github*`
2. `apps/api/src/ai-config/dto/secrets/*`
3. `docs/operations/*`

Acceptance criteria:

1. Supported GitHub secret payload shape is explicit and validated.
2. Invalid or incompatible secret payloads fail with actionable diagnostics.
3. Secret values remain redacted in all observable surfaces.

### EPIC113-002: Wire project git operations to governed private-repo auth

Scope:

1. Update repository metadata and acquisition services to use the project-linked secret where needed.
2. Support authenticated branch discovery, fetch, and clone for private GitHub repositories.

Expected files:

1. `apps/api/src/project/project-git-metadata.service.ts`
2. `apps/api/src/common/git/*`
3. `apps/api/src/project/project.service.ts`

Acceptance criteria:

1. Private repository branch discovery works with configured project auth.
2. Managed fetch/clone paths work without leaking credentials.
3. Existing public-repo and local-checkout behavior remains intact.

### EPIC113-003: Implement repository acquisition strategy for import flows

Scope:

1. Add import source mode and managed clone support.
2. Persist acquisition provenance and resolved repository path.

Expected files:

1. `apps/api/src/project/project-orchestration-import.service.ts`
2. `apps/api/src/common/git/*`
3. `apps/api/src/project/project-orchestration.service.ts`

Acceptance criteria:

1. Import can use either an existing checkout or a managed clone.
2. Acquisition result is recorded in orchestration metadata.
3. Failure reasons are explicit and operator-actionable.

### EPIC113-004: Expose import controls in project creation and orchestration start UX

Scope:

1. Extend frontend/API contracts so users can select import strategy and acquisition mode.
2. Clarify Git auth secret usage in the project creation UX.

Expected files:

1. `apps/web/src/pages/projects/*`
2. `apps/web/src/pages/project-workspace/*`
3. `apps/web/src/lib/api/client.projects.ts`
4. `apps/web/src/lib/api/client.projects.types.ts`

Acceptance criteria:

1. Users can explicitly choose import behavior instead of relying on hidden API-only options.
2. UX explains whether the flow will reuse a checkout or perform a managed clone.
3. Import failures surface structured readiness issues.

### EPIC113-005: Create repository analysis and import assessment workflow

Scope:

1. Add a repository-grounded analysis workflow that runs after access acquisition and before spec reconciliation.
2. Produce a durable import assessment artifact.

Expected files:

1. `seed/workflows/*import*`
2. `apps/api/src/project/*`
3. `docs/architecture/*`

Acceptance criteria:

1. The workflow inspects repository structure, AGENTS.md, manifests, and docs.
2. It outputs a structured inventory of candidate canonical artifacts and unresolved gaps.
3. The artifact is preserved in orchestration metadata or linked canonical markdown.

### EPIC113-006: Implement PRD/SDD discovery and reconciliation

Scope:

1. Detect candidate PRD/SDD docs in imported repositories.
2. Add reconcile logic to adopt, normalize, or generate canonical specs.

Expected files:

1. `apps/api/src/project/*spec*`
2. `apps/api/src/project/project-orchestration*.ts`
3. `seed/workflows/project-discovery-ceo.workflow.yaml`
4. `seed/workflows/project-spec-revision-ceo.workflow.yaml`

Acceptance criteria:

1. Existing high-confidence PRD/SDD docs are preserved and adopted where appropriate.
2. Missing or partial specs can be created from repository evidence.
3. Conflicts between multiple candidate docs are reported explicitly for review.

### EPIC113-007: Reconcile existing planning artifacts into canonical work-item/planning markdown

Scope:

1. Detect existing work-item or planning sources in imported repositories.
2. Create or normalize canonical markdown artifacts used by the system.

Expected files:

1. `apps/api/src/workflow/step-hydrate-work-items*`
2. `apps/api/src/project/*planning*`
3. `docs/architecture/work-item-markdown-canonical-contract.md`

Acceptance criteria:

1. Existing canonical `docs/work-items/*.md` is hydrated directly.
2. Non-canonical planning artifacts can be transformed into canonical markdown with provenance.
3. The resulting projection is idempotent and safe to rerun.

### EPIC113-008: Define import-to-normal-orchestration handoff contract

Scope:

1. Formalize when import bootstrap is considered complete.
2. Ensure approval, dispatch, and post-bootstrap orchestration continue through normal lifecycle paths.

Expected files:

1. `apps/api/src/project/project-orchestration-lifecycle.operations.ts`
2. `apps/api/src/project/project-orchestration.service.ts`
3. `docs/WORKFLOW_EVENT_TRIGGERS.md`
4. `docs/architecture/ARCH-kanban-workflow.md`

Acceptance criteria:

1. Import bootstrap completion transitions are deterministic.
2. Normal orchestration cycle and dispatch triggers remain authoritative after import.
3. Import context remains inspectable in summaries and diagnostics.

### EPIC113-009: Add diagnostics, tests, and runbooks for repository import bootstrap

Scope:

1. Add unit/integration coverage for auth, acquisition, repository analysis, reconciliation, and handoff.
2. Document the operational recovery path for failed imports.

Expected files:

1. `apps/api/src/project/*.spec.ts`
2. `apps/web/src/**/*.spec.tsx`
3. `docs/operations/*`
4. `packages/e2e-tests/*` when import E2E coverage is resumed

Acceptance criteria:

1. Private-repo onboarding paths are covered by deterministic tests.
2. Diagnostics identify auth, clone, analysis, spec conflict, and hydration failures distinctly.
3. Operators have a clear recovery and retry procedure.

---

## 9. Acceptance Criteria

1. A project can be created from or connected to a private GitHub repository using a governed stored secret.
2. The system can access the repository using either a valid local checkout or a managed authenticated clone.
3. Import orchestration produces a repository-grounded analysis artifact rather than relying only on metadata.
4. Existing AGENTS.md, PRD, SDD, and work-item/planning artifacts are discovered and reconciled where possible.
5. Missing canonical PRD/SDD/work-item artifacts can be created from repository evidence when needed.
6. Canonical work-item markdown can be hydrated into runtime work-item state for imported projects.
7. After import bootstrap, the project proceeds through the normal orchestration lifecycle without a forked long-term mode.
8. Diagnostics clearly explain failures in auth, acquisition, analysis, reconciliation, approval, or hydration.

---

## 10. Risks and Mitigations

1. Risk: private-repo auth handling leaks into logs or prompts.
   Mitigation: keep credential resolution in backend-only services, redact aggressively, and add explicit tests.
2. Risk: imported repositories contain multiple conflicting docs that look like PRD/SDD.
   Mitigation: use confidence scoring plus approval-required conflict reporting instead of silent adoption.
3. Risk: repositories use non-standard planning structures that cannot be mapped deterministically.
   Mitigation: support partial import with explicit gap artifacts and allow the normal discovery flow to create missing canonical docs.
4. Risk: import bootstrap becomes a permanent parallel orchestration path.
   Mitigation: define a strict handoff contract into the existing lifecycle and reuse existing approval/dispatch machinery.
5. Risk: managed clone introduces workspace/path drift versus local checkout behavior.
   Mitigation: record acquisition provenance and normalize all downstream logic against a resolved repository path abstraction.

---

## 11. Definition of Done

1. Private GitHub repository onboarding works end-to-end in API and web UX.
2. Stored project auth secrets are validated and actually used for governed repository access.
3. Repository analysis can classify existing AGENTS/spec/planning artifacts and produce durable import assessment output.
4. PRD/SDD/work-item reconcile behavior is deterministic, idempotent, and operator-auditable.
5. Normal orchestration resumes after import bootstrap without special manual repair steps.
6. Tests, diagnostics, and runbooks cover the supported import paths and failure modes.

---

## 12. Notes

This epic should be treated as the delivery epic for the user-facing promise implied by the existing repository connection fields and import-aware states.

EPIC-065 established the lifecycle vocabulary for import-aware onboarding.
EPIC-071 established AGENTS.md as the canonical instruction source.
EPIC-074 and EPIC-075 established markdown-canonical work-item and planning artifacts.

EPIC-113 is the finishing layer that makes those pieces function together as a real repository import product, especially for private GitHub repositories.
