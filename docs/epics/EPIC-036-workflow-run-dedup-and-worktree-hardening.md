# EPIC-036: Workflow Run Deduplication and Worktree Hardening

## Summary

Eliminate duplicate in-review workflow runs and stale worktree mounts that cause false "empty workspace" QA failures.

This epic hardens workflow start idempotency, fixes restart target selection in reject flows, validates worktree paths against git registry before mount, and cleans orphan worktree directories even when they are no longer registered by git.

## Motivation

### Current Pain Points

1. A single work item can accumulate overlapping in-review runs.
2. Review agents can mount stale non-git directories as workspace.
3. Cleanup reports success while orphan worktree folders remain on disk.
4. Orphan folders can be remounted and interpreted as empty repos.
5. QA loops re-trigger review without returning to implementation.

### Why Now

1. This issue causes false rejection loops and blocks lifecycle completion.
2. It affects core ticket automation and merge confidence.
3. The failure mode is intermittent and expensive to triage without hard guards.

## Goals

1. Ensure only one active run exists per workflow/work-item/status-trigger combination.
2. Ensure worktree path resolution only returns valid registered git worktrees.
3. Ensure worktree cleanup removes orphan directories even when unregistered.
4. Ensure reject restart path targets the current work item status workflow.
5. Ensure reconciler can clean both registered and filesystem-only orphan worktrees.
6. Add focused tests for dedupe, validation, and cleanup behavior.

## Non-Goals

1. Replacing workflow orchestration architecture.
2. Introducing per-run unique worktree IDs by default.
3. Full E2E test suite redesign in this epic.

## Scope

### In Scope

1. Workflow run dedupe at start time.
2. Restart target selection fix in `manage_execution` special step.
3. Git worktree existence validation against `git worktree list`.
4. Orphan directory cleanup in `removeWorktree`.
5. Reconciler updates to clean filesystem-only orphan directories.
6. Unit tests for the above.

### Out of Scope

1. UI-only mitigation.
2. New workflow schema fields.
3. Cross-service distributed locking.

## Technical Plan

### Phase 1: Run Deduplication at Start

1. Add trigger-context-based active-run lookup in workflow run repository.
2. Add start-time dedupe gate in workflow engine for work-item status-triggered workflows.
3. Add a lightweight in-process per-key start lock to prevent local race duplicates.

### Phase 2: Restart Target Correction

1. Update `manage_execution` restart path to trigger automation for the current work item status, not stale trigger transition status.
2. Keep resume behavior unchanged when an execution can be resumed.

### Phase 3: Worktree Validation and Cleanup Hardening

1. Update `getExistingWorktreePath` to require:
   - directory exists
   - path is registered in `git worktree list`
   - `.git` marker exists in the worktree path
2. Update `removeWorktree` to remove orphan directory path if it still exists after registered removal.

### Phase 4: Reconciler Orphan Sweep Expansion

1. Add listing of managed worktree directories from filesystem.
2. Reconcile both registered and filesystem-only paths against active work items.
3. Remove orphan directories via `removeWorktree` even without branch info.

## Acceptance Criteria

1. Triggering the same in-review workflow repeatedly while one is active reuses the active run ID.
2. Reject flow restart no longer launches in-review directly from stale transition context.
3. Stale unregistered worktree directory is not returned as valid mount path.
4. `removeWorktree` deletes orphan directory when path exists but is not registered.
5. Reconciler removes filesystem-only orphan worktree directories.
6. New/updated unit tests pass for repository, workflow engine, manage execution, git worktree, and reconciler changes.

## Affected Files (Expected)

1. `apps/api/src/database/repositories/workflow-run.repository.ts`
2. `apps/api/src/workflow/workflow-engine.service.ts`
3. `apps/api/src/workflow/workflow-engine.service.spec.ts`
4. `apps/api/src/workflow/step-manage-execution-special-step.handler.ts`
5. `apps/api/src/workflow/step-manage-execution-special-step.handler.spec.ts`
6. `apps/api/src/common/git/git-worktree.service.ts`
7. `apps/api/src/common/git/git-worktree.service.spec.ts` (new)
8. `apps/api/src/project/worktree-reconciler.service.ts`
9. `apps/api/src/project/worktree-reconciler.service.spec.ts`

## Validation Commands

1. `npm exec --workspace=apps/api -- vitest run src/workflow/workflow-engine.service.spec.ts`
2. `npm exec --workspace=apps/api -- vitest run src/workflow/step-manage-execution-special-step.handler.spec.ts`
3. `npm exec --workspace=apps/api -- vitest run src/common/git/git-worktree.service.spec.ts`
4. `npm exec --workspace=apps/api -- vitest run src/project/worktree-reconciler.service.spec.ts`
5. `npm exec --workspace=apps/api -- eslint src/workflow/workflow-engine.service.ts src/workflow/step-manage-execution-special-step.handler.ts src/common/git/git-worktree.service.ts src/project/worktree-reconciler.service.ts`

## Tracking

- [ ] Phase 1 implemented and tested
- [ ] Phase 2 implemented and tested
- [ ] Phase 3 implemented and tested
- [ ] Phase 4 implemented and tested
- [ ] Validation commands green
