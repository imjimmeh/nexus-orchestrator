# EPIC-131: Design Ingestion Workflows

**Epic ID:** EPIC-131  
**Status:** Proposed  
**Priority:** P0 - Critical  
**Theme:** Workflow Definitions, Orchestration, Git Integration  
**Created:** 2026-04-19  
**Depends On:** EPIC-128 (Steering Foundation), EPIC-129 (Ingestion Tools), EPIC-130 (Profiles)

---

## 1. Context

With the steering framework (EPIC-128) providing intent parsing and dynamic workflow invocation, the ingestion tools (EPIC-129) enabling multi-modal input processing, and the specialized profiles (EPIC-130) ready for analysis, we now need the actual workflow definitions that orchestrate the design ingestion pipeline. These workflows are what the CEO agent invokes when it parses a "ingest these designs" intent from the user.

**Current State:**
- Workflow engine supports manual, webhook, and event triggers
- Existing workflows: `work-item-refinement-default`, `work-item-in-progress-default`
- Worktree provisioning via `manage_worktree` step type
- Execution jobs run agents in containers
- No ingestion-specific workflows exist

**Target State:**
- `design-ingestion-new-project` workflow: Full pipeline for new projects
- `design-ingestion-existing-project` workflow: Delta analysis for existing projects
- `artifact-review-gate` workflow: Human approval for generated artifacts
- All workflows use worktrees for isolation
- Commit verification loops ensure all work is saved
- CEO can invoke these dynamically from chat

---

## 2. References

**Architecture:**
- `docs/architecture/workflow-engine.md`
- `docs/guides/workflow-web-automation-step-authoring.md`
- `docs/epics/EPIC-034-workflow-driven-kanban-lifecycle.md`
- `docs/epics/EPIC-053-pre-flight-planning-pipeline-pm-architect.md`
- `docs/epics/EPIC-128-conversational-orchestrator-steering-foundation.md`

**Implementation Files:**
- `seed/workflows/` — Workflow definitions
- `apps/api/src/workflow/` — Workflow engine services
- `apps/api/src/project/project-orchestration.service.ts` — Orchestration
- `apps/api/src/project/project-orchestration-dispatch.execution.ts` — Dispatch

**Related Skills:**
- `workflow-yaml-authoring` — For workflow definitions
- `special-step-handler-implementation` — If new step types needed

---

## 3. PR-Ready Tasks

### Task 1: Create `design-ingestion-new-project` Workflow

**Scope:** Full ingestion pipeline for creating a new project from designs.

**Files:**
- Create: `seed/workflows/design-ingestion-new-project.workflow.yaml`
- Create: `seed/workflows/prompts/design-ingestion/analyze.md`
- Create: `seed/workflows/prompts/design-ingestion/generate-prd.md`
- Create: `seed/workflows/prompts/design-ingestion/generate-sdd.md`

**Acceptance Criteria:**
- Trigger: manual (with inputs: `files`, `urls`, `projectName`)
- Jobs:
  1. `provision_worktree` — Create worktree for ingestion
  2. `place_inputs` — Copy files and URLs into worktree
  3. `analyze_inputs` — Design analyst analyzes all inputs
  4. `verify_analysis_commits` — Git verifier checks/commits
  5. `generate_prd` — PM creates PRD
  6. `generate_sdd` — Architect creates SDD
  7. `validate_artifacts` — Cross-reference PRD/SDD
  8. `merge_worktree` — Merge to main
  9. `create_work_items` — Generate work items in refinement
- Uses correct agent profiles for each step
- Includes commit verification loop (retry if uncommitted)
- Sets `source: design_ingestion` metadata on work items

**Definition of Done:**
- [ ] Workflow YAML valid and parseable
- [ ] Workflow seeds successfully on startup
- [ ] Can be triggered manually via API
- [ ] All jobs execute in test run

---

### Task 2: Create `design-ingestion-existing-project` Workflow

**Scope:** Ingestion pipeline for adding to an existing project.

**Files:**
- Create: `seed/workflows/design-ingestion-existing-project.workflow.yaml`
- Create: `seed/workflows/prompts/design-ingestion/delta-analysis.md`

**Acceptance Criteria:**
- Trigger: manual (with inputs: `files`, `urls`, `projectId`)
- Jobs:
  1. `provision_worktree` — Create worktree from existing project
  2. `place_inputs` — Copy new files into worktree
  3. `load_existing_artifacts` — Read existing PRD/SDD
  4. `delta_analysis` — Compare new vs existing
  5. `verify_analysis_commits` — Git verifier checks/commits
  6. `update_prd` — Update PRD with deltas
  7. `update_sdd` — Update SDD with deltas
  8. `validate_artifacts` — Cross-reference updated docs
  9. `merge_worktree` — Merge to main
  10. `create_work_items` — Only for net-new requirements
- Loads existing project context before analysis
- Creates changelog entry for updates
- Only creates work items for new requirements

**Definition of Done:**
- [ ] Workflow YAML valid and parseable
- [ ] Workflow seeds successfully
- [ ] Can be triggered manually via API
- [ ] Delta analysis works in test

---

### Task 3: Create `artifact-review-gate` Workflow

**Scope:** Optional human approval workflow for generated artifacts.

**Files:**
- Create: `seed/workflows/artifact-review-gate.workflow.yaml`

**Acceptance Criteria:**
- Trigger: manual (with inputs: `workItemId`, `artifacts`)
- Jobs:
  1. `present_artifacts` — Agent summarizes artifacts for review
  2. `await_approval` — Pause for human input
  3. `on_approved` — Transition work items to todo
  4. `on_rejected` — Agent addresses feedback and re-submits
- Supports approval/rejection with feedback
- Configurable timeout (default 48h)
- Can loop back to revision if rejected

**Definition of Done:**
- [ ] Workflow YAML valid
- [ ] Pause/resume mechanism works
- [ ] Human input captured correctly
- [ ] Tested with approval and rejection paths

---

### Task 4: Implement Commit Verification Step Handler

**Scope:** Special step type or execution job that verifies all files are committed.

**Files:**
- Modify: `apps/api/src/workflow/step-special-step-executor.service.ts`
- Create: `apps/api/src/workflow/commit-verification.handler.ts`
- Create: `apps/api/src/workflow/commit-verification.handler.spec.ts`

**Acceptance Criteria:**
- Runs `git status --short` in worktree
- If uncommitted files exist:
  - Returns status: `needs_commit`
  - Lists uncommitted files
  - Triggers retry loop (max 3)
- If all committed:
  - Returns status: `verified`
- Can be used as a workflow step or execution job

**Definition of Done:**
- [ ] Handler implemented
- [ ] Unit tests pass (>80% coverage)
- [ ] Integration with workflow engine tested
- [ ] Lint passes

---

### Task 5: Add Ingestion Trigger to Project Creation

**Scope:** Allow design ingestion as part of new project creation.

**Files:**
- Modify: `apps/api/src/project/project.service.ts`
- Modify: `apps/api/src/project/dto/create-project.dto.ts`
- Modify: `apps/web/src/pages/projects/create-project.tsx`

**Acceptance Criteria:**
- Project creation API accepts optional `ingestionInputs` (files, URLs)
- If provided, creates project then triggers `design-ingestion-new-project` workflow
- Project initialized with git repo before workflow runs
- Returns workflow run ID in response

**Definition of Done:**
- [ ] API accepts ingestion inputs
- [ ] Workflow triggered automatically
- [ ] Frontend supports file/URL upload during project creation
- [ ] Unit tests pass

---

### Task 6: Add Ingestion Work Item Type

**Scope:** Distinct work item type for ingestion tasks.

**Files:**
- Modify: `apps/api/src/project/work-item.constants.ts`
- Modify: `apps/api/src/database/entities/work-item.entity.ts`
- Modify: `apps/web/src/lib/api/types.ts`

**Acceptance Criteria:**
- New type: `ingestion` (alongside `epic`, `task`, `bug`)
- Ingestion work items have special rendering in UI
- Can be filtered separately on board
- Metadata includes `source_inputs` (files/URLs analyzed)

**Definition of Done:**
- [ ] New type added to enums
- [ ] Frontend handles ingestion type
- [ ] Board filtering works
- [ ] Unit tests pass

---

### Task 7: Write Workflow Documentation

**Scope:** Document the ingestion workflows.

**Files:**
- Create: `docs/architecture/design-ingestion-workflows.md`
- Modify: `docs/architecture/workflow-engine.md`

**Acceptance Criteria:**
- Document covers:
  - Each workflow's purpose and trigger
  - Job breakdown with agent profiles
  - Commit verification mechanism
  - Error handling and recovery
  - How to customize workflows
- Workflow engine README updated with ingestion examples
- Sequence diagram showing full pipeline

**Definition of Done:**
- [ ] Documentation complete
- [ ] Diagrams included
- [ ] Peer reviewed

---

## 4. Definition of Done (Epic Level)

- [ ] 3 workflow YAMLs created and seeded
- [ ] Workflows can be triggered manually via API
- [ ] Commit verification handler implemented with tests
- [ ] Project creation supports ingestion inputs
- [ ] Ingestion work item type exists
- [ ] Workflows tested with real inputs
- [ ] All tests pass (`npm run test`)
- [ ] Lint passes (`npm run lint`)
- [ ] Documentation updated
- [ ] Feature flag: `design_ingestion_workflows_enabled` (default: false)
- [ ] No E2E tests required (deferred to future epic)

---

## 5. Dependencies

- **EPIC-128 (Steering Foundation):** CEO invokes these workflows dynamically
- **EPIC-129 (Ingestion Tools):** Workflows need tools to invoke
- **EPIC-130 (Profiles):** Workflows need profiles for agents
- **EPIC-131 depends on:** EPIC-128, EPIC-129, EPIC-130
- **Blocks:** EPIC-132, EPIC-133

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| Workflow YAML errors | Validate on seed; test in dev |
| Long-running workflows | Add timeout guards; support resume |
| Commit verification loops | Max 3 retries; then fail |
| Merge conflicts | Worktree isolation prevents most; handle edge cases |
