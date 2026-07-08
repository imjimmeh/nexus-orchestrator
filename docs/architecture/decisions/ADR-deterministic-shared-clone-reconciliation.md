# ADR: Deterministic Reconciliation of Shared Git Clone Dirt Before LLM Fallback

**Status:** Accepted
**Date:** 2026-07-02
**Work item:** f2f5adb7-72ae-489e-a14b-e7bd52e9e404 (ready-to-merge merge failure)
**Module:** `apps/api/src/common/git/`, `apps/api/src/workflow/workflow-special-steps/`
**Related docs:** `docs/guide/README.md` (ready-to-merge flow), `docs/superpowers/plans/2026-07-02-merge-shared-clone-deterministic-reconcile.md` (execution plan for this change), `docs/plans/2026-07-01-merge-shared-clone-hygiene.md` (prior art: the original preflight-and-agent-remediation design this change extends)

> Status line (literal): `Status: Accepted`

## Context

The shared git clone (at `clones/<scopeId>` on the Docker host) accumulates "dirt" — unintended file-system state changes — as workflow agents commit work, failed commits roll back partially, and external forces (e.g. spec-writer workflows, skill deletions) mutate the source branches the clone tracks. Before a ready-to-merge workflow merges its changes, the `merge_integrate` special step attempts to reconcile this dirt so the final push succeeds.

Historically, the entire reconciliation was delegated to the `reconcile_shared_clone_hygiene` LLM agent (MiniMax-M3), which attempted to diagnose and resolve the dirt by reasoning about the clone's current state. This agent-only approach failed operationally in run `f2f5adb7-72ae-489e-a14b-e7bd52e9e404`:

**Incident summary:**

- The shared clone contained two categories of dirt:
  1. **Deleted tracked files:** two `SKILL.md` files tracked by the source branch but missing from the working tree.
  2. **Untracked but source-tracked files:** five `docs/work-items/*.md` files present on disk but absent from the clone's HEAD — the source branch already tracks these files, but they arrived untracked into the clone (likely from a failed push or roll-back).
- Both categories are **mechanically reconcilable without judgment**: restore the tracked deletions via `git checkout HEAD -- <file>` (restores deleted tracked files) and quarantine the untracked-but-source-tracked files to a side directory (prevents them from blocking the merge without destroying them).
- The MiniMax-M3 agent was tasked with fixing this dirt, but while reasoning about the absolute clone path (required for git operations in the container), the agent corrupted a single hex character of the scope UUID (`...8883e0efa9ad` → `...8883e0ffa9ad`). The agent then spent ~30 minutes operating against the non-existent path, misdiagnosed the failure as a "sandbox restriction," returned `ok:false`, and failed the merge.

**Root cause:** The LLM agent was transcribing the scope UUID from the clone path `clones/<scopeId>` without external anchor points. Mechanical tasks (git surgery, file moves) should not depend on LLM string transcription; when they do, the failure class includes "LLM transcription error on a mechanical task," which is avoidable via deterministic reconciliation.

## Decision

Implement deterministic-first reconciliation: a new `merge_integrate_reconcile` git action that classifies shared-clone blockers into three categories and handles the first two deterministically without invoking the LLM:

1. **Restorable:** Tracked files deleted from the working tree (detected via `git status` porcelain, status prefix `D`). Restored via `git checkout HEAD -- <file>`. No judgment required; the contract is "restore what the source branch provides."

2. **Quarantinable:** Untracked files that the source branch already tracks (detected by cross-checking porcelain against `git ls-tree` on the source branch ref, not HEAD — in the shared clone, HEAD is the base branch). Moved — never deleted — into a `reconcile-quarantine/<scopeId>/<timestamp>/` directory adjacent to the clone. The timestamp ensures each reconciliation run has a distinct quarantine subdir; the files survive on disk for inspection or recovery, but they do not block the merge. No judgment required; the contract is "preserve authored content, do not destroy."

3. **Ambiguous:** All remaining dirt (e.g. modified tracked files, untracked files the source branch does not track). Passed through to the LLM agent fallback for judgment-based reconciliation.

The workflow YAML is rewired to call `merge_integrate_reconcile` before the LLM fallback agent. The fallback agent's prompt now receives the exact absolute clone path as a template value injected by the deterministic job's output (`{{jobs.reconcile_shared_clone_deterministic.output.shared_clone_path}}` on the primary path, `{{jobs.reconcile_shared_clone_deterministic_after_remediation.output.shared_clone_path}}` on the after-remediation path); the agent copies the path verbatim rather than reconstructing it from the scope UUID, eliminating the transcription-error failure class from the fallback path.

### Implementation details

**New git action:** `merge_integrate_reconcile`, dispatched by `step-git-operation-special-step.handler.ts` to `MergeIntegrateGitActionStrategy` (`git-actions/merge-integrate-git-action.strategy.ts`), which delegates the deterministic work to `GitMergeService.reconcileSharedCloneIntegration`. Classification logic:

- Parse `git status --porcelain=v1` to extract file paths and status prefixes.
- Identify deleted tracked files (`D` prefix) and restore them via `git checkout HEAD -- <paths>`.
- For remaining untracked files (`??` prefix), check if `git ls-tree -r <sourceBranch> <file>` returns a match (the source branch ref, not HEAD — HEAD in the shared clone is the base branch). If yes, the file is source-tracked and quarantinable. Move to `reconcile-quarantine/<scopeId>/<timestamp>/<file>`.
- All other files (modified tracked, untracked but not source-tracked) are classified as ambiguous.
- Return the classification result (restorable count, quarantinable count, ambiguous file list). If nothing ambiguous remains after restoring and quarantining, integration proceeds directly to `merge_integrate` with no agent involved; the LLM fallback (`reconcile_shared_clone_hygiene`) is only invoked when ambiguous paths remain after the deterministic pass.

**Workflow rewire:** In `seed/workflows/work-item-ready-to-merge-default.workflow.yaml`, insert a `reconcile_shared_clone_deterministic` job before the existing `reconcile_shared_clone_hygiene` (fallback agent) job on both the primary merge path and the after-quality-remediation path (mirrored as `reconcile_shared_clone_deterministic_after_remediation` / `reconcile_shared_clone_hygiene_after_remediation`). The deterministic job runs the git action and reports its classification; if ambiguous files remain, the fallback agent is invoked with the ambiguous file list injected into its prompt.

**Prompt hardening on the fallback:** The fallback agent's prompt now receives `{{jobs.reconcile_shared_clone_deterministic.output.shared_clone_path}}` (primary merge path) and `{{jobs.reconcile_shared_clone_deterministic_after_remediation.output.shared_clone_path}}` (after-quality-remediation path) — the absolute host path to the shared clone, produced as output of the immediately-preceding deterministic job. The prompt instructs the agent to use this path verbatim in all git operations, eliminating the transcription of the scope UUID.

## Alternatives

### Option 1 — Agent-only with prompt hardening

Harden the LLM fallback agent's prompt to receive the exact absolute clone path as a template value, but leave all dirt reconciliation (including restorable deletions and quarantinable untracked files) to the LLM agent.

**Rejected because:**

1. **Trusts LLM transcription for mechanical tasks.** Even with a hardened prompt, the agent still makes transcription decisions when constructing file paths from the scope context (e.g. "if the scope UUID is X, then the quarantine directory is at Y"). The failure class "LLM transcription error on mechanical string manipulation" is reduced but not eliminated.
2. **Does not address the root cause.** Run `f2f5adb7` failed because the LLM agent corrupted a hex character while reasoning about the clone path. Prompt hardening makes a repeat failure less likely, but the underlying vulnerability (LLM reasoning on mechanical file-system operations) remains.
3. **Wastes LLM reasoning capacity.** The restorable deleted files (`git checkout HEAD -- <file>`) and quarantinable untracked-but-source-tracked files (move to a directory) are deterministic operations. Using LLM token budget and inference time to decide "restore deleted tracked file X" is inefficient when a `git status` parser can make that decision in microseconds.

### Option 2 — Forced cleanup: `git clean -fdx` / `git checkout -f`

Automate the cleanup by running `git clean -fdx` (remove all untracked files) and `git checkout -f` (reset all tracked files to HEAD, discarding modifications) before the merge push, bypassing both the deterministic reconciliation and the LLM fallback.

**Rejected because:**

1. **Destroys the sole copy of authored content.** If a `.md` file is untracked and not in the source HEAD (e.g. a spec or skill file that was authored locally but never committed to the source branch), `git clean -fdx` destroys it. The "never destroy file content" constraint is violated.
2. **No recovery mechanism.** Unlike the quarantine approach (files survive on disk for inspection), a forced cleanup is destructive. An operator cannot recover a deleted skill file from `reconcile-quarantine/`.
3. **Hides failures, does not resolve them.** If a modified tracked file contains substantive changes from the agent's work, `git checkout -f` discards those changes silently. The merge may succeed, but the agent's work is lost. The deterministic classification surfaces these ambiguous cases explicitly so they can be judged by the LLM or human.

## Consequences

### Workflow changes

- **New job:** `reconcile_shared_clone_deterministic` inserted before the existing `reconcile_shared_clone_hygiene` fallback job on both the primary merge path and the after-quality-remediation path (job wiring in `seed/workflows/work-item-ready-to-merge-default.workflow.yaml`; action classification in `apps/api/src/common/git/git-shared-clone-reconcile.helpers.ts`; executor in `apps/api/src/common/git/git-merge.service.ts`).
- **Fallback agent prompt:** `reconcile_shared_clone_hygiene` now receives the absolute clone path as a template value from the preceding deterministic job's output (`{{jobs.reconcile_shared_clone_deterministic.output.shared_clone_path}}` / `{{jobs.reconcile_shared_clone_deterministic_after_remediation.output.shared_clone_path}}`). The prompt instructs the agent to use this path verbatim and never reconstruct the scope UUID.
- **Ambiguous file list:** The deterministic job reports the count of restorable and quarantinable files, plus the list of ambiguous files (if any). The fallback agent's prompt includes the ambiguous list so it can focus on judgment-required cases.

### Deterministic reconciliation scope

- **Restorable deleted tracked files are automatically restored.** No LLM invocation, no transcription risk.
- **Untracked but source-tracked files are automatically quarantined.** The `reconcile-quarantine/<scopeId>/<timestamp>/` directory preserves these files for inspection or recovery.
- **Ambiguous remaining dirt still requires the LLM fallback or human judgment.** Modified tracked files, untracked files the source branch does not track, and other edge cases are classified as ambiguous and passed to the fallback agent. The LLM is only invoked for cases that require reasoning.

### File preservation and recovery

- The `reconcile-quarantine/` directory accumulates quarantined files over time. Each reconciliation run creates a new timestamp-suffixed subdir, so reconciliation runs do not collide. **Consequence:** the quarantine directory will grow without bound unless a retention/GC policy is introduced (see Follow-up section).
- Quarantined files are accessible on the host at `<workspaces-root>/reconcile-quarantine/<scopeId>/<timestamp>/<relativePath>` — a directory **sibling to** `clones/` (not nested inside the clone; `resolveQuarantineRoot()` resolves two levels above the clone root) — for inspection or recovery by operators or subsequent workflows.

### Risk reduction

- The failure class "LLM transcription error on a mechanical git-surgery task" is eliminated from the merge path. Run `f2f5adb7` cannot repeat; identical conditions now resolve deterministically.
- The LLM fallback is now scoped to true judgment-requiring cases (ambiguous dirt). If the fallback still fails, the error is more likely to be a knowledge gap (e.g. "how should I handle a modified `.env.local` file?") rather than a transcription error.

### Observability

- The `merge_integrate_reconcile` git action's output (restorable count, quarantinable count, ambiguous file list) is logged and available in the workflow run's event log. Operators can verify that deterministic reconciliation happened and inspect what was quarantined.
- If the fallback agent later fails on an ambiguous file, the event log shows exactly which files were classified as ambiguous and thus expected to be handled by the agent.

## Follow-up

Two categories of work are **deliberately out of scope** for this change and remain as follow-ups:

### Quarantine garbage collection

The `reconcile-quarantine/` directory will accumulate timestamp-suffixed subdirs over the lifetime of the shared clone. A retention/GC policy is required to prevent unbounded growth. Options:

1. **Periodic cleanup:** Fold quarantine-dir GC into the existing `ContainerCleanupService` cron or a new cron job. Retain quarantined files for N days (e.g. 7) and delete older subdirs.
2. **Clone-retirement cleanup:** When a shared clone reaches its retirement age (e.g. 30 days, a separate EPIC), delete the entire `clones/<scopeId>` directory including any quarantine subdirs.
3. **Operator-driven cleanup:** Provide a manual tool to inspect and prune the quarantine directory by age or scope.

The choice depends on operational requirements (how often do operators need to recover quarantined files?) and is tracked as a follow-up EPIC.

### Root producers of clone dirt

This change reduces the number of times the merge fallback is invoked, but it does not eliminate the root causes of dirt. Two known producers are out of scope:

1. **Spec-writer workflows:** Workflows that write spec `.md` files and commit them may leave untracked files if the commit fails or rolls back partially. Fixing spec-writer workflows to guarantee atomic commit-or-rollback is a separate, not-yet-planned follow-up.
2. **Skill file deletions:** If a skill is deleted from the source branch after a clone is created, the clone's HEAD no longer includes the skill file, but the working tree may contain stale copies. Syncing skill deletions across all active clones is tracked separately (related to skill lifecycle and cache invalidation).

These root producers are orthogonal to the deterministic reconciliation logic and are tracked in their own EPICs.

### Model selection on the fallback

If the fallback agent continues to struggle with ambiguous dirt, upgrading to a stronger model (e.g. Opus instead of MiniMax-M3) is a future option. This change does not depend on model selection; it is deferred to a separate configuration EPIC.

## Status

Status: Accepted.

The classification helpers (`parsePorcelainEntries`, `classifySharedCloneBlockers`, `resolveQuarantineRoot`) are in place in `apps/api/src/common/git/git-shared-clone-reconcile.helpers.ts` (Task 1). The deterministic reconciliation executor (`GitMergeService.reconcileSharedCloneIntegration`, backing the `merge_integrate_reconcile` git action) is implemented in `apps/api/src/common/git/git-merge.service.ts` (Task 2). The new action is wired into the special-step handler via `apps/api/src/workflow/workflow-special-steps/git-actions/merge-integrate-git-action.strategy.ts` and `apps/api/src/workflow/workflow-special-steps/step-git-operation-special-step.handler.ts` (Task 3). The workflow YAML rewire (insertion of `reconcile_shared_clone_deterministic` job before the fallback, hardened fallback prompt) is complete in `seed/workflows/work-item-ready-to-merge-default.workflow.yaml` (Task 4). All tasks are committed on this branch.

The decision recorded here is that shared-clone reconciliation is deterministic-first: restorable deletions and quarantinable untracked files are handled by deterministic git operations, and only ambiguous remaining dirt is escalated to the LLM fallback. The LLM fallback receives the absolute clone path as a template value to eliminate transcription-error risk. The quarantine directory preserves content without destroying files. The root producers of clone dirt (spec-writer atomicity, skill deletions) are tracked separately and are out of scope.

## References

- `apps/api/src/common/git/git-shared-clone-reconcile.helpers.ts` — pure classification helpers `parsePorcelainEntries`, `classifySharedCloneBlockers`, and `resolveQuarantineRoot` (Task 1).
- `apps/api/src/common/git/git-merge.service.ts` — `GitMergeService.reconcileSharedCloneIntegration`, the deterministic executor backing the `merge_integrate_reconcile` git action (Task 2).
- `apps/api/src/workflow/workflow-special-steps/git-actions/merge-integrate-git-action.strategy.ts` and `apps/api/src/workflow/workflow-special-steps/step-git-operation-special-step.handler.ts` — special-step action wiring (Task 3).
- `seed/workflows/work-item-ready-to-merge-default.workflow.yaml` — job insertion and fallback prompt hardening on both the primary merge path and the after-quality-remediation path (Task 4).
- `docs/superpowers/plans/2026-07-02-merge-shared-clone-deterministic-reconcile.md` — the execution plan for this change.
- `docs/plans/2026-07-01-merge-shared-clone-hygiene.md` — prior art: the original preflight-and-agent-remediation plan this change extends with a deterministic-first pass.
- Run `f2f5adb7-72ae-489e-a14b-e7bd52e9e404` event log (in Nexus orchestrator) — the incident that motivated this change.
- `docs/architecture/decisions/ADR-backend-instrumentation-helper-extraction.md` — comparable ADR structure (single helper, multiple call sites, drift inventory in Context).
