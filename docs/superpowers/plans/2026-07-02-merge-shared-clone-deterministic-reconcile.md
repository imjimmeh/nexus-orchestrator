# Deterministic Shared-Clone Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ready-to-merge shared-clone hygiene reconciliation deterministic for the two provably-safe dirt classes (tracked-file deletions, untracked files already tracked on the source branch) so the LLM agent is only a fallback for genuinely ambiguous state, and harden the fallback prompt so the agent never has to re-type the clone path.

**Architecture:** Add a `merge_integrate_reconcile` git action beside the existing `merge_integrate_preflight`. It classifies porcelain blockers with a pure helper, restores tracked deletions via `git checkout HEAD -- <paths>`, moves blocking untracked-but-source-tracked files into a quarantine directory (content is never destroyed), then re-runs the blocker scan and reports `succeeded` or `shared_clone_dirty` with the remaining paths. The workflow routes preflight-dirty to this deterministic job first; only leftover ambiguous paths reach the `reconcile_shared_clone_hygiene` agent, whose prompt now includes the exact absolute clone path from step output.

**Tech Stack:** TypeScript, NestJS, Vitest, workflow seed YAML, Git CLI helpers.

## Context: incident being fixed

Run `f2f5adb7-72ae-489e-a14b-e7bd52e9e404` (workflow "Work Item Ready to Merge Default") failed because:

1. `merge_integrate_preflight` correctly reported the shared clone dirty (2 deleted `SKILL.md` files + 5 untracked `docs/work-items/*.md` that the source branch tracks).
2. The `reconcile_shared_clone_hygiene` agent (MiniMax-M3) corrupted the scope UUID while reasoning (`...8883e0efa9ad` → `...8883e0ffa9ad`), spent ~30 minutes on the nonexistent path, misdiagnosed a "sandbox restriction", and returned `ok:false` → merge failed.
3. Both dirt classes in this incident were mechanically reconcilable without any judgment; an agent should never have been needed.

## Global Constraints

- Never suppress linting (`eslint-disable`, `@ts-ignore`); fix findings in code.
- API/core stays Kanban-neutral — everything here is `apps/api/src/common/git` + `apps/api/src/workflow/workflow-special-steps` + `seed/workflows`, no Kanban identifiers.
- NestJS build via `nest build` (`npm run build:api`), not `tsc`.
- TDD Red-Green-Refactor per task; run only the targeted spec files while iterating.
- `git-merge.service.ts` is already 545 lines — new logic goes in a new helpers file, the service gets only a thin delegating method.
- Never destroy file content: no `git clean`, no `git reset --hard`, no plain deletes. Quarantine moves only.

---

### Task 1: Porcelain classification helpers (pure functions)

**Files:**

- Create: `apps/api/src/common/git/git-shared-clone-reconcile.helpers.ts`
- Create: `apps/api/src/common/git/git-shared-clone-reconcile.helpers.spec.ts`
- Modify: `apps/api/src/common/git/git-merge.service.ts:430-462` (reuse the new parser, delete the private duplicates)

**Interfaces:**

- Produces:
  - `interface PorcelainEntry { status: string; path: string }`
  - `parsePorcelainEntries(stdout: string): PorcelainEntry[]` — parses `git status --porcelain=v1 -z` output (NUL-separated records, rename `a -> b` resolved to `b`).
  - `interface SharedCloneBlockerClassification { restorable: string[]; quarantinable: string[]; ambiguous: string[] }`
  - `classifySharedCloneBlockers(entries: PorcelainEntry[], sourceTrackedPaths: Set<string>): SharedCloneBlockerClassification`

Classification rules (must produce the exact same _blocker set_ as the current `listSharedCloneIntegrationBlockers`, i.e. every non-`??` entry plus `??` entries tracked on the source branch — this task only partitions that set):

- `restorable`: status is exactly `' D'` or `'D '` (worktree- or index-deleted tracked file, no other change). Content is fully recoverable from `HEAD`.
- `quarantinable`: status `'??'` **and** `sourceTrackedPaths.has(path)`. The merge itself will materialise the tracked version; the stray copy is preserved by moving, not deleting.
- `ambiguous`: every other blocker (`' M'`, `'MM'`, `'AD'`, `'UU'`, …). Left for the agent/human.
- `??` entries NOT tracked on the source branch are not blockers at all and appear in no bucket (same as today).

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/api/src/common/git/git-shared-clone-reconcile.helpers.spec.ts
import { describe, expect, it } from "vitest";
import {
  classifySharedCloneBlockers,
  parsePorcelainEntries,
} from "./git-shared-clone-reconcile.helpers";

describe("parsePorcelainEntries", () => {
  it("parses NUL-separated porcelain v1 records including spaces and renames", () => {
    const stdout =
      "?? docs/work-items/child 1.md\0 D .agents/skills/debugging/SKILL.md\0R  old.md -> new name.md\0";
    expect(parsePorcelainEntries(stdout)).toEqual([
      { status: "??", path: "docs/work-items/child 1.md" },
      { status: " D", path: ".agents/skills/debugging/SKILL.md" },
      { status: "R ", path: "new name.md" },
    ]);
  });

  it("returns an empty list for empty output", () => {
    expect(parsePorcelainEntries("")).toEqual([]);
  });
});

describe("classifySharedCloneBlockers", () => {
  const sourceTracked = new Set([
    "docs/work-items/child-1.md",
    ".agents/skills/debugging/SKILL.md",
    "src/feature.ts",
  ]);

  it("classifies tracked deletions as restorable", () => {
    const result = classifySharedCloneBlockers(
      [
        { status: " D", path: ".agents/skills/debugging/SKILL.md" },
        { status: "D ", path: "src/feature.ts" },
      ],
      sourceTracked,
    );
    expect(result).toEqual({
      restorable: [".agents/skills/debugging/SKILL.md", "src/feature.ts"],
      quarantinable: [],
      ambiguous: [],
    });
  });

  it("classifies untracked source-tracked files as quarantinable and other untracked as non-blocking", () => {
    const result = classifySharedCloneBlockers(
      [
        { status: "??", path: "docs/work-items/child-1.md" },
        { status: "??", path: "scratch/notes.md" },
      ],
      sourceTracked,
    );
    expect(result).toEqual({
      restorable: [],
      quarantinable: ["docs/work-items/child-1.md"],
      ambiguous: [],
    });
  });

  it("classifies modified tracked files as ambiguous", () => {
    const result = classifySharedCloneBlockers(
      [
        { status: " M", path: "src/feature.ts" },
        { status: "MM", path: "docs/work-items/child-1.md" },
      ],
      sourceTracked,
    );
    expect(result).toEqual({
      restorable: [],
      quarantinable: [],
      ambiguous: ["src/feature.ts", "docs/work-items/child-1.md"],
    });
  });
});
```

- [ ] **Step 2: Run tests to verify red**

Run: `npm run test --workspace=apps/api -- apps/api/src/common/git/git-shared-clone-reconcile.helpers.spec.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the helpers**

```typescript
// apps/api/src/common/git/git-shared-clone-reconcile.helpers.ts
export interface PorcelainEntry {
  status: string;
  path: string;
}

export interface SharedCloneBlockerClassification {
  restorable: string[];
  quarantinable: string[];
  ambiguous: string[];
}

const RESTORABLE_STATUSES = new Set([" D", "D "]);
const UNTRACKED_STATUS = "??";

/** Parse `git status --porcelain=v1 -z` output into status/path entries. */
export function parsePorcelainEntries(stdout: string): PorcelainEntry[] {
  return stdout
    .split("\0")
    .filter((record) => record.length >= 4)
    .flatMap((record) => {
      const status = record.slice(0, 2);
      const rawPath = record.slice(3).trim();
      const path = rawPath.includes(" -> ")
        ? rawPath.split(" -> ").at(-1)?.trim()
        : rawPath;
      return path ? [{ status, path }] : [];
    });
}

/**
 * Partition integration blockers into deterministically-safe actions.
 * The union of the three buckets equals the preflight blocker set:
 * every non-untracked entry plus untracked entries tracked on the source branch.
 */
export function classifySharedCloneBlockers(
  entries: PorcelainEntry[],
  sourceTrackedPaths: Set<string>,
): SharedCloneBlockerClassification {
  const classification: SharedCloneBlockerClassification = {
    restorable: [],
    quarantinable: [],
    ambiguous: [],
  };
  for (const { status, path } of entries) {
    if (status === UNTRACKED_STATUS) {
      if (sourceTrackedPaths.has(path)) {
        classification.quarantinable.push(path);
      }
      continue;
    }
    if (RESTORABLE_STATUSES.has(status)) {
      classification.restorable.push(path);
      continue;
    }
    classification.ambiguous.push(path);
  }
  return classification;
}
```

- [ ] **Step 4: Run tests to verify green**

Run: `npm run test --workspace=apps/api -- apps/api/src/common/git/git-shared-clone-reconcile.helpers.spec.ts`
Expected: PASS.

- [ ] **Step 5: Refactor the service to reuse the parser (delete duplication)**

In `git-merge.service.ts`, replace the body of `listSharedCloneIntegrationBlockers` and delete the private `parsePorcelainPath`:

```typescript
import { parsePorcelainEntries } from './git-shared-clone-reconcile.helpers';

private async listSharedCloneIntegrationBlockers(
  repoPath: string,
  sourceTrackedPaths: Set<string>,
  authEnv: GitAuthEnv,
): Promise<string[]> {
  const { stdout } = await this.runGitCapture(
    repoPath,
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
    authEnv,
  );
  const blockers = parsePorcelainEntries(stdout)
    .filter(
      ({ status, path }) => status !== '??' || sourceTrackedPaths.has(path),
    )
    .map(({ path }) => path);
  return [...new Set(blockers)];
}
```

Run: `npm run test --workspace=apps/api -- apps/api/src/common/git/git-merge.service.spec.ts apps/api/src/common/git/git-shared-clone-reconcile.helpers.spec.ts`
Expected: PASS (existing preflight specs unchanged).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/common/git/git-shared-clone-reconcile.helpers.ts apps/api/src/common/git/git-shared-clone-reconcile.helpers.spec.ts apps/api/src/common/git/git-merge.service.ts
git commit -m "feat(git): classify shared-clone integration blockers into safe/ambiguous buckets"
```

---

### Task 2: Deterministic reconcile service method + shared clone path in results

**Files:**

- Modify: `apps/api/src/common/git/git-merge.service.types.ts`
- Modify: `apps/api/src/common/git/git-shared-clone-reconcile.helpers.ts` (add the reconcile executor)
- Modify: `apps/api/src/common/git/git-merge.service.ts` (thin `reconcileSharedCloneIntegration` method; set `sharedClonePath` in `preflightSharedCloneIntegration` results)
- Test: `apps/api/src/common/git/git-merge.service.spec.ts`

**Interfaces:**

- Consumes: `classifySharedCloneBlockers`, `parsePorcelainEntries` from Task 1.
- Produces:
  - `MergeResult` gains `sharedClonePath?: string`, `restoredPaths?: string[]`, `quarantinedPaths?: string[]`.
  - `GitMergeService.reconcileSharedCloneIntegration(scopeId: string, sourceBranch: string, destinationBranch: string): Promise<MergeResult>` — outcome `'succeeded'` when no blockers remain, `'shared_clone_dirty'` with `dirtyPaths` = remaining ambiguous paths, `'failed'` on errors.
  - Quarantine location: `<workspaces-root>/reconcile-quarantine/<scopeId>/<ISO-stamp>/<relative-path>` (sibling of `clones/`, same bind mount, so `fs.rename` works).

- [ ] **Step 1: Write the failing tests**

Add to the `describe('integrateAndPush (stage 2 only)')` block (or a new sibling block) in `git-merge.service.spec.ts`, following the existing `stubCapture`/`vi.spyOn(service, 'runGit')` pattern:

```typescript
describe("reconcileSharedCloneIntegration", () => {
  it("restores tracked deletions and quarantines untracked source-tracked files, then reports success", async () => {
    let statusCalls = 0;
    stubCapture((repoPath, args) => {
      if (args[0] === "status") {
        statusCalls += 1;
        // First scan: one deletion + one blocking untracked file. Second scan (post-actions): clean.
        return statusCalls === 1
          ? {
              code: 0,
              stdout:
                " D .agents/skills/debugging/SKILL.md\0?? docs/work-items/child-1.md\0",
              stderr: "",
            }
          : ok;
      }
      if (args[0] === "ls-tree") {
        return {
          code: 0,
          stdout:
            ".agents/skills/debugging/SKILL.md\0docs/work-items/child-1.md\0",
          stderr: "",
        };
      }
      return ok;
    });
    const runGit = vi.spyOn(service, "runGit").mockResolvedValue(undefined);
    const moves: Array<{ from: string; to: string }> = [];
    vi.spyOn(service, "moveFileWithDirs").mockImplementation(
      async (from: string, to: string) => {
        moves.push({ from, to });
      },
    );

    const result = await service.reconcileSharedCloneIntegration(
      "scope-1",
      SOURCE,
      BASE,
    );

    expect(result.outcome).toBe("succeeded");
    expect(result.restoredPaths).toEqual([".agents/skills/debugging/SKILL.md"]);
    expect(result.quarantinedPaths).toEqual(["docs/work-items/child-1.md"]);
    expect(result.sharedClonePath).toBe(CLONE_ROOT);
    expect(runGit).toHaveBeenCalledWith(
      CLONE_ROOT,
      ["checkout", "HEAD", "--", ".agents/skills/debugging/SKILL.md"],
      expect.anything(),
    );
    expect(moves).toHaveLength(1);
    expect(moves[0].from).toContain("docs/work-items/child-1.md");
    expect(moves[0].to).toContain("reconcile-quarantine");
    expect(moves[0].to).toContain("scope-1");
    // Safety: never git clean / reset --hard.
    expect(runGit).not.toHaveBeenCalledWith(
      CLONE_ROOT,
      expect.arrayContaining(["clean"]),
      expect.anything(),
    );
  });

  it("leaves ambiguous modified files for the agent and reports shared_clone_dirty", async () => {
    stubCapture((repoPath, args) => {
      if (args[0] === "status") {
        return { code: 0, stdout: " M src/feature.ts\0", stderr: "" };
      }
      if (args[0] === "ls-tree") {
        return { code: 0, stdout: "src/feature.ts\0", stderr: "" };
      }
      return ok;
    });
    const runGit = vi.spyOn(service, "runGit").mockResolvedValue(undefined);

    const result = await service.reconcileSharedCloneIntegration(
      "scope-1",
      SOURCE,
      BASE,
    );

    expect(result.outcome).toBe("shared_clone_dirty");
    expect(result.dirtyPaths).toEqual(["src/feature.ts"]);
    expect(result.sharedClonePath).toBe(CLONE_ROOT);
    expect(runGit).not.toHaveBeenCalledWith(
      CLONE_ROOT,
      expect.arrayContaining(["checkout"]),
      expect.anything(),
    );
  });

  it("surfaces the shared clone path on preflight results", async () => {
    stubCapture((repoPath, args) => {
      if (args[0] === "status") return ok;
      if (args[0] === "ls-tree") {
        return { code: 0, stdout: "src/feature.ts\0", stderr: "" };
      }
      return ok;
    });

    const result = await service.preflightSharedCloneIntegration(
      "scope-1",
      SOURCE,
      BASE,
    );

    expect(result.outcome).toBe("succeeded");
    expect(result.sharedClonePath).toBe(CLONE_ROOT);
  });
});
```

Note: if the second `status` scan in the first test is awkward because the reconcile executor recomputes blockers, it is equally valid to compute "remaining" as the `ambiguous` bucket from the single initial scan — in that case drop the `statusCalls` counter and assert one `status` invocation. Prefer the single-scan design (simpler, no TOCTOU pretence); the test above should then stub `status` once.

- [ ] **Step 2: Run tests to verify red**

Run: `npm run test --workspace=apps/api -- apps/api/src/common/git/git-merge.service.spec.ts`
Expected: FAIL — `reconcileSharedCloneIntegration` / `moveFileWithDirs` / `sharedClonePath` do not exist.

- [ ] **Step 3: Implement types, executor helper, and service method**

`git-merge.service.types.ts` — extend `MergeResult`:

```typescript
export interface MergeResult {
  // ... existing fields unchanged ...
  /** Shared clone paths that must be reconciled before direct integration. */
  dirtyPaths?: string[];
  /** Absolute path of the shared clone root the merge/preflight operated on. */
  sharedClonePath?: string;
  /** Tracked deletions restored from HEAD by deterministic reconciliation. */
  restoredPaths?: string[];
  /** Blocking untracked files moved into the quarantine directory. */
  quarantinedPaths?: string[];
}
```

`git-shared-clone-reconcile.helpers.ts` — add the executor (single initial scan; `remaining` = ambiguous bucket):

```typescript
import * as path from "node:path";
import type { MergeResult } from "./git-merge.service.types";

export interface SharedCloneReconcileRunner {
  runGit(
    repoPath: string,
    args: string[],
    authEnv: Record<string, string>,
  ): Promise<void>;
  runGitCapture(
    repoPath: string,
    args: string[],
    authEnv: Record<string, string>,
  ): Promise<{ code: number; stdout: string; stderr: string }>;
  moveFileWithDirs(from: string, to: string): Promise<void>;
}

const QUARANTINE_DIR_NAME = "reconcile-quarantine";

/** Quarantine root lives beside `clones/` on the same workspace mount. */
export function resolveQuarantineRoot(
  cloneRoot: string,
  scopeId: string,
  stamp: string,
): string {
  return path.resolve(
    cloneRoot,
    "..",
    "..",
    QUARANTINE_DIR_NAME,
    scopeId,
    stamp,
  );
}

export async function reconcileSharedCloneBlockers(
  runner: SharedCloneReconcileRunner,
  cloneRoot: string,
  scopeId: string,
  sourceBranch: string,
  destinationBranch: string,
  sourceTrackedPaths: Set<string>,
  authEnv: Record<string, string>,
): Promise<MergeResult> {
  const { stdout } = await runner.runGitCapture(
    cloneRoot,
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    authEnv,
  );
  const classification = classifySharedCloneBlockers(
    parsePorcelainEntries(stdout),
    sourceTrackedPaths,
  );

  for (const restorePath of classification.restorable) {
    await runner.runGit(
      cloneRoot,
      ["checkout", "HEAD", "--", restorePath],
      authEnv,
    );
  }

  const quarantineRoot = resolveQuarantineRoot(
    cloneRoot,
    scopeId,
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  for (const strayPath of classification.quarantinable) {
    await runner.moveFileWithDirs(
      path.join(cloneRoot, strayPath),
      path.join(quarantineRoot, strayPath),
    );
  }

  const remaining = classification.ambiguous;
  const reconciledSummary =
    `restored ${classification.restorable.length} deleted tracked file(s), ` +
    `quarantined ${classification.quarantinable.length} blocking untracked file(s)` +
    (classification.quarantinable.length > 0 ? ` under ${quarantineRoot}` : "");

  if (remaining.length === 0) {
    return {
      outcome: "succeeded",
      sourceBranch,
      destinationBranch,
      conflictedFiles: [],
      dirtyPaths: [],
      sharedClonePath: cloneRoot,
      restoredPaths: classification.restorable,
      quarantinedPaths: classification.quarantinable,
      message: `Shared clone reconciled deterministically: ${reconciledSummary}`,
    };
  }
  return {
    outcome: "shared_clone_dirty",
    sourceBranch,
    destinationBranch,
    conflictedFiles: [],
    dirtyPaths: remaining,
    sharedClonePath: cloneRoot,
    restoredPaths: classification.restorable,
    quarantinedPaths: classification.quarantinable,
    message:
      `Deterministic reconciliation done (${reconciledSummary}) but ambiguous paths remain: ` +
      remaining.join(", "),
  };
}
```

`git-merge.service.ts` — thin delegation plus the fs seam and `sharedClonePath` on both preflight return objects:

```typescript
import { mkdir, rename } from 'node:fs/promises';
import * as path from 'node:path';
import { reconcileSharedCloneBlockers } from './git-shared-clone-reconcile.helpers';

/** Seam for quarantine moves so specs can intercept filesystem effects. */
async moveFileWithDirs(from: string, to: string): Promise<void> {
  await mkdir(path.dirname(to), { recursive: true });
  await rename(from, to);
}

/**
 * Deterministically reconcile the provably-safe shared-clone blockers before
 * falling back to agent remediation: restore tracked deletions from HEAD and
 * quarantine untracked files the source branch already tracks.
 */
async reconcileSharedCloneIntegration(
  scopeId: string,
  sourceBranch: string,
  destinationBranch: string,
): Promise<MergeResult> {
  const cloneRoot = await this.resolveGitRepoPath(scopeId);
  if (!cloneRoot) {
    return failedResult(
      sourceBranch,
      destinationBranch,
      `Repository path is not a git repository: ${scopeId}`,
    );
  }
  const authEnv =
    await this.authEnvResolver.resolveProjectGitAuthEnv(scopeId);
  try {
    const sourceTrackedPaths = await this.listTrackedPaths(
      cloneRoot,
      sourceBranch,
      authEnv,
    );
    return await reconcileSharedCloneBlockers(
      this,
      cloneRoot,
      scopeId,
      sourceBranch,
      destinationBranch,
      sourceTrackedPaths,
      authEnv,
    );
  } catch (error) {
    return failedResult(
      sourceBranch,
      destinationBranch,
      (error as Error).message,
    );
  }
}
```

In `preflightSharedCloneIntegration`, add `sharedClonePath: cloneRoot` to both the `succeeded` and `shared_clone_dirty` return objects.

- [ ] **Step 4: Run tests to verify green**

Run: `npm run test --workspace=apps/api -- apps/api/src/common/git/git-merge.service.spec.ts apps/api/src/common/git/git-shared-clone-reconcile.helpers.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/git/
git commit -m "feat(git): deterministic shared-clone reconciliation with quarantine, surface clone path"
```

---

### Task 3: `merge_integrate_reconcile` git action wiring

**Files:**

- Modify: `apps/api/src/workflow/workflow-special-steps/step-git-operation-special-step.types.ts:5`
- Modify: `apps/api/src/workflow/workflow-special-steps/step-git-operation-special-step.handler.ts:53,93,100`
- Modify: `apps/api/src/workflow/workflow-special-steps/git-actions/merge-integrate-git-action.strategy.ts`
- Test: `apps/api/src/workflow/workflow-special-steps/git-actions/merge-integrate-git-action.strategy.spec.ts`

**Interfaces:**

- Consumes: `GitMergeService.reconcileSharedCloneIntegration` (Task 2).
- Produces: workflow-facing step output for `action: merge_integrate_reconcile`:
  `{ ok, stepId, action, merge_outcome, merge_message, dirty_paths, shared_clone_path, restored_paths, quarantined_paths, base_branch, target_branch, source_branch, destination_branch, repository_id, worktree_id }`.
  Existing preflight/integrate outputs additionally gain `shared_clone_path`.

- [ ] **Step 1: Write the failing test**

Mirror the existing `merge_integrate_preflight` spec (see `merge-integrate-git-action.strategy.spec.ts:140-151` for the fixture pattern):

```typescript
it("runs deterministic reconciliation for action merge_integrate_reconcile and surfaces reconcile evidence", async () => {
  gitMergeService.reconcileSharedCloneIntegration.mockResolvedValue({
    outcome: "succeeded",
    sourceBranch: "feature/x",
    destinationBranch: "main",
    conflictedFiles: [],
    dirtyPaths: [],
    sharedClonePath: "/data/nexus-workspaces/clones/scope-1",
    restoredPaths: [".agents/skills/debugging/SKILL.md"],
    quarantinedPaths: ["docs/work-items/child-1.md"],
    message: "Shared clone reconciled deterministically",
  });

  const result = await strategy.execute({
    workflowRunId: "run-1",
    stepId: "reconcile_deterministic",
    triggerContext,
    resolvedStepInputs: { action: "merge_integrate_reconcile" },
  });

  expect(gitMergeService.reconcileSharedCloneIntegration).toHaveBeenCalledWith(
    triggerContext.repositoryId,
    "feature/x",
    "main",
  );
  expect(result.output).toMatchObject({
    ok: true,
    action: "merge_integrate_reconcile",
    merge_outcome: "succeeded",
    shared_clone_path: "/data/nexus-workspaces/clones/scope-1",
    restored_paths: [".agents/skills/debugging/SKILL.md"],
    quarantined_paths: ["docs/work-items/child-1.md"],
  });
});
```

(Adapt branch names/mock wiring to the file's existing fixtures — the branch resolver mock already returns the base/target pair used by the preflight test.)

- [ ] **Step 2: Run test to verify red**

Run: `npm run test --workspace=apps/api -- apps/api/src/workflow/workflow-special-steps/git-actions/merge-integrate-git-action.strategy.spec.ts`
Expected: FAIL — action not recognised.

- [ ] **Step 3: Implement wiring**

`step-git-operation-special-step.types.ts` — add to the union:

```typescript
  | 'merge_integrate_reconcile'
```

`step-git-operation-special-step.handler.ts` — register and validate:

```typescript
['merge_integrate_reconcile', mergeIntegrateStrategy],
```

extend the action guard at line 93 with `action !== 'merge_integrate_reconcile' &&` and add the action name to the error message string at line 100.

`merge-integrate-git-action.strategy.ts` — resolve the requested action from a small map instead of the current ternary, branch to the service, and extend `toMergeOutput`:

```typescript
const PREFLIGHT_ACTION = "merge_integrate_preflight";
const RECONCILE_ACTION = "merge_integrate_reconcile";

// in execute():
const inputAction = getString(resolvedStepInputs, "action");
const requestedAction: GitOperationAction =
  inputAction === PREFLIGHT_ACTION || inputAction === RECONCILE_ACTION
    ? inputAction
    : this.action;

if (
  requestedAction === PREFLIGHT_ACTION ||
  requestedAction === RECONCILE_ACTION
) {
  const mergeResult =
    requestedAction === PREFLIGHT_ACTION
      ? await this.gitMergeService.preflightSharedCloneIntegration(
          triggerContext.repositoryId,
          targetBranch,
          baseBranch,
        )
      : await this.gitMergeService.reconcileSharedCloneIntegration(
          triggerContext.repositoryId,
          targetBranch,
          baseBranch,
        );
  return this.toMergeOutput(
    stepId,
    requestedAction,
    triggerContext,
    baseBranch,
    targetBranch,
    mergeResult,
  );
}
```

In `toMergeOutput`, add to the `output` object:

```typescript
shared_clone_path: mergeResult.sharedClonePath,
restored_paths: mergeResult.restoredPaths,
quarantined_paths: mergeResult.quarantinedPaths,
```

- [ ] **Step 4: Run tests to verify green**

Run: `npm run test --workspace=apps/api -- apps/api/src/workflow/workflow-special-steps/git-actions/merge-integrate-git-action.strategy.spec.ts apps/api/src/workflow/workflow-special-steps/step-git-operation-special-step.handler.spec.ts`
Expected: PASS (run the handler spec too — it may assert the exact error message updated in this task).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-special-steps/
git commit -m "feat(workflow): add merge_integrate_reconcile git action for deterministic clone hygiene"
```

---

### Task 4: Workflow YAML rewire + fallback prompt hardening

**Files:**

- Modify: `seed/workflows/work-item-ready-to-merge-default.workflow.yaml`
- Modify: `seed/workflows/prompts/work-item-ready-to-merge/reconcile-shared-clone-hygiene.md`
- Modify: `apps/api/src/database/seeds/workflow/workflows.seed.contract.spec.ts` (job-id expectations)

**Interfaces:**

- Consumes: `merge_integrate_reconcile` action (Task 3), `shared_clone_path` output (Tasks 2-3).
- Produces: job ids `reconcile_shared_clone_deterministic` and `reconcile_shared_clone_deterministic_after_remediation` referenced by transitions and the failure-evidence payload.

- [ ] **Step 1: Insert the deterministic job on the primary path**

In `work-item-ready-to-merge-default.workflow.yaml`, change `merge_integrate_preflight`'s dirty transition (line 123-124) to:

```yaml
- condition: "jobs.merge_integrate_preflight.output.merge_outcome == 'shared_clone_dirty'"
  next: reconcile_shared_clone_deterministic
```

Insert the new job before `reconcile_shared_clone_hygiene`:

```yaml
- id: reconcile_shared_clone_deterministic
  type: git_operation
  tier: light
  depends_on: [merge_integrate_preflight]
  inputs:
    action: merge_integrate_reconcile
    repository_id: "{{ trigger.scopeId }}"
    worktree_id: "{{ trigger.contextId }}"
    base_branch: "{{ trigger.resource.executionConfig.baseBranch }}"
    target_branch: "{{ trigger.resource.executionConfig.targetBranch }}"
  transitions:
    - condition: "jobs.reconcile_shared_clone_deterministic.output.merge_outcome == 'succeeded'"
      next: merge_integrate
    - condition: "jobs.reconcile_shared_clone_deterministic.output.merge_outcome == 'shared_clone_dirty'"
      next: reconcile_shared_clone_hygiene
    - condition: "jobs.reconcile_shared_clone_deterministic.output.merge_outcome == 'auth_error'"
      next: emit_merge_failed
    - condition: "jobs.reconcile_shared_clone_deterministic.output.merge_outcome == 'failed'"
      next: emit_merge_failed
```

Change `reconcile_shared_clone_hygiene`'s `depends_on` from `[merge_integrate_preflight]` to `[reconcile_shared_clone_deterministic]`.

- [ ] **Step 2: Mirror on the after-remediation path**

Apply the same pattern around `merge_integrate_preflight_after_remediation` (yaml lines ~284-315): its `shared_clone_dirty` transition targets a new `reconcile_shared_clone_deterministic_after_remediation` job (identical inputs, `depends_on: [merge_integrate_preflight_after_remediation]`), whose transitions are `succeeded → merge_integrate`, `shared_clone_dirty → reconcile_shared_clone_hygiene_after_remediation`, `auth_error/failed → emit_merge_failed`. Update `reconcile_shared_clone_hygiene_after_remediation`'s `depends_on` accordingly.

- [ ] **Step 3: Enrich the failure-evidence payload**

In the `emit_merge_failed` job payload (lines ~709-713), add:

```yaml
restoredPaths: "{{ jobs.reconcile_shared_clone_deterministic.output.restored_paths }}"
quarantinedPaths: "{{ jobs.reconcile_shared_clone_deterministic.output.quarantined_paths }}"
dirtyPathsAfterDeterministic: "{{ jobs.reconcile_shared_clone_deterministic.output.dirty_paths }}"
sharedClonePath: "{{ jobs.merge_integrate_preflight.output.shared_clone_path }}"
```

- [ ] **Step 4: Harden the fallback agent prompt**

In `reconcile-shared-clone-hygiene.md`, after the `Context ID:` line insert:

```markdown
Shared clone absolute path (primary):

{{jobs.reconcile_shared_clone_deterministic.output.shared_clone_path}}

Shared clone absolute path (post-quality-remediation):

{{jobs.reconcile_shared_clone_deterministic_after_remediation.output.shared_clone_path}}

Deterministic reconciliation already ran and handled the mechanically-safe
paths. The dirty paths listed below are only the AMBIGUOUS remainder
(e.g. modified tracked files) that needs judgment.

CRITICAL — path handling:

- Use the shared clone absolute path above via copy-paste ONLY. Never re-type
  it and never reconstruct it from the Scope ID: UUID transcription errors
  have previously wasted entire runs on nonexistent paths.
- Before any other command, run
  `cd <shared clone path> && git rev-parse --show-toplevel && git status --porcelain`
  and confirm the output matches the dirty paths below. If the directory does
  not exist, re-read the path from this prompt instead of retrying variants.
```

Also replace the two existing "Primary dirty paths" / "Post-quality-remediation dirty paths" template refs with the deterministic jobs' remaining `dirty_paths`:

```markdown
Primary dirty paths (ambiguous remainder):

{{jobs.reconcile_shared_clone_deterministic.output.dirty_paths}}

Post-quality-remediation dirty paths (ambiguous remainder):

{{jobs.reconcile_shared_clone_deterministic_after_remediation.output.dirty_paths}}
```

- [ ] **Step 5: Update the seed contract spec and validate**

Run: `npm run test --workspace=apps/api -- apps/api/src/database/seeds/workflow/workflows.seed.contract.spec.ts`
Update its expected job-id/transition assertions for the two new jobs until it passes honestly (extend expectations, don't weaken them).

Then run:

- `npm run build --workspace=packages/core && npm run build:api`
- `npm run validate:seed-data`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add seed/workflows/ apps/api/src/database/seeds/workflow/workflows.seed.contract.spec.ts
git commit -m "feat(workflow): route shared-clone dirt through deterministic reconcile before agent fallback"
```

---

### Task 5: Documentation

**Files:**

- Create: `docs/architecture/decisions/ADR-deterministic-shared-clone-reconciliation.md`
- Modify: `docs/guide/README.md` (only if it documents the ready-to-merge flow; otherwise skip)

- [ ] **Step 1: Write the ADR**

Context: run f2f5adb7 incident (agent UUID transcription failure on a mechanically-safe reconciliation). Decision: deterministic-first reconciliation (`merge_integrate_reconcile`) with quarantine-not-delete semantics; LLM agent demoted to ambiguous-remainder fallback; absolute clone path injected into the fallback prompt. Alternatives rejected: agent-only with prompt hardening (still trusts LLM transcription for mechanical git surgery); auto `git clean`/`checkout -f` (destroys possibly-sole-copy spec files). Consequences: new quarantine directory accrues files and needs eventual GC; ambiguous modified-tracked-file dirt still requires agent/human.

- [ ] **Step 2: Commit**

```bash
git add docs/
git commit -m "docs: ADR for deterministic shared-clone reconciliation"
```

---

### Task 6: Full verification

- [ ] **Step 1: Run the affected suites and builds**

```bash
npm run test --workspace=apps/api -- apps/api/src/common/git/ apps/api/src/workflow/workflow-special-steps/git-actions/ apps/api/src/database/seeds/workflow/workflows.seed.contract.spec.ts
npm run build --workspace=packages/core
npm run build:api
npm run lint:api
```

Expected: all PASS (document any pre-existing unrelated failures before proceeding).

- [ ] **Step 2: Full api test suite**

Run: `npm run test:api`
Expected: PASS. **Warning:** this wipes `memory_segments` on the dev DB (5433) if `DB_HOST` is set — unset it or accept the known charter loss (see project memory).

---

### Task 7: Live-stack recovery runbook (operational — after code is merged)

The live clone for scope `458935f0-213e-4bbe-89d1-8883e0efa9ad` currently has 3 deleted `SKILL.md` files and ~95 untracked `docs/work-items/*.md` (some may be the only copy of authored specs — never delete).

- [ ] **Step 1: Manually reconcile the live clone (quarantine, don't delete)**

```bash
CLONE=/data/nexus-workspaces/clones/458935f0-213e-4bbe-89d1-8883e0efa9ad
Q=/data/nexus-workspaces/reconcile-quarantine/458935f0-213e-4bbe-89d1-8883e0efa9ad/manual-2026-07-02
docker exec nexus-api sh -c "
  git -C $CLONE checkout HEAD -- .agents/skills/debugging/SKILL.md .agents/skills/dependency-updater/SKILL.md .agents/skills/task-progress-tracking/SKILL.md &&
  mkdir -p $Q/docs/work-items &&
  cd $CLONE &&
  git ls-files --others --exclude-standard -z -- docs/work-items |
    while IFS= read -r -d '' f; do mv \"\$f\" \"$Q/\$f\"; done &&
  git status --porcelain
"
```

Expected final `git status --porcelain`: empty.

- [ ] **Step 2: Rebuild and redeploy the API (code + seed YAML changed)**

```bash
docker compose up -d --build api
docker compose logs -f api   # confirm healthy boot + workflow reseed
```

- [ ] **Step 3: Re-trigger the stuck merge**

Re-trigger ready-to-merge for work item `7bfe81ba-1db4-448f-8065-9eee4c8da5b4` (same manual-retrigger mechanism as run f2f5adb7) and watch the run: expect `merge_integrate_preflight → succeeded → merge_integrate` directly (clone now clean), or the deterministic job handling any new dirt without invoking the agent.

---

## Deferred / follow-ups (explicitly out of scope)

- **Pin a stronger model** on the `reconcile_hygiene` fallback steps (`steps[].inputs.model`): worth doing but needs a model choice decision; the deterministic path removes the common cases regardless.
- **Quarantine GC**: fold `reconcile-quarantine/` into the existing cleanup cron with an age threshold once volume is observed.
- **Root producers of clone dirt** (spec-writer workflows writing untracked specs into the clone root, skill-file deletions) — partially addressed by the publish-specs untracked guard; the remaining producers are tracked in existing memories/plans.
