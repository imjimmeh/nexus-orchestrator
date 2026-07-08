# Merge Pre-Push Quality-Gate Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "Work Item Ready-to-Merge Default Auto-Merge" workflow recognise a `git push` rejected by the repo's pre-push quality gate (lint/tests) as a distinct, recoverable outcome and route it to an agent that fixes the violations and retries — instead of terminating as an unclassifiable hard failure.

**Architecture:** Add a `quality_gate_failed` merge outcome in `GitMergeService` (distinguished from a remote non-fast-forward rejection), capturing the hook's combined stdout+stderr. Surface it through the `git_operation` handler. Add a bounded remediation branch to the workflow YAML that mirrors the existing conflict-resolution path: an `architect-agent` fixes lint/tests in the per-run worktree, then a re-validation merge re-pushes. Add a classifier rule + repair-policy entry as a backstop so the failure is no longer `ambiguous_failure`.

**Tech Stack:** NestJS, TypeScript, Vitest, TypeORM, Handlebars-templated workflow YAML.

## Global Constraints

- **No lint suppression** — never add `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, or rule downgrades (`.github/instructions/lint-warning-policy.instructions.md`).
- **Core/Kanban boundary** — `apps/api/src` and `packages/core/src` stay Kanban-neutral; no kanban/work-item identifiers in API/core code (CLAUDE.md "Core/Kanban Boundary").
- **NestJS build/test** — run API tests with `npm run test --workspace=apps/api` (Vitest + SWC decorator metadata).
- **TDD** — every code change starts with a failing test (Red-Green-Refactor).
- **Strong typing** — no `any`; extend the existing discriminated unions.

### Resolved design decisions (from `docs/plans/2026-06-20-merge-quality-gate-remediation-design.md`)

1. **Eligibility** — inline remediation (the workflow branch) is the primary recovery; the classifier class is a `human_required` backstop. No new repair-action plugin (YAGNI).
2. **Retry bound** — exactly one remediation pass (matches the conflict path's `max_retries: 1`).
3. **Checkout** — remediation reuses the existing per-run worktree, exactly like `resolve_local_conflicts`. The two-stage merge in `GitMergeService` already integrates the fixed feature branch on re-validation, so no new worktree infra is needed. `prepareCleanBase` resets the clone root to `origin/<base>` on every merge, discarding the discarded `--fix` working-tree edits.
4. **Hook-output capture** — capture combined stdout+stderr on push failure only.
5. **Scope** — remediation is wired for the **`attempt_merge`** job only (the observed and overwhelmingly common case: the first push). A quality-gate failure on a later `validate_merge*` job still falls through to `emit_merge_failed` (current behaviour, no regression).

---

## File Structure

| File                                                                                           | Responsibility                                          | Change                                                            |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------- |
| `apps/api/src/common/git/git-merge.service.types.ts`                                           | `MergeOutcome` union + `MergeResult` shape              | Add `quality_gate_failed`; add `qualityGateLog?`                  |
| `apps/api/src/common/git/git-merge.helpers.ts`                                                 | stderr classification + result builders + event mapping | Add `isPrePushHookFailure`, `qualityGateFailedResult`, event name |
| `apps/api/src/common/git/git-merge.helpers.spec.ts`                                            | helper unit tests                                       | **Create**                                                        |
| `apps/api/src/common/git/git-merge.service.ts`                                                 | merge/push orchestration                                | Capture push output; branch on hook failure                       |
| `apps/api/src/common/git/git-merge.service.spec.ts`                                            | service unit tests                                      | Add quality-gate case                                             |
| `apps/api/src/workflow/workflow-special-steps/step-git-operation-special-step.handler.ts`      | git_operation → job output                              | Surface `quality_gate_log`                                        |
| `apps/api/src/workflow/workflow-special-steps/step-git-operation-special-step.handler.spec.ts` | handler unit tests                                      | Add output assertion                                              |
| `apps/api/src/workflow/workflow-repair/failure-classification.types.ts`                        | repair class union                                      | Add `quality_gate_failed`                                         |
| `apps/api/src/workflow/workflow-repair/failure-classification-rules.ts`                        | evidence → class rules                                  | Add quality-gate rule                                             |
| `apps/api/src/workflow/workflow-repair/failure-classification-rules.spec.ts`                   | classifier tests                                        | Add case                                                          |
| `apps/api/src/workflow/workflow-repair/repair-policy.config.ts`                                | per-class policy                                        | Add `quality_gate_failed` entry                                   |
| `seed/workflows/work-item-ready-to-merge-default.workflow.yaml`                                | workflow DAG                                            | Add remediation branch + tail                                     |
| `seed/workflows/prompts/work-item-ready-to-merge/remediate-quality-gate.md`                    | remediation agent prompt                                | **Create**                                                        |
| `docs/guide/` + `apps/api/README.md`                                                           | docs                                                    | Note the new outcome/branch                                       |

---

## Task 1: `isPrePushHookFailure` helper

**Files:**

- Modify: `apps/api/src/common/git/git-merge.helpers.ts`
- Test: `apps/api/src/common/git/git-merge.helpers.spec.ts` (Create)

**Interfaces:**

- Produces: `isPrePushHookFailure(stderr: string): boolean` — true when a push was declined by a **local** pre-push hook (quality gate), false for remote non-fast-forward rejections.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/common/git/git-merge.helpers.spec.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { isPrePushHookFailure } from "./git-merge.helpers";

describe("isPrePushHookFailure", () => {
  it("returns true for a local pre-push hook decline", () => {
    const stderr = [
      "Pre-push: running lint across all workspaces...",
      "npm error Lifecycle script `lint` failed with error:",
      "error: failed to push some refs to 'https://github.com/org/repo'",
    ].join("\n");
    expect(isPrePushHookFailure(stderr)).toBe(true);
  });

  it("returns false for a remote non-fast-forward rejection", () => {
    const stderr = [
      "! [rejected]        main -> main (non-fast-forward)",
      "error: failed to push some refs to 'https://github.com/org/repo'",
      "hint: Updates were rejected because the tip of your current branch is behind",
    ].join("\n");
    expect(isPrePushHookFailure(stderr)).toBe(false);
  });

  it("returns false when there is no push-refs error at all", () => {
    expect(isPrePushHookFailure("fatal: some unrelated git error")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- git-merge.helpers.spec`
Expected: FAIL — `isPrePushHookFailure` is not exported.

- [ ] **Step 3: Implement the helper**

In `apps/api/src/common/git/git-merge.helpers.ts`, add after `isPushRejected` (around line 70):

```typescript
/**
 * A push aborted by a LOCAL pre-push hook (a quality gate such as lint/tests),
 * as opposed to a remote-side rejection (non-fast-forward). Git prints
 * "failed to push some refs" in both cases, so the remote-rejection markers are
 * excluded to isolate the hook decline — which a retry against latest origin
 * cannot fix.
 */
export function isPrePushHookFailure(stderr: string): boolean {
  if (!stderr.includes("failed to push some refs")) {
    return false;
  }
  const remoteRejection =
    stderr.includes("[rejected]") ||
    stderr.includes("non-fast-forward") ||
    stderr.includes("fetch first");
  return !remoteRejection;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- git-merge.helpers.spec`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/git/git-merge.helpers.ts apps/api/src/common/git/git-merge.helpers.spec.ts
git commit -m "feat(git): distinguish pre-push hook failure from remote rejection"
```

---

## Task 2: `quality_gate_failed` merge outcome + captured hook log

**Files:**

- Modify: `apps/api/src/common/git/git-merge.service.types.ts`
- Modify: `apps/api/src/common/git/git-merge.helpers.ts`
- Modify: `apps/api/src/common/git/git-merge.service.ts:292-321,334-355`
- Test: `apps/api/src/common/git/git-merge.service.spec.ts`

**Interfaces:**

- Consumes: `isPrePushHookFailure` (Task 1), `extractMergeError`.
- Produces:
  - `MergeOutcome` now includes `'quality_gate_failed'`.
  - `MergeResult.qualityGateLog?: string` — combined push stdout+stderr.
  - `qualityGateFailedResult(sourceBranch, destinationBranch, qualityGateLog): MergeResult`.

- [ ] **Step 1: Extend the types**

In `apps/api/src/common/git/git-merge.service.types.ts`:

```typescript
export type MergeOutcome =
  | "succeeded"
  | "conflict"
  | "auth_error"
  | "quality_gate_failed"
  | "failed";
```

Add to the `MergeResult` interface (after `mergeCommit?`):

```typescript
  /** Combined stdout+stderr from a push rejected by the pre-push quality gate. */
  qualityGateLog?: string;
```

- [ ] **Step 2: Add the result builder + event mapping**

In `apps/api/src/common/git/git-merge.helpers.ts`, add after `failedResult`:

```typescript
export function qualityGateFailedResult(
  sourceBranch: string,
  destinationBranch: string,
  qualityGateLog: string,
): MergeResult {
  return {
    outcome: "quality_gate_failed",
    sourceBranch,
    destinationBranch,
    conflictedFiles: [],
    message:
      "Push rejected by the pre-push quality gate (lint/tests). " +
      "See qualityGateLog for the full output.",
    qualityGateLog,
  };
}
```

In the same file, update `emitMergeOutcome`'s `eventName` (around line 36):

```typescript
const eventName =
  result.outcome === "succeeded"
    ? "git.merge.succeeded"
    : result.outcome === "conflict"
      ? "git.merge.conflict_detected"
      : result.outcome === "quality_gate_failed"
        ? "git.merge.quality_gate_failed"
        : "git.merge.failed";
```

- [ ] **Step 3: Write the failing service test**

In `apps/api/src/common/git/git-merge.service.spec.ts`, add a test inside the
`describe('GitMergeService', ...)` block (reuse `stubCapture`, `ok`, `CLONE_ROOT`,
`WORKTREE`, `SOURCE`, `BASE`):

```typescript
it("returns quality_gate_failed (no retry) when the push is rejected by the pre-push hook", async () => {
  // Worktree stage is clean (feature already contains base); integration pushes.
  stubCapture((repoPath, args) => {
    if (args[0] === "rev-parse" && args.includes("MERGE_HEAD")) return fail; // not in progress
    if (args[0] === "merge-base") return ok; // base IS an ancestor → worktree ready
    if (args[0] === "rev-parse" && args.includes(`origin/${BASE}`)) return ok;
    if (args[0] === "push") {
      return {
        code: 1,
        stdout:
          "Pre-push: running lint across all workspaces...\neslint found errors",
        stderr: "error: failed to push some refs to 'origin'",
      };
    }
    return ok;
  });
  vi.spyOn(service, "runGit").mockResolvedValue(undefined);

  const result = await service.mergeWithConflictDetection(
    "scope-1",
    SOURCE,
    BASE,
    WORKTREE,
  );

  expect(result.outcome).toBe("quality_gate_failed");
  expect(result.qualityGateLog).toContain("eslint found errors");
  expect(result.qualityGateLog).toContain("failed to push some refs");
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- git-merge.service.spec`
Expected: FAIL — push currently uses `runGit` (not captured) and the outcome is `failed`/retried.

- [ ] **Step 5: Capture the push output in `mergeAndPushBranch`**

In `apps/api/src/common/git/git-merge.service.ts`, replace the push call in
`mergeAndPushBranch` (lines 317-321):

```typescript
const push = await this.runGitCapture(
  repoPath,
  ["push", "--set-upstream", "origin", destinationBranch],
  authEnv,
);
if (push.code !== 0) {
  const combined = [push.stdout, push.stderr]
    .map((stream) => stream.trim())
    .filter((stream) => stream.length > 0)
    .join("\n");
  throw new InternalServerErrorException(combined || "git push failed");
}
```

(`InternalServerErrorException` is already imported. `extractMergeError` reads
`error.stderr ?? error.message`; this exception carries the combined output in
`message`, which both `isPrePushHookFailure` and the log builder consume.)

- [ ] **Step 6: Branch on the hook failure in `handleMergeFailure`**

Update the import block at the top of `git-merge.service.ts` to add
`isPrePushHookFailure` and `qualityGateFailedResult`:

```typescript
import {
  authErrorResult,
  classifyAuthError,
  conflictResult,
  describeNonConflictFailure,
  emitMergeOutcome,
  emitMergeRequested,
  extractMergeError,
  failedResult,
  isMergeConflict,
  isPrePushHookFailure,
  isPushRejected,
  qualityGateFailedResult,
} from "./git-merge.helpers";
```

Replace `handleMergeFailure` (lines 334-355):

```typescript
  private async handleMergeFailure(
    repoPath: string,
    sourceBranch: string,
    destinationBranch: string,
    error: unknown,
    authEnv: GitAuthEnv,
  ): Promise<MergeResult> {
    const stderr = extractMergeError(error);
    if (isPrePushHookFailure(stderr)) {
      // A local pre-push quality gate (lint/tests) declined the push. Retrying
      // against latest origin cannot fix it; surface the log for remediation.
      return qualityGateFailedResult(sourceBranch, destinationBranch, stderr);
    }
    if (isPushRejected(stderr)) {
      return this.retryMergeAgainstLatestOrigin(
        repoPath,
        sourceBranch,
        destinationBranch,
        authEnv,
      );
    }
    return this.classifyIntegrationFailure(
      repoPath,
      sourceBranch,
      destinationBranch,
      error,
    );
  }
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- git-merge.service.spec`
Expected: PASS (new test + existing tests stay green).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/common/git/git-merge.service.types.ts apps/api/src/common/git/git-merge.helpers.ts apps/api/src/common/git/git-merge.service.ts apps/api/src/common/git/git-merge.service.spec.ts
git commit -m "feat(git): classify pre-push quality-gate rejection as quality_gate_failed"
```

---

## Task 3: Surface `quality_gate_log` in the git_operation handler

**Files:**

- Modify: `apps/api/src/workflow/workflow-special-steps/step-git-operation-special-step.handler.ts:288-304`
- Test: `apps/api/src/workflow/workflow-special-steps/step-git-operation-special-step.handler.spec.ts`

**Interfaces:**

- Produces: merge job output gains `quality_gate_log` (from `MergeResult.qualityGateLog`). Workflow templates read `jobs.<id>.output.quality_gate_log` and `...merge_outcome == 'quality_gate_failed'`.

- [ ] **Step 1: Write the failing test**

In `step-git-operation-special-step.handler.spec.ts`, find the existing merge test
(search for `merge_outcome`) and add a sibling test that stubs
`gitMergeService.mergeWithConflictDetection` to resolve:

```typescript
    {
      outcome: 'quality_gate_failed',
      sourceBranch: 'feature/ctx',
      destinationBranch: 'main',
      conflictedFiles: [],
      message: 'Push rejected by the pre-push quality gate (lint/tests).',
      qualityGateLog: 'eslint found errors\nfailed to push some refs',
    }
```

and asserts:

```typescript
expect(result.output).toMatchObject({
  merge_outcome: "quality_gate_failed",
  quality_gate_log: "eslint found errors\nfailed to push some refs",
});
```

(Mirror the arrange/act of the nearest existing merge test in that file — same
`SpecialStepExecutionContext`, repo/worktree stubs, and `handler.execute(...)` call.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- step-git-operation-special-step.handler.spec`
Expected: FAIL — `quality_gate_log` is undefined in the output.

- [ ] **Step 3: Add the field to `handleMerge` output**

In `step-git-operation-special-step.handler.ts`, add to the `output` object in
`handleMerge` (after `conflicted_files: mergeResult.conflictedFiles,`):

```typescript
        quality_gate_log: mergeResult.qualityGateLog,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- step-git-operation-special-step.handler.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-special-steps/step-git-operation-special-step.handler.ts apps/api/src/workflow/workflow-special-steps/step-git-operation-special-step.handler.spec.ts
git commit -m "feat(workflow): surface quality_gate_log on merge git_operation output"
```

---

## Task 4: Failure classifier class + rule + policy (backstop)

**Files:**

- Modify: `apps/api/src/workflow/workflow-repair/failure-classification.types.ts:4-11`
- Modify: `apps/api/src/workflow/workflow-repair/failure-classification-rules.ts:99-120`
- Modify: `apps/api/src/workflow/workflow-repair/repair-policy.config.ts:42-48`
- Test: `apps/api/src/workflow/workflow-repair/failure-classification-rules.spec.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces: `RepairPolicyClass` now includes `'quality_gate_failed'`; classifier returns it for lint/test pre-push evidence; `REPAIR_POLICY_CONFIG.quality_gate_failed` exists (`humanRequired: true`).

- [ ] **Step 1: Write the failing test**

In `failure-classification-rules.spec.ts`, add a row to the `it.each` table (line ~30):

```typescript
    [
      "error: failed to push some refs; npm run lint failed: eslint reported errors",
      'quality_gate_failed',
    ],
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- failure-classification-rules.spec`
Expected: FAIL — classified as `ambiguous_failure`.

- [ ] **Step 3: Add the class to the union**

In `failure-classification.types.ts`, add to `REPAIR_POLICY_CLASSES` (before
`'ambiguous_failure'`):

```typescript
  'quality_gate_failed',
```

- [ ] **Step 4: Add the classifier rule**

In `failure-classification-rules.ts`, insert before the final `ambiguous_failure`
fallback `return` (line ~115):

```typescript
if (
  /(failed to push some refs|pre-?push)[\s\S]*(lint|eslint|test)|(eslint|npm run lint|npm run test)[\s\S]*(fail|error)|pre-push: running lint/i.test(
    searchableText,
  )
) {
  return {
    class: "quality_gate_failed",
    confidence: 0.8,
    reason:
      "Failure evidence indicates a pre-push quality gate (lint/tests) rejected the push.",
  };
}
```

- [ ] **Step 5: Add the repair-policy entry**

In `repair-policy.config.ts`, add before `ambiguous_failure` (line ~42):

```typescript
  quality_gate_failed: {
    minimumConfidence: 0.7,
    allowedRepairActionIds: [],
    humanRequired: true,
    diagnosticLabel: 'Pre-push quality gate failed',
  },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test --workspace=apps/api -- failure-classification-rules.spec failure-classification.types.spec`
Expected: PASS. (`REPAIR_POLICY_CONFIG satisfies RepairPolicyConfig` forces the new key to compile.)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/workflow/workflow-repair/failure-classification.types.ts apps/api/src/workflow/workflow-repair/failure-classification-rules.ts apps/api/src/workflow/workflow-repair/repair-policy.config.ts apps/api/src/workflow/workflow-repair/failure-classification-rules.spec.ts
git commit -m "feat(repair): classify pre-push quality-gate failures as a known class"
```

---

## Task 5: Workflow remediation branch + prompt

**Files:**

- Create: `seed/workflows/prompts/work-item-ready-to-merge/remediate-quality-gate.md`
- Modify: `seed/workflows/work-item-ready-to-merge-default.workflow.yaml`
- Test: seed dry-run spec at `apps/api/src/workflow/testing/seed-workflows.dry-run.spec.ts`

**Interfaces:**

- Consumes: `jobs.attempt_merge.output.merge_outcome == 'quality_gate_failed'` and `jobs.attempt_merge.output.quality_gate_log` (Tasks 2-3).
- Produces: jobs `remediate_quality_gate`, `validate_merge_after_remediation`, `record_merge_metadata_remediated`, `transition_done_remediated`, `emit_merge_completed_remediated`, `cleanup_worktree_remediated`.

- [ ] **Step 1: Create the remediation prompt**

Create `seed/workflows/prompts/work-item-ready-to-merge/remediate-quality-gate.md`:

```markdown
You are the merge quality-gate remediation agent for this work item.

Scope ID: {{trigger.scopeId}}
Context ID: {{trigger.contextId}}

Branch configuration:

- Base branch (destination): {{trigger.resource.executionConfig.baseBranch}}
- Target branch (source): {{trigger.resource.executionConfig.targetBranch}}

The automatic merge succeeded but the push was rejected by the repository's
pre-push quality gate (lint and/or unit tests). Captured failure log:

---

## {{jobs.attempt_merge.output.quality_gate_log}}

Goal:

- Fix the lint and/or test failures shown above in the mounted worktree branch so
  the pre-push quality gate passes.

Required process:

1. Inspect git status in the worktree and stay on the mounted target branch.
2. Reproduce the failing gate for the affected workspaces (for example
   `npm run lint` and the relevant `npm run test:*`).
3. Fix the reported violations with the minimal change. Run an auto-fixer for
   formatting issues and edit code for the rest.
4. Re-run the same checks until they pass.
5. Commit the fixes with a clear message. Run git add -A before committing so ALL
   changes are included. A dirty worktree breaks validation.
6. Call set_job_output with data: { ok: true, response: "<short summary of fixes>" }.
   If the gate cannot be made to pass, call set_job_output with
   { ok: false, response: "<why it could not be fixed>" }.
7. Call step_complete.

Critical restrictions:

- Do not run git fetch, git pull, git push, or git remote commands.
- Do not checkout main or any branch other than the mounted worktree branch.
- The orchestrator handles all remote synchronization and merge validation.
- You must call set_job_output and step_complete exactly once each.
```

- [ ] **Step 2: Add the remediation transition to `attempt_merge`**

In `seed/workflows/work-item-ready-to-merge-default.workflow.yaml`, add a transition
to `attempt_merge.transitions` (after the `conflict` transition, before `auth_error`):

```yaml
- condition: "jobs.attempt_merge.output.merge_outcome == 'quality_gate_failed'"
  next: remediate_quality_gate
```

- [ ] **Step 3: Add the remediation + re-validation jobs**

In the same file, add these jobs (place after `resolve_local_conflicts`, before
`validate_merge`):

```yaml
- id: remediate_quality_gate
  type: execution
  tier: heavy
  depends_on: [attempt_merge]
  max_retries: 1
  inputs:
    agent_profile: architect-agent
  output_contract:
    required: [ok, response]
    types:
      ok: boolean
      response: string
  steps:
    - id: remediate
      type: agent
      prompt_file: prompts/work-item-ready-to-merge/remediate-quality-gate.md
  transitions:
    - condition: "jobs.remediate_quality_gate.output.ok == true"
      next: validate_merge_after_remediation
    - condition: "jobs.remediate_quality_gate.output.ok == false"
      next: emit_merge_failed

- id: validate_merge_after_remediation
  type: git_operation
  tier: light
  depends_on: [remediate_quality_gate]
  inputs:
    action: merge
    repository_id: "{{ trigger.scopeId }}"
    worktree_id: "{{ trigger.contextId }}"
    base_branch: "{{ trigger.resource.executionConfig.baseBranch }}"
    target_branch: "{{ trigger.resource.executionConfig.targetBranch }}"
  transitions:
    - condition: "jobs.validate_merge_after_remediation.output.merge_outcome == 'succeeded'"
      next: record_merge_metadata_remediated
    - condition: "jobs.validate_merge_after_remediation.output.merge_outcome == 'conflict'"
      next: emit_merge_failed
    - condition: "jobs.validate_merge_after_remediation.output.merge_outcome == 'auth_error'"
      next: emit_merge_failed
    - condition: "jobs.validate_merge_after_remediation.output.merge_outcome == 'quality_gate_failed'"
      next: emit_merge_failed
    - condition: "jobs.validate_merge_after_remediation.output.merge_outcome == 'failed'"
      next: emit_merge_failed
```

- [ ] **Step 4: Add the remediated success tail**

In the same file, add after `cleanup_worktree_conflict` (before `emit_merge_failed`):

```yaml
  - id: record_merge_metadata_remediated
    type: mcp_tool_call
    tier: light
    depends_on: [validate_merge_after_remediation]
    inputs:
      server_id: kanban-mcp
      tool_name: kanban.work_item_patch_metadata
      params:
        project_id: "{{ trigger.scopeId }}"
        workItemId: "{{ trigger.contextId }}"
        metadataPatch:
          lifecycle:
            merge:
              status: succeeded
              sourceBranch: "{{ jobs.validate_merge_after_remediation.output.source_branch }}"
              destinationBranch: "{{ jobs.validate_merge_after_remediation.output.destination_branch }}"
              feedback: "{{ jobs.remediate_quality_gate.output.response }}"
              resolvedByAgent: true
      policy: *kanban_mcp_policy

  - id: transition_done_remediated
    type: mcp_tool_call
    tier: light
    depends_on: [record_merge_metadata_remediated]
    inputs:
      server_id: kanban-mcp
      tool_name: kanban.work_item_transition_status
      params:
        project_id: "{{ trigger.scopeId }}"
        workItemId: "{{ trigger.contextId }}"
        status: done
        suppressAutomation: true
      policy: *kanban_mcp_policy

  - id: emit_merge_completed_remediated
    type: emit_event
    tier: light
    depends_on: [transition_done_remediated]
    inputs:
      event_name: WorkItemMergeCompletedEvent
      payload:
        scopeId: "{{ trigger.scopeId }}"
        contextId: "{{ trigger.contextId }}"
        baseBranch: "{{ trigger.resource.executionConfig.baseBranch }}"
        targetBranch: "{{ trigger.resource.executionConfig.targetBranch }}"
        baseMergeCommit: "{{ jobs.validate_merge_after_remediation.output.baseMergeCommit }}"
        mergeCommit: "{{ jobs.validate_merge_after_remediation.output.mergeCommit }}"

  - id: cleanup_worktree_remediated
    type: git_operation
    tier: light
    depends_on: [emit_merge_completed_remediated]
    inputs:
      action: remove_worktree
      repository_id: "{{ trigger.scopeId }}"
      worktree_id: "{{ trigger.contextId }}"
      target_branch: "{{ trigger.resource.executionConfig.targetBranch }}"
```

- [ ] **Step 5: Run the seed dry-run to verify the YAML + prompt parse**

Run: `npm run test --workspace=apps/api -- seed-workflows.dry-run.spec`
Expected: PASS — the workflow parses, `prompt_file` resolves, and all `transitions[].next` targets exist. If the spec enumerates workflows, confirm `work_item_ready_to_merge_default` is included and green.

- [ ] **Step 6: Commit**

```bash
git add seed/workflows/work-item-ready-to-merge-default.workflow.yaml seed/workflows/prompts/work-item-ready-to-merge/remediate-quality-gate.md
git commit -m "feat(workflow): add bounded quality-gate remediation branch to auto-merge"
```

---

## Task 6: Documentation + full verification

**Files:**

- Modify: `docs/guide/` merge/auto-merge section (search for "ready-to-merge" / "auto-merge")
- Modify: `apps/api/README.md` (git_operation merge outcomes, if listed there)
- Modify: `docs/plans/2026-06-20-merge-quality-gate-remediation-design.md` (status → Implemented)

- [ ] **Step 1: Update the design doc status**

In `docs/plans/2026-06-20-merge-quality-gate-remediation-design.md`, change
`**Status**: Draft` → `**Status**: Implemented (2026-06-20)` and the "Open Questions"
section to record the resolved decisions (eligibility=inline+human_required backstop,
retry=1, checkout=reuse worktree, capture=on-failure, scope=attempt_merge only).

- [ ] **Step 2: Document the new outcome + branch in the guide**

Locate the merge-workflow description in `docs/guide/` (grep for `merge_outcome` or
"ready-to-merge") and add a short subsection documenting:

- the `quality_gate_failed` outcome (push rejected by the repo's pre-push hook),
- the `remediate_quality_gate` → `validate_merge_after_remediation` branch (one bounded pass),
- that it reuses the per-run worktree like conflict resolution.

If `apps/api/README.md` lists git_operation merge outcomes, add `quality_gate_failed` there.

- [ ] **Step 3: Run the full API test suite**

Run: `npm run test --workspace=apps/api`
Expected: PASS (all suites). Investigate and fix any regression before proceeding.

- [ ] **Step 4: Lint the touched workspace**

Run: `npm run lint:api`
Expected: clean — no new warnings or errors.

- [ ] **Step 5: Commit**

```bash
git add docs/guide apps/api/README.md docs/plans/2026-06-20-merge-quality-gate-remediation-design.md
git commit -m "docs: document pre-push quality-gate remediation branch"
```

---

## Post-Implementation (manual / deploy — not part of TDD tasks)

- Rebuild the API image and reseed so the workflow change is live:
  `docker compose up -d --build` then trigger the seed lifecycle (per `seed-workflow-patterns` skill).
- **Caveat:** confirm there is a single seeded row for `work_item_ready_to_merge_default` before reseed (duplicate seeded rows have bitten prior reseeds).
- Live re-verify by driving a work item to `ready-to-merge` whose merge result trips the pre-push gate, and confirm the run takes the `remediate_quality_gate` branch and completes.

## Self-Review Notes

- **Spec coverage:** Design Fix 1 → Tasks 1-2; Fix 2 → Task 5; Fix 3 → Task 4; Fix 4 → resolved by decision #3 (reuse worktree; no code). Hook-output capture → Task 2 Step 5. Observability event → Task 2 Step 2.
- **Type consistency:** `quality_gate_failed` used identically in `MergeOutcome`, `RepairPolicyClass`, YAML conditions, and prompt template. `qualityGateLog` (camel, MergeResult) ↔ `quality_gate_log` (snake, job output) mapping is intentional and made explicit in Task 3.
- **No placeholders:** every code/YAML/prompt step shows the full content.
