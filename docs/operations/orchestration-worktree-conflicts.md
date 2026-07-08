# Orchestration Worktree Branch Conflict Runbook

## Symptoms

- Workflow child step fails during `provision_worktree` with a Git worktree conflict error.
- The event ledger contains a message similar to:

  ```
  fatal: '<branch>' is already used by worktree at '<path>'
  ```

- A kanban work item is reset to `todo` by linked-run reconciliation after the failure.
- The same work item fails again on the next dispatch cycle for the same branch.

## Diagnosis

### 1. Identify existing worktrees for the cloned project

```powershell
docker exec nexus-api git -C '/data/nexus-workspaces/clones/<project-id>' worktree list --porcelain
```

Replace `<project-id>` with the scope_id of the affected project. The output lists each worktree with its branch, path, and status.

### 2. Check the kanban work item state

```powershell
docker exec nexus-postgres psql -U nexus nexus_orchestrator -c "SELECT id,title,status,linked_run_id,current_execution_id,execution_config->>'targetBranch' AS target_branch FROM kanban_work_items WHERE scope_id = '<project-id>' ORDER BY updated_at DESC;"
```

Correlate the `target_branch` values with the worktree list output to determine which work item owns each worktree.

### 3. Identify the branch owner

Match the conflicting branch to the work item with the most recent `execution_config.targetBranch` for that branch. Check the work item status:

- **`in-progress`** — the branch is actively being worked on.
- **`in-review`** — the branch is under review / PR open.
- **`ready-to-merge`** — the branch is approved and awaiting merge.
- **`todo`** — the work item is queued but has no active execution.
- **`blocked`** — the work item is intentionally paused.

## Safe Recovery

### Step 1 — Identify which worktree is safe to remove

- If the owning work item status is `in-progress`, `in-review`, or `ready-to-merge`, the branch is actively in use. **Do not remove the worktree** unless the work item is explicitly abandoned.
- If the owning work item status is `todo` or `blocked`, the branch is not actively in use and the worktree can be removed.

### Step 2 — Verify the worktree has no uncommitted or unpushed work

Before removing any worktree, verify it is safe to do so:

1. Check for uncommitted changes:

   ```powershell
   git -C '<worktree-path>' status --porcelain
   ```

   If this produces any output, the worktree has local modifications. **Preserve the worktree and escalate** — do not remove it.

2. Check for unpushed commits on the worktree's branch:

   ```powershell
   git -C '<worktree-path>' log @{u}..HEAD --oneline
   ```

   This compares against the branch's upstream tracking ref. If the branch has no upstream configured (`git branch -vv` shows no `[origin/xxx]`), **preserve the worktree and escalate** — the upstream may have been deleted or the branch may be tracking a different remote. If the command produces any output, the branch has commits not yet pushed. **Preserve the worktree and escalate** — the developer may still need these commits.

3. Only if both checks produce no output is the worktree safe to remove.

### Step 3 — Resolve the conflicting work item

After removing the abandoned worktree:

1. Update the blocked `todo` work item's `executionConfig.targetBranch` to a unique branch name that does not conflict with any existing worktree.
2. Alternatively, regenerate the spec with a unique `target_branch` value.

### Step 4 — Clear orchestration cycle decision

1. Clear the orchestration cycle decision to prevent the same conflict from being re-triggered immediately.
2. Request a manual wakeup to resume the dispatch cycle with the corrected branch configuration.

### Observed Branch Conflict Example

The following is a real conflict message observed in the event ledger (identifiers redacted):

```
fatal: 'feature/repair-branch' is already used by worktree at '/data/nexus-workspaces/clones/proj-abc/worktrees/feature/repair-branch'
```

No secrets or sensitive values are included in this runbook.
