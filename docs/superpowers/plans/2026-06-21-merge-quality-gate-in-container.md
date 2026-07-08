# Merge Quality Gate In Execution Container — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the auto-merge quality gate (build/lint/unit-tests) inside the execution container where work is validated — not via the `.husky/pre-push` hook in the python-less `nexus-api` clone root — so the gate's verdict matches what the remediation agent sees.

**Architecture:** Split the merge `git_operation` into `merge_prepare` (worktree merge, no push) and `merge_integrate` (hook-free integration push). Insert an explicit `quality_gate` execution job (`tier: heavy`, a `run_command` step) that runs the gate at `/workspace`. The integration push runs with git hooks disabled. The existing remediation loop is rewired to consume the gate job's stdout/stderr instead of the merge job's `quality_gate_log`.

**Tech Stack:** NestJS (apps/api), TypeORM, Vitest, Handlebars-templated workflow YAML (`seed/workflows/`), Docker execution containers (`docker/Dockerfile.heavy` has python3; `apps/api/Dockerfile` does not).

## Global Constraints

- **Core/Kanban boundary:** API/core code stays Kanban-neutral. This plan touches only merge git mechanics + the merge workflow seed; no Kanban domain identifiers in `apps/api/src` or `packages/core`. (CLAUDE.md "Core/Kanban Boundary")
- **Strict lint policy:** No `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, or rule downgrades. Fix findings in code. (CLAUDE.md "Development Conventions")
- **NestJS build:** Use `nest build` / workspace scripts, not raw `tsc`.
- **TDD:** Red→Green→Refactor for every change. Run single tests during iteration: `npm run test --workspace=apps/api -- <path>`.
- **Build order:** `npm run build --workspace=packages/core` before building apps when core types change (none expected here, but the merge `MergeResult` type lives in `apps/api/src/common/git`).
- **Tier with python:** The quality-gate job MUST be `tier: heavy` — `docker/Dockerfile.heavy` installs `python3`; `apps/api/Dockerfile` and `docker/Dockerfile.light` do not. `apps/api/src/tool/python-execution.spec.ts` and `tool-sandbox.service.spec.ts` spawn `python3` and have no environment guard.

---

## Background: Verified Root Cause (run `37a72265-f61e-4126-90bf-d1eec78a683f`)

- The auto-merge workflow `work_item_ready_to_merge_default` ran: `attempt_merge` → `quality_gate_failed` → `remediate_quality_gate` (agent, ~38 min) → `validate_merge_after_remediation` → `quality_gate_failed` again → `emit_merge_failed` → `terminate_failed_merge` → `workflow.failed`.
- The merge `git_operation` runs in the `nexus-api` alpine container. Its stage-2 `git push` (`git-merge.service.ts:353`) triggers `.husky/pre-push`, which runs `build → lint → test:api → test:kanban → test:unit:web`.
- The api container has **no python3** (`apps/api/Dockerfile:31` installs only `git`). The api test suite includes `python-execution.spec.ts`/`tool-sandbox.service.spec.ts` (spawn `python3`, `tool-sandbox.service.ts:172`) and `app-events.gateway.spec.ts` (fixed-port websocket). Result: **40 environment-only test failures** → `merge_outcome: quality_gate_failed`.
- The remediation agent runs in `tier: heavy` (`/usr/bin/python3` present). There those exact suites **pass** (29/21/6); the only real failure was an unrelated `telegram-runtime-settings` env-var casing bug, which the agent fixed, committed, and verified green. The agent cannot fix the gate because in its environment there is nothing to fix.
- Net: the gate executes in the **wrong environment** relative to where work is validated. "Green in the agent" can never imply "green in the gate." Same class as `project_merge_runs_in_shared_clone_root`.

---

## File Structure

| File                                                                                                                                | Responsibility               | Change                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------ |
| `apps/api/src/common/git/git-merge.service.ts`                                                                                      | Git merge mechanics          | Promote stage-1/stage-2 to public methods; disable git hooks on the integration push |
| `apps/api/src/common/git/git-merge.service.types.ts`                                                                                | Merge result types           | (read-only) confirm `MergeResult.outcome` union                                      |
| `apps/api/src/workflow/workflow-special-steps/step-git-operation-special-step.types.ts`                                             | `GitOperationAction` union   | Add `merge_prepare`, `merge_integrate`                                               |
| `apps/api/src/workflow/workflow-special-steps/git-actions/merge-prepare-git-action.strategy.ts`                                     | Stage-1 strategy             | **Create**                                                                           |
| `apps/api/src/workflow/workflow-special-steps/git-actions/merge-integrate-git-action.strategy.ts`                                   | Stage-2 strategy             | **Create**                                                                           |
| `apps/api/src/workflow/workflow-special-steps/step-git-operation-special-step.handler.ts`                                           | Action→strategy registration | Register the two new strategies                                                      |
| `apps/api/src/workflow/workflow-special-steps/workflow-special-steps.module.ts` (or the module providing strategies)                | DI providers                 | Provide the two new strategies                                                       |
| `seed/workflows/work-item-ready-to-merge-default.workflow.yaml`                                                                     | Auto-merge DAG               | Restructure: prepare → quality_gate → integrate; rewire remediation loop             |
| `seed/workflows/prompts/work-item-ready-to-merge/remediate-quality-gate.md`                                                         | Remediation prompt           | Read gate stdout/stderr instead of `quality_gate_log`                                |
| `apps/api/src/database/seeds/workflow/workflows.seed.contract.spec.ts` (and/or `seed-data-validation.contract-integration.spec.ts`) | Seed contract                | Update expectations for the new DAG                                                  |

> The legacy single `merge` action and `MergeGitActionStrategy` are **deleted** after the split (CLAUDE.md "Eliminate, Don't Deprecate"). Confirm no other workflow seed uses `action: merge` before deleting (Task 7).

---

## Phase 1 — Git mechanics: split stages, hook-free push

### Task 1: Disable git hooks on the integration push

**Files:**

- Modify: `apps/api/src/common/git/git-merge.service.ts` (method `mergeAndPushBranch`, ~line 353)
- Test: `apps/api/src/common/git/git-merge.service.spec.ts`

**Interfaces:**

- Produces: the integration push no longer triggers `.husky/pre-push`. The git invocation gains `-c core.hooksPath=/dev/null` (or `/dev/null` equivalent) on the `push` command only.

- [ ] **Step 1: Write the failing test.** In `git-merge.service.spec.ts`, find the suite that exercises the push (mocks the git runner). Add a test asserting the push git args include hook suppression:

```ts
it("disables local git hooks on the integration push", async () => {
  // arrange: mock runGitCapture to capture args, force a successful push
  const pushArgs = capturedGitArgsFor("push");
  expect(pushArgs).toEqual(
    expect.arrayContaining(["-c", "core.hooksPath=/dev/null"]),
  );
  expect(pushArgs).toEqual(
    expect.arrayContaining(["push", "--set-upstream", "origin"]),
  );
});
```

(Match the spec's existing mocking style for `runGit`/`runGitCapture`; reuse its harness rather than inventing one.)

- [ ] **Step 2: Run it, confirm RED.** `npm run test --workspace=apps/api -- src/common/git/git-merge.service.spec.ts -t "disables local git hooks"` → FAIL.

- [ ] **Step 3: Implement.** In `mergeAndPushBranch`, change the push to prepend hook suppression. `runGitCapture` prepends `git`; pass the global flag as the first args:

```ts
const push = await this.runGitCapture(
  repoPath,
  [
    "-c",
    "core.hooksPath=/dev/null",
    "push",
    "--set-upstream",
    "origin",
    destinationBranch,
  ],
  authEnv,
);
```

- [ ] **Step 4: Run it, confirm GREEN.** Same command → PASS.

- [ ] **Step 5: Verify no other push path runs the gate.** Grep `git-merge.service.ts` for other `'push'` invocations; if any push could trigger the hook in the api container, apply the same suppression. Re-run the full file: `npm run test --workspace=apps/api -- src/common/git/git-merge.service.spec.ts`.

- [ ] **Step 6: Commit.**

```bash
git add apps/api/src/common/git/git-merge.service.ts apps/api/src/common/git/git-merge.service.spec.ts
git commit -m "fix(git-merge): disable local hooks on integration push so the gate runs in-container"
```

### Task 2: Expose stage-1 (`prepareWorktreeMerge`) and stage-2 (`integrateIntoBase`) as public methods

**Files:**

- Modify: `apps/api/src/common/git/git-merge.service.ts`
- Test: `apps/api/src/common/git/git-merge.service.spec.ts`

**Interfaces:**

- Produces two public methods consumed by Tasks 3–4:
  - `prepareWorktreeMerge(repositoryId: string, sourceBranch: string, destinationBranch: string, worktreePath: string): Promise<MergeResult>` — runs the worktree merge only (current Stage 1). Returns `outcome: 'succeeded' | 'conflict' | 'auth_error' | 'failed'`; never pushes.
  - `integrateAndPush(repositoryId: string, sourceBranch: string, destinationBranch: string): Promise<MergeResult>` — runs the clone-root integration + hook-free push (current Stage 2). Returns `outcome: 'succeeded' | 'auth_error' | 'failed'`.
- Constraint: keep the existing private `prepareWorktreeMerge`/`integrateIntoBase` logic; this task only re-shapes the public surface and resolves `cloneRoot`/`scopeId` inside `integrateAndPush` (currently done in `mergeWithConflictDetection` at line 70).

- [ ] **Step 1: Write failing tests.** Add two tests: (a) `prepareWorktreeMerge` returns `conflict` and does NOT call push when the worktree merge conflicts; (b) `integrateAndPush` resolves the clone root via `resolveGitRepoPath(scopeId)` and performs the hook-free push. Mirror the existing `mergeWithConflictDetection` tests' mocks.

- [ ] **Step 2: Run, confirm RED.** `npm run test --workspace=apps/api -- src/common/git/git-merge.service.spec.ts -t "prepareWorktreeMerge|integrateAndPush"`.

- [ ] **Step 3: Implement.** Add the two public methods. `integrateAndPush` does `const cloneRoot = await this.resolveGitRepoPath(scopeId); if (!cloneRoot) return failedResult(...);` then calls the existing private `integrateIntoBase`. Keep `mergeWithConflictDetection` working by delegating to the two new methods (so existing callers/tests stay green) OR mark it for removal in Task 5 once the strategies are split. Prefer: keep it delegating this task; remove in Task 5.

- [ ] **Step 4: Run, confirm GREEN**, including the pre-existing `mergeWithConflictDetection` tests.

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/common/git/git-merge.service.ts apps/api/src/common/git/git-merge.service.spec.ts
git commit -m "refactor(git-merge): expose prepareWorktreeMerge and integrateAndPush"
```

---

## Phase 2 — Two git actions: `merge_prepare` and `merge_integrate`

### Task 3: Add `merge_prepare` action + strategy

**Files:**

- Modify: `apps/api/src/workflow/workflow-special-steps/step-git-operation-special-step.types.ts` (add `'merge_prepare'` to `GitOperationAction`)
- Create: `apps/api/src/workflow/workflow-special-steps/git-actions/merge-prepare-git-action.strategy.ts`
- Test: `apps/api/src/workflow/workflow-special-steps/git-actions/merge-prepare-git-action.strategy.spec.ts`

**Interfaces:**

- Consumes: `GitMergeService.prepareWorktreeMerge` (Task 2), `GitWorktreeService`, helpers `resolveBranchValue`, `requireWorktreeId`, `resolveMergeWorktreePath` (from `step-git-operation-special-step.helpers`).
- Produces step output: `{ ok, stepId, action: 'merge_prepare', merge_outcome, merge_message, auth_error_class, base_branch, target_branch, source_branch, destination_branch, conflicted_files, repository_id, worktree_id }`. **No `quality_gate_log`** — the gate moved out.

- [ ] **Step 1: Write failing test.** Copy the structure of `merge-git-action.strategy.spec.ts`. Assert: given a clean worktree merge, output `merge_outcome === 'succeeded'` and `prepareWorktreeMerge` was called with the resolved worktree path; given conflict, `merge_outcome === 'conflict'` and `conflicted_files` populated; `gitMergeService.integrateAndPush` is **never** called.

- [ ] **Step 2: Run, confirm RED.** `npm run test --workspace=apps/api -- merge-prepare-git-action.strategy.spec.ts`.

- [ ] **Step 3: Implement the strategy.** Model on `MergeGitActionStrategy.execute` (branch resolution, `normalizeTargetBranch`, `resolveActualWorktreeBranch`, `resolveMergeWorktreePath`) but call `prepareWorktreeMerge` and set `action: 'merge_prepare'`, `readonly action: GitOperationAction = 'merge_prepare'`. Extract the shared branch-resolution helpers into `step-git-operation-special-step.helpers.ts` if duplication exceeds a few lines (DRY) — Task 4 reuses them.

- [ ] **Step 4: Run, confirm GREEN.**

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/workflow/workflow-special-steps/git-actions/merge-prepare-git-action.strategy.ts apps/api/src/workflow/workflow-special-steps/git-actions/merge-prepare-git-action.strategy.spec.ts apps/api/src/workflow/workflow-special-steps/step-git-operation-special-step.types.ts
git commit -m "feat(git-operation): add merge_prepare action (worktree merge, no push)"
```

### Task 4: Add `merge_integrate` action + strategy

**Files:**

- Modify: `step-git-operation-special-step.types.ts` (add `'merge_integrate'`)
- Create: `apps/api/src/workflow/workflow-special-steps/git-actions/merge-integrate-git-action.strategy.ts`
- Test: `.../git-actions/merge-integrate-git-action.strategy.spec.ts`

**Interfaces:**

- Consumes: `GitMergeService.integrateAndPush` (Task 2), the shared branch-resolution helpers.
- Produces output: `{ ok, stepId, action: 'merge_integrate', merge_outcome, merge_message, auth_error_class, base_branch, target_branch, source_branch, destination_branch, baseMergeCommit, mergeCommit, repository_id, worktree_id }`. Outcomes: `succeeded | auth_error | failed`.

- [ ] **Step 1: Write failing test.** Assert: calls `integrateAndPush` with resolved source/destination branches; maps `succeeded` → `ok: true` with `mergeCommit`; maps `auth_error`/`failed` → `ok: false`.

- [ ] **Step 2: Run, confirm RED.** `npm run test --workspace=apps/api -- merge-integrate-git-action.strategy.spec.ts`.

- [ ] **Step 3: Implement.** `readonly action: GitOperationAction = 'merge_integrate'`. Resolve branches identically to Task 3, then call `integrateAndPush`.

- [ ] **Step 4: Run, confirm GREEN.**

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/workflow/workflow-special-steps/git-actions/merge-integrate-git-action.strategy.ts apps/api/src/workflow/workflow-special-steps/git-actions/merge-integrate-git-action.strategy.spec.ts apps/api/src/workflow/workflow-special-steps/step-git-operation-special-step.types.ts
git commit -m "feat(git-operation): add merge_integrate action (hook-free integration push)"
```

### Task 5: Register the new strategies; delete the legacy `merge` action

**Files:**

- Modify: `apps/api/src/workflow/workflow-special-steps/step-git-operation-special-step.handler.ts` (strategy map, ~lines 45-51)
- Modify: the module providing git-action strategies (the one with the `GitActionStrategy[]` providers — find via `grep -rl "MergeGitActionStrategy" apps/api/src --include=*.module.ts`)
- Delete: `merge-git-action.strategy.ts` + `merge-git-action.strategy.spec.ts`
- Modify: `step-git-operation-special-step.types.ts` (remove `'merge'` from `GitOperationAction`)
- Test: `step-git-operation-special-step.handler.spec.ts`

**Interfaces:**

- Consumes: `MergePrepareGitActionStrategy` (Task 3), `MergeIntegrateGitActionStrategy` (Task 4).
- Produces: handler resolves `action: 'merge_prepare'` and `'merge_integrate'`; `action: 'merge'` is no longer valid.

- [ ] **Step 1: Update/replace handler test.** In `step-git-operation-special-step.handler.spec.ts`, replace assertions that `'merge'` dispatches to `MergeGitActionStrategy` with assertions that `'merge_prepare'`→prepare strategy and `'merge_integrate'`→integrate strategy. Add a test that an unknown/removed `'merge'` action throws the handler's "unsupported action" error.

- [ ] **Step 2: Run, confirm RED.** `npm run test --workspace=apps/api -- step-git-operation-special-step.handler.spec.ts`.

- [ ] **Step 3: Implement.** Register both strategies in the strategy map + DI providers. Delete `MergeGitActionStrategy` and its spec. Remove `'merge'` from the `GitOperationAction` union. Remove `mergeWithConflictDetection` from `GitMergeService` if now unused (grep first: `grep -rn "mergeWithConflictDetection" apps/api/src` — should be only the deleted strategy + its tests).

- [ ] **Step 4: Run, confirm GREEN.** Handler spec + `npm run test --workspace=apps/api -- src/common/git src/workflow/workflow-special-steps/git-actions`.

- [ ] **Step 5: Typecheck.** `npm run build:api`.

- [ ] **Step 6: Commit.**

```bash
git add -A
git commit -m "refactor(git-operation): replace merge action with merge_prepare + merge_integrate"
```

---

## Phase 3 — Workflow DAG: insert the in-container quality gate

### Task 6: Restructure `work-item-ready-to-merge-default.workflow.yaml`

**Files:**

- Modify: `seed/workflows/work-item-ready-to-merge-default.workflow.yaml`
- Modify: `seed/workflows/prompts/work-item-ready-to-merge/remediate-quality-gate.md`

**Interfaces:**

- Consumes job outputs: `jobs.<prepare>.output.merge_outcome`, `jobs.quality_gate.output.ok` / `.exit_code` / `.stdout` / `.stderr` (shape from `executeCommandStepOnContainer`: `{ ok, stepId, exit_code, stdout, stderr, timed_out, stdout_lines }`), `jobs.<integrate>.output.merge_outcome`.
- The gate command runs the SAME checks the pre-push hook ran, at `/workspace`:
  `npm run build && npm run lint && npm run test:api && npm run test:kanban && npm run test:unit:web`

- [ ] **Step 1: Rewrite the DAG.** New happy path and loop (replace `attempt_merge`'s single `merge` action and the `validate_merge_after_remediation` re-merge):

```yaml
- id: merge_prepare
  type: git_operation
  tier: light
  inputs:
    action: merge_prepare
    repository_id: "{{ trigger.scopeId }}"
    worktree_id: "{{ trigger.contextId }}"
    base_branch: "{{ trigger.resource.executionConfig.baseBranch }}"
    target_branch: "{{ trigger.resource.executionConfig.targetBranch }}"
  transitions:
    - condition: "jobs.merge_prepare.output.merge_outcome == 'succeeded'"
      next: quality_gate
    - condition: "jobs.merge_prepare.output.merge_outcome == 'conflict'"
      next: resolve_local_conflicts
    - condition: "jobs.merge_prepare.output.merge_outcome == 'auth_error'"
      next: emit_merge_failed
    - condition: "jobs.merge_prepare.output.merge_outcome == 'failed'"
      next: emit_merge_failed

- id: quality_gate
  type: execution
  tier: heavy # heavy image has python3; light/api do not
  depends_on: [merge_prepare]
  steps:
    - id: run_gate
      type: run_command
      working_dir: /workspace
      timeout_ms: 1200000 # 20m; full suite ran ~390s, leave headroom
      command: "npm run build && npm run lint && npm run test:api && npm run test:kanban && npm run test:unit:web"
  transitions:
    - condition: "jobs.quality_gate.output.ok == true"
      next: merge_integrate
    - condition: "jobs.quality_gate.output.ok == false"
      next: remediate_quality_gate

- id: merge_integrate
  type: git_operation
  tier: light
  depends_on: [quality_gate]
  inputs:
    action: merge_integrate
    repository_id: "{{ trigger.scopeId }}"
    worktree_id: "{{ trigger.contextId }}"
    base_branch: "{{ trigger.resource.executionConfig.baseBranch }}"
    target_branch: "{{ trigger.resource.executionConfig.targetBranch }}"
  transitions:
    - condition: "jobs.merge_integrate.output.merge_outcome == 'succeeded'"
      next: record_merge_metadata_clean
    - condition: "jobs.merge_integrate.output.merge_outcome == 'auth_error'"
      next: emit_merge_failed
    - condition: "jobs.merge_integrate.output.merge_outcome == 'failed'"
      next: emit_merge_failed
```

- [ ] **Step 2: Rewire remediation to re-run the gate (bounded).** `remediate_quality_gate` should depend on `quality_gate` and, on `ok: true`, route back to a **second, bounded** gate pass rather than to a re-merge. Add a `quality_gate_after_remediation` job (identical command, `depends_on: [remediate_quality_gate]`) whose pass → `merge_integrate` and whose fail → `emit_merge_failed`. This preserves the existing single-remediation bound (no infinite loop). Keep `resolve_local_conflicts`/`resolve_remote_conflicts` routing into `quality_gate` after conflict resolution so resolved conflicts are also gated.

- [ ] **Step 3: Repoint metadata jobs.** `record_merge_metadata_clean` now reads `jobs.merge_integrate.output.*`; the remediated metadata job reads `jobs.merge_integrate.output.*` with `feedback: "{{ jobs.remediate_quality_gate.output.response }}"`. Remove `validate_merge_after_remediation`. Ensure `emit_merge_failed` payload references existing jobs (replace `jobs.attempt_merge.*` with `jobs.merge_prepare.*`).

- [ ] **Step 4: Update the remediation prompt.** In `remediate-quality-gate.md`, replace line 16 `## {{jobs.attempt_merge.output.quality_gate_log}}` with the gate job's captured output:

```markdown
## Captured failure log

STDOUT:
{{jobs.quality_gate.output.stdout}}

STDERR:
{{jobs.quality_gate.output.stderr}}
```

Also soften the framing on lines 11-12: the push is no longer the gate; say "the in-container quality gate (build/lint/unit tests) failed."

- [ ] **Step 5: Validate YAML + seed.** `npm run validate:seed-data`. Expected: PASS (workflow parses, DAG references resolve).

- [ ] **Step 6: Commit.**

```bash
git add seed/workflows/work-item-ready-to-merge-default.workflow.yaml seed/workflows/prompts/work-item-ready-to-merge/remediate-quality-gate.md
git commit -m "feat(merge): run quality gate in heavy execution container, integrate hook-free"
```

### Task 7: Update seed contract tests + sweep for stale `merge` action references

**Files:**

- Modify: `apps/api/src/database/seeds/workflow/workflows.seed.contract.spec.ts`
- Modify: `apps/api/src/database/seeds/seed-data-validation.contract-integration.spec.ts` (if it asserts the merge DAG)
- Test sweep: any spec referencing `action: merge`, `attempt_merge`, `validate_merge_after_remediation`, or `quality_gate_log` from `attempt_merge`.

- [ ] **Step 1: Find stale references.** `grep -rn "attempt_merge\|validate_merge_after_remediation\|action: merge\b\|quality_gate_log" apps/api/src seed --include=*.ts --include=*.yaml`. Every hit outside the new design is a required update.

- [ ] **Step 2: Update contract expectations** to assert the new job ids (`merge_prepare`, `quality_gate`, `merge_integrate`, `quality_gate_after_remediation`) and that `quality_gate*` jobs are `tier: heavy` with a `run_command` step. Write these as failing assertions first (RED), then confirm they match the YAML (GREEN).

- [ ] **Step 3: Run.** `npm run test --workspace=apps/api -- src/database/seeds`.

- [ ] **Step 4: Confirm no other workflow uses the deleted `merge` action.** The grep from Step 1 must show zero remaining `action: merge` in `seed/`. If another workflow used it, that workflow needs the same prepare/integrate split (out of scope — flag it, do not silently break it).

- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "test(seed): assert in-container quality-gate merge DAG"
```

---

## Phase 4 — Full verification

### Task 8: Repo-wide gates + live smoke

- [ ] **Step 1: Build.** `npm run build --workspace=packages/core && npm run build:api`.
- [ ] **Step 2: Lint.** `npm run lint:api` (and `npm run lint:summary` for repo-wide visibility). Zero errors (strict policy).
- [ ] **Step 3: Unit tests.** `npm run test:api`. All green.
- [ ] **Step 4: Seed validation.** `npm run validate:seed-data`.
- [ ] **Step 5: Live smoke (requires stack).** Rebuild nexus-api (`docker compose up -d --build nexus-api`), reseed, then drive a work item to `ready-to-merge` against a repo whose branch has a deliberately failing lint/test, AND one that is clean. Confirm via the debug bundle (`.agents/skills/retrieve-debug-bundle`) that:
  - clean branch: `merge_prepare` → `quality_gate` (ok) → `merge_integrate` (succeeded) → done.
  - failing branch with a fixable lint error: gate fails → remediate → `quality_gate_after_remediation` (ok) → integrate.
  - The gate runs in a heavy container (`tier: heavy`, worktree at `/workspace`), and `merge_integrate`'s push log shows no `.husky/pre-push` output.
- [ ] **Step 6: Update docs.** Note the in-container gate in `docs/guide/` (merge/auto-merge section) and add a short ADR under `docs/` capturing the decision (gate runs where work is validated, not in the api clone root). Reference this plan.

---

## Self-Review Notes

- **Spec coverage:** hook-free push (T1), stage split (T2), two actions (T3/T4), registration+legacy delete (T5), DAG+gate+prompt (T6), seed contracts+sweep (T7), verification+docs (T8). The chosen direction ("move the gate out of the api clone root, run it where the agent validated") is satisfied by T1 (no gate in api) + T6 (gate in heavy container at `/workspace`).
- **Type consistency:** `GitOperationAction` gains `merge_prepare`/`merge_integrate` and loses `merge`; both strategies and the handler map use those exact strings; YAML `inputs.action` matches. Gate output fields (`ok`, `stdout`, `stderr`, `exit_code`) come verbatim from `executeCommandStepOnContainer`.
- **Open risk / follow-ups (not silently dropped):**
  1. **Gate validates the worktree (feature+base) not the clone-root integration commit.** Equivalent content, but if `merge_integrate`'s clone-root merge differs (e.g. base advanced between prepare and integrate), the pushed commit was not the exact tree gated. Mitigation: `merge_integrate` resets base to `origin/<base>` then merges the same source; a base that advances mid-run is already handled by the existing remote-conflict path. Acceptable; document it.
  2. **`app-events.gateway.spec.ts` fixed-port flakiness** (`:35` ephemeral listen vs `:52` fixed `TELEMETRY_GATEWAY_PORT`) is independent of environment and could still flake the gate. Recommend a separate small fix: connect to the ephemeral port from `listen(0)`. Tracked as a follow-up, not part of this plan.
  3. **Latent prod bug:** `ToolSandboxService` is a live API runtime provider (`tool-candidate.service.ts`, `tool-runtime-execution.service.ts`) that spawns `python3`, but `apps/api/Dockerfile` has no python3. If the API ever executes a python tool candidate in-process it will fail. Separate investigation.

```

```
