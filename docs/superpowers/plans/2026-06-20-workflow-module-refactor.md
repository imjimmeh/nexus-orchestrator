# WorkflowModule Comprehensive Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `@Global()` from `WorkflowModule`, break its one in-module circular dependency, split the H-4/H-5 complexity hotspots, finish the remaining workflow dedup, and close the two workflow reliability gaps — without changing behavior except the explicitly-scoped Phase 2 reliability fixes.

**Architecture:** Workflow consumers already inject through kernel port tokens (`apps/api/src/workflow/kernel/interfaces/workflow-kernel.ports.ts`). This plan finishes that migration (token-only injection), makes the three external consumers import `WorkflowModule` explicitly, and only then drops `@Global()`. Hotspot classes are decomposed behind small interfaces; duplicated helpers are consolidated to a single source.

**Tech Stack:** NestJS 10, TypeORM, BullMQ, Vitest + SWC, TypeScript (strict in `packages/core`).

**Spec:** [docs/superpowers/specs/2026-06-20-workflow-module-refactor-design.md](../specs/2026-06-20-workflow-module-refactor-design.md)

## Global Constraints

- Core/Kanban boundary: `apps/api/src` and `packages/core` stay Kanban-neutral — no `kanban`/work-item/project-domain identifiers (enforced by `nexus-boundaries/no-core-kanban-residue`).
- No lint suppressions: never add `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, or rule downgrades. Fix findings in code.
- Build order: `npm run build --workspace=packages/core` before API typecheck when core changes.
- NestJS apps build with `nest build`, not `tsc`.
- Targeted tests: `npm run test --workspace=apps/api -- <path>` (Vitest). Run single specs while iterating, full `npm run test:api` before declaring a phase done.
- Lint: `npm run lint:api` (or `npm run lint:summary` for repo-wide visibility).
- Each task ends with a commit. Co-author trailer on every commit:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Branch: `refactor/workflow-module-decomposition` (already created).

---

## File / Structure Map

| Path                                                                                                     | Responsibility                                  | Touched by |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------- |
| `apps/api/src/workflow/workflow-runtime/workflow-runtime-await-actions.service.ts`                       | Durable agent-await actions                     | Task 1     |
| `apps/api/src/workflow/workflow-subagents/subagent-orphan-reconciler.service.ts`                         | Orphan subagent reconciliation                  | Task 1     |
| `apps/web/src/pages/workflows/workflow-run-detail.helpers.ts`                                            | Web run-detail helpers                          | Task 1     |
| `apps/api/src/common/utils/async.utils.ts`                                                               | Shared async/backoff helpers                    | Task 2     |
| `apps/api/src/common/utils/async.utils.types.ts`                                                         | Backoff config types                            | Task 2     |
| `apps/api/src/workflow/workflow-run-auto-retry.helpers.ts`                                               | Run-level auto-retry delay                      | Task 2     |
| `apps/api/src/workflow/workflow-step-execution/step-agent-in-session-transient-retry.helpers.ts`         | In-session transient retry delay                | Task 2     |
| `apps/api/src/workflow/workflow-special-steps/git-actions/*`                                             | Per-action git strategies (new)                 | Task 3     |
| `apps/api/src/workflow/workflow-special-steps/step-git-operation-special-step.handler.ts`                | Git-op dispatcher                               | Task 3     |
| `apps/api/src/workflow/workflow-runtime/invocation-inputs.resolver.ts`                                   | Pure invocation-input mapping (new)             | Task 4     |
| `apps/api/src/workflow/workflow-runtime/workflow-runtime-orchestration-actions.service.ts`               | Orchestration actions                           | Task 4     |
| `apps/api/src/workflow/database/entities/workflow-event-dedupe.entity.ts` (new) + migration + repository | Persistent event dedupe                         | Task 5     |
| `apps/api/src/workflow/workflow-event-trigger.service.ts`                                                | Event-trigger registration + dedupe + bootstrap | Tasks 5, 6 |
| `apps/api/src/workflow/workflow-run-display.helpers.ts` (new)                                            | Run display-name presentation                   | Task 7     |
| `apps/api/src/workflow/workflow-persistence.service.ts`                                                  | Persistence tier                                | Task 7     |
| `apps/api/src/workflow/workflow-runtime/workflow-runtime-capability-executor.service.ts`                 | Capability execution                            | Task 8     |
| `apps/api/src/workflow/kernel/interfaces/workflow-kernel.ports.ts`                                       | Kernel port interfaces/tokens                   | Task 8     |
| `apps/api/src/memory/learning/record-learning.service.ts`                                                | Learning record tool                            | Task 9     |
| `apps/api/src/automation/automation.module.ts`                                                           | Automation module                               | Task 10    |
| `apps/api/src/memory/learning/learning.module.ts`                                                        | Learning module                                 | Task 10    |
| `apps/api/src/notifications/notifications.module.ts`                                                     | Notifications module                            | Task 10    |
| `apps/api/src/workflow/workflow.module.ts`                                                               | Workflow module wiring                          | Task 11    |
| `apps/api/src/workflow/kernel/workflow-kernel.spec.ts`                                                   | Kernel boundary tests                           | Task 11    |

---

# PHASE 0 — Dedup leftovers (low risk, no DI changes)

## Task 1: Consolidate `isTerminalWorkflowRunStatus`

Replace the 3 divergent terminal-status checks with the canonical `@nexus/core` export.

**Files:**

- Modify: `apps/api/src/workflow/workflow-runtime/workflow-runtime-await-actions.service.ts:47,208-215`
- Modify: `apps/api/src/workflow/workflow-subagents/subagent-orphan-reconciler.service.ts:10-12,51-52`
- Modify: `apps/web/src/pages/workflows/workflow-run-detail.helpers.ts:211`
- Test (existing safety nets): `workflow-runtime-await-actions.service.spec.ts`, `subagent-orphan-reconciler.service.spec.ts`

**Interfaces:**

- Consumes: `isTerminalWorkflowRunStatus(status: unknown): boolean` from `@nexus/core` (already exported; uppercase `COMPLETED|FAILED|CANCELLED`, returns false for non-strings).
- Produces: nothing new.

The canonical fn matches **uppercase** statuses. The await-actions copy uses **lowercase** with case-insensitive compare, so callers must keep normalizing case before delegating.

- [ ] **Step 1: Add a failing test for the await-actions case-insensitive contract**

In `apps/api/src/workflow/workflow-runtime/workflow-runtime-await-actions.service.spec.ts`, add (or confirm) a test that attaching to a run whose status is mixed-case `"Completed"` is rejected:

```typescript
it("rejects await attach when target run status is terminal regardless of case", async () => {
  jest // vi
    .spyOn(workflowPersistence, "getWorkflowRun")
    .mockResolvedValue({ id: runId, status: "Completed" } as never);

  await expect(
    service.attachToRuns({
      attachRunIds: [runId],
      parentScopeId: undefined,
    } as never),
  ).rejects.toThrow(/already completed/i);
});
```

(Match the spec's existing harness/mock style — use `vi` and the existing setup helpers.)

- [ ] **Step 2: Run it — confirm current behavior is green (characterization)**

Run: `npm run test --workspace=apps/api -- workflow-runtime-await-actions.service.spec`
Expected: PASS (this captures the behavior we must preserve).

- [ ] **Step 3: Swap the await-actions implementation to the canonical fn**

In `workflow-runtime-await-actions.service.ts`, delete the local set (line 47) and import the canonical fn:

```typescript
import {
  isTerminalWorkflowRunStatus,
  normalizeOptionalString,
} from "@nexus/core";
```

Replace the check (lines ~208-215). The canonical fn expects uppercase, so upper-case the normalized status:

```typescript
const status = normalizeOptionalString((run as { status?: unknown }).status);
if (status && isTerminalWorkflowRunStatus(status.toUpperCase())) {
  throw new BadRequestException(
    `await_agent_workflow cannot attach to run "${runId}": it is already ${status.toLowerCase()}.`,
  );
}
```

Keep the `TERMINAL_RUN_STATUSES` doc-comment removed along with the constant.

- [ ] **Step 4: Run await-actions spec — confirm still green**

Run: `npm run test --workspace=apps/api -- workflow-runtime-await-actions.service.spec`
Expected: PASS.

- [ ] **Step 5: Swap the orphan-reconciler implementation**

In `subagent-orphan-reconciler.service.ts`, delete `TERMINAL_RUN_STATUSES` (line 10) and `TerminalRunStatus` (line 12); import the canonical fn:

```typescript
import { isTerminalWorkflowRunStatus } from "@nexus/core";
```

Replace the membership check (line ~51-52):

```typescript
const runFinished = !run || isTerminalWorkflowRunStatus(run.status);
```

- [ ] **Step 6: Run reconciler spec — confirm green**

Run: `npm run test --workspace=apps/api -- subagent-orphan-reconciler.service.spec`
Expected: PASS.

- [ ] **Step 7: Swap the web inline copy**

In `apps/web/src/pages/workflows/workflow-run-detail.helpers.ts`, delete the local `isTerminalWorkflowRunStatus` (line 211) and import from `@nexus/core`. Update its imports accordingly. The web copy takes `WorkflowRunStatus | undefined`; the canonical `unknown` signature accepts it.

Run: `npm run test:unit:web -- workflow-run-detail`
Expected: PASS.

- [ ] **Step 8: Typecheck + lint + commit**

```bash
npm run build --workspace=packages/core
npm run lint:api
git add apps/api/src/workflow/workflow-runtime/workflow-runtime-await-actions.service.ts \
        apps/api/src/workflow/workflow-subagents/subagent-orphan-reconciler.service.ts \
        apps/web/src/pages/workflows/workflow-run-detail.helpers.ts
git commit -m "refactor(workflow): consolidate isTerminalWorkflowRunStatus to @nexus/core"
```

---

## Task 2: Consolidate the two workflow backoff helpers

`calculateRetryDelayMs` (`workflow-run-auto-retry.helpers.ts:488`) and `calculateInSessionRetryDelayMs` (`step-agent-in-session-transient-retry.helpers.ts:67`) implement the **identical** algorithm (configurable multiplier, `exponent = max(attempt-1, 0)`, symmetric `±(base*ratio)` jitter). This differs from the core `computeExponentialBackoffMs` (hardcoded base-2, one-sided jitter) — **do not** route them onto that one; consolidate the two into a new shared helper with the richer config.

**Files:**

- Modify: `apps/api/src/common/utils/async.utils.ts`
- Modify: `apps/api/src/common/utils/async.utils.types.ts`
- Test (new): `apps/api/src/common/utils/async.utils.spec.ts`
- Modify: `apps/api/src/workflow/workflow-run-auto-retry.helpers.ts:488-507`
- Modify: `apps/api/src/workflow/workflow-step-execution/step-agent-in-session-transient-retry.helpers.ts:67-95`

**Interfaces:**

- Produces: `computeMultiplierBackoffMs(attempt: number, config: MultiplierBackoffConfig): number` and `interface MultiplierBackoffConfig { initialDelayMs: number; maxDelayMs: number; backoffMultiplier: number; jitterRatio: number; }`. With `jitterRatio <= 0` the result is deterministic; otherwise a symmetric jitter window is applied. `attempt` is 1-based (attempt 1 → exponent 0).

- [ ] **Step 1: Write the failing test for the shared helper**

Create `apps/api/src/common/utils/async.utils.spec.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { computeMultiplierBackoffMs } from "./async.utils";

const config = {
  initialDelayMs: 5000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
  jitterRatio: 0,
};

describe("computeMultiplierBackoffMs", () => {
  it("uses attempt-1 as the exponent (attempt 1 = base delay)", () => {
    expect(computeMultiplierBackoffMs(1, config)).toBe(5000);
    expect(computeMultiplierBackoffMs(2, config)).toBe(10000);
    expect(computeMultiplierBackoffMs(3, config)).toBe(20000);
  });

  it("clamps to maxDelayMs", () => {
    expect(computeMultiplierBackoffMs(10, config)).toBe(60000);
  });

  it("treats attempt <= 1 as exponent 0", () => {
    expect(computeMultiplierBackoffMs(0, config)).toBe(5000);
  });

  it("stays within the symmetric jitter window", () => {
    const jittered = { ...config, jitterRatio: 0.2 };
    for (let i = 0; i < 50; i++) {
      const value = computeMultiplierBackoffMs(2, jittered);
      expect(value).toBeGreaterThanOrEqual(8000); // 10000 - 20%
      expect(value).toBeLessThanOrEqual(12000); // 10000 + 20%
    }
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npm run test --workspace=apps/api -- async.utils.spec`
Expected: FAIL with "computeMultiplierBackoffMs is not a function".

- [ ] **Step 3: Implement the shared helper**

In `async.utils.types.ts` add:

```typescript
export interface MultiplierBackoffConfig {
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterRatio: number;
}
```

In `async.utils.ts` add (and re-export the type):

```typescript
export type { MultiplierBackoffConfig } from "./async.utils.types";

export function computeMultiplierBackoffMs(
  attempt: number,
  config: MultiplierBackoffConfig,
): number {
  const exponent = Math.max(attempt - 1, 0);
  const baseDelay = Math.min(
    Math.round(
      config.initialDelayMs * Math.pow(config.backoffMultiplier, exponent),
    ),
    config.maxDelayMs,
  );
  if (config.jitterRatio <= 0) {
    return baseDelay;
  }
  const jitterWindow = Math.round(baseDelay * config.jitterRatio);
  const jitterOffset = Math.round((Math.random() * 2 - 1) * jitterWindow);
  return Math.max(0, baseDelay + jitterOffset);
}
```

- [ ] **Step 4: Run it — verify pass**

Run: `npm run test --workspace=apps/api -- async.utils.spec`
Expected: PASS.

- [ ] **Step 5: Delegate `calculateRetryDelayMs`**

In `workflow-run-auto-retry.helpers.ts`, import the shared helper and replace the body of `calculateRetryDelayMs` (lines 492-506) with:

```typescript
import { computeMultiplierBackoffMs } from "../common/utils/async.utils";

function calculateRetryDelayMs(
  config: Awaited<ReturnType<typeof getAutoRetryConfig>>,
  attempt: number,
): number {
  return computeMultiplierBackoffMs(attempt, {
    initialDelayMs: config.initialDelayMs,
    maxDelayMs: config.maxDelayMs,
    backoffMultiplier: config.backoffMultiplier,
    jitterRatio: config.jitterRatio,
  });
}
```

- [ ] **Step 6: Delegate `calculateInSessionRetryDelayMs`**

In `step-agent-in-session-transient-retry.helpers.ts`, keep the `overrideDelayMs` short-circuit (lines 72-77), then replace the computation (lines 79-94):

```typescript
import {
  computeMultiplierBackoffMs,
  sleep,
} from "../../common/utils/async.utils";

// inside calculateInSessionRetryDelayMs, after the overrideDelayMs guard:
return computeMultiplierBackoffMs(params.attempt, {
  initialDelayMs: params.config.initialDelayMs,
  maxDelayMs: params.config.maxDelayMs,
  backoffMultiplier: params.config.backoffMultiplier,
  jitterRatio: params.config.jitterRatio,
});
```

- [ ] **Step 7: Run the affected workflow specs**

Run: `npm run test --workspace=apps/api -- workflow-run-auto-retry step-agent-in-session-transient-retry`
Expected: PASS (existing specs unchanged; behavior identical).

- [ ] **Step 8: Typecheck + lint + commit**

```bash
npm run lint:api
git add apps/api/src/common/utils/async.utils.ts apps/api/src/common/utils/async.utils.types.ts \
        apps/api/src/common/utils/async.utils.spec.ts \
        apps/api/src/workflow/workflow-run-auto-retry.helpers.ts \
        apps/api/src/workflow/workflow-step-execution/step-agent-in-session-transient-retry.helpers.ts
git commit -m "refactor(workflow): unify multiplier+jitter backoff into shared helper"
```

---

# PHASE 1 — Complexity hotspots

## Task 3: Split `StepGitOperationSpecialStepHandler` into per-action strategies

The 548-line handler's `execute()` switch dispatches to 5 private methods. Extract each into a `GitActionStrategy` keyed by action; the handler becomes a dispatcher. The existing 482-line spec (`step-git-operation-special-step.handler.spec.ts`) is the regression net and stays green.

**Files:**

- Create: `apps/api/src/workflow/workflow-special-steps/git-actions/git-action-strategy.ts` (interface)
- Create: `apps/api/src/workflow/workflow-special-steps/git-actions/merge-git-action.strategy.ts`
- Create: `.../git-actions/provision-worktree-git-action.strategy.ts`
- Create: `.../git-actions/remove-worktree-git-action.strategy.ts`
- Create: `.../git-actions/create-branch-git-action.strategy.ts`
- Create: `.../git-actions/commit-paths-git-action.strategy.ts`
- Modify: `apps/api/src/workflow/workflow-special-steps/step-git-operation-special-step.handler.ts`
- Test (existing): `step-git-operation-special-step.handler.spec.ts`
- Test (new): one focused spec per strategy under `git-actions/`

**Interfaces:**

- Produces:

```typescript
export interface GitActionStrategy {
  readonly action: GitOperationAction;
  execute(params: GitActionParams): Promise<SpecialStepHandlerResult>;
}

export interface GitActionParams {
  workflowRunId: string;
  stepId: string;
  triggerContext: TriggerContext;
  resolvedStepInputs: Record<string, unknown>;
}
```

- Consumes: existing `GitMergeService`, `GitWorktreeService`, `GitCommitPathsService`, `WorkflowRunRepository`, and the helpers in `step-git-operation-special-step.helpers.ts`.

- [ ] **Step 1: Confirm the safety net is green before changing anything**

Run: `npm run test --workspace=apps/api -- step-git-operation-special-step.handler.spec`
Expected: PASS. (If not, stop — fix before refactoring.)

- [ ] **Step 2: Define the strategy interface**

Create `git-actions/git-action-strategy.ts` with the `GitActionStrategy` and `GitActionParams` shapes above, importing `GitOperationAction`/`TriggerContext` from `../step-git-operation-special-step.types` and `SpecialStepHandlerResult` from `../step-special-step.types`.

- [ ] **Step 3: Write a failing test for the first strategy (create_branch — simplest)**

Create `git-actions/create-branch-git-action.strategy.spec.ts` that constructs `CreateBranchGitActionStrategy` with mocked services and asserts the same output the handler spec asserts for `create_branch` (copy the relevant expectations from the handler spec).

Run: `npm run test --workspace=apps/api -- create-branch-git-action.strategy.spec`
Expected: FAIL (class does not exist).

- [ ] **Step 4: Extract `CreateBranchGitActionStrategy`**

Create `create-branch-git-action.strategy.ts`. Move the body of the handler's `handleCreateBranch` verbatim into `execute(params)`, taking its dependencies via the constructor. `action = 'create_branch'`.

Run: `npm run test --workspace=apps/api -- create-branch-git-action.strategy.spec`
Expected: PASS.

- [ ] **Step 5: Repeat extraction for the remaining four actions**

Create one strategy class per action, moving the corresponding handler method body verbatim. Each gets a focused spec mirroring the handler spec's expectations for that action:

- `MergeGitActionStrategy` (`action = 'merge'`) ← `handleMerge`
- `ProvisionWorktreeGitActionStrategy` (`action = 'provision_worktree'`) ← `handleProvisionWorktree` (preserve the `WORKSPACE_WORKTREE_PATH_STATE_KEY` write)
- `RemoveWorktreeGitActionStrategy` (`action = 'remove_worktree'`) ← `handleRemoveWorktree`
- `CommitPathsGitActionStrategy` (`action = 'commit_paths'`) ← `handleCommitPaths`

Run each new spec after writing it; all must PASS before continuing.

- [ ] **Step 6: Convert the handler into a dispatcher**

In `step-git-operation-special-step.handler.ts`, inject the 5 strategies, build a `Map<GitOperationAction, GitActionStrategy>` in the constructor, and replace the `switch` in `execute()`:

```typescript
async execute(context: SpecialStepExecutionContext): Promise<SpecialStepHandlerResult> {
  const { workflowRunId, stepId, resolvedStepInputs } = context;
  const action = this.resolveAction(stepId, resolvedStepInputs);
  const triggerContext = await this.extractTriggerContext(
    workflowRunId, stepId, resolvedStepInputs,
  );
  const strategy = this.strategies.get(action);
  if (!strategy) {
    throw new Error(`Unsupported git_operation action "${action}"`);
  }
  return strategy.execute({ workflowRunId, stepId, triggerContext, resolvedStepInputs });
}
```

Delete the five moved private methods. Keep `resolveAction`, `extractTriggerContext`, and the descriptor. Register the 5 strategies as providers in `WorkflowSpecialStepsModule`.

- [ ] **Step 7: Run the full handler spec — confirm green**

Run: `npm run test --workspace=apps/api -- step-git-operation-special-step.handler.spec`
Expected: PASS (behavior unchanged).

- [ ] **Step 8: Typecheck + lint + commit**

```bash
npm run lint:api
git add apps/api/src/workflow/workflow-special-steps/
git commit -m "refactor(workflow): extract git_operation actions into strategy classes"
```

---

## Task 4: Extract `InvocationInputsResolver` from orchestration actions

`resolveInvocationInputs` (lines 67-97) is flat mapping. Extract it into a pure, separately-tested resolver. The 1111-line service spec stays green.

**Files:**

- Create: `apps/api/src/workflow/workflow-runtime/invocation-inputs.resolver.ts`
- Test (new): `apps/api/src/workflow/workflow-runtime/invocation-inputs.resolver.spec.ts`
- Modify: `apps/api/src/workflow/workflow-runtime/workflow-runtime-orchestration-actions.service.ts:67-97`

**Interfaces:**

- Produces: `resolveInvocationInputs(params: InvokeAgentWorkflowParams): InvocationInputs` as a free function (pure). `InvocationInputs` and `InvokeAgentWorkflowParams` keep their current types.
- Consumes: `normalizeOptionalString` from `@nexus/core`, `normalizeRecord` from `./workflow-runtime-orchestration-actions.helpers`, and `DEFAULT_AGENT_INVOCATION_WORKFLOW_ID`.

- [ ] **Step 1: Write the failing resolver spec**

Create `invocation-inputs.resolver.spec.ts` capturing the current precedence rules:

```typescript
import { describe, expect, it } from "vitest";
import { resolveInvocationInputs } from "./invocation-inputs.resolver";

describe("resolveInvocationInputs", () => {
  it("defaults workflowId when absent", () => {
    expect(resolveInvocationInputs({}).workflowId).toBe(
      "orchestration_invoke_agent_default",
    );
  });

  it("falls back reasoning -> reason", () => {
    expect(resolveInvocationInputs({ reason: "r" }).reasoning).toBe("r");
  });

  it("prefers params.task_prompt over trigger_data.task_prompt", () => {
    const out = resolveInvocationInputs({
      task_prompt: "a",
      trigger_data: { task_prompt: "b" },
    });
    expect(out.taskPrompt).toBe("a");
  });

  it("prefers trigger_data.message and trigger_data.objective over params", () => {
    const out = resolveInvocationInputs({
      message: "pm",
      objective: "po",
      trigger_data: { message: "tm", objective: "to" },
    });
    expect(out.message).toBe("tm");
    expect(out.objective).toBe("to");
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npm run test --workspace=apps/api -- invocation-inputs.resolver.spec`
Expected: FAIL (module not found).

- [ ] **Step 3: Move the logic into the resolver**

Create `invocation-inputs.resolver.ts` exporting `resolveInvocationInputs` — move the body of the current private method verbatim, including the `DEFAULT_AGENT_INVOCATION_WORKFLOW_ID` constant.

- [ ] **Step 4: Run resolver spec — verify pass**

Run: `npm run test --workspace=apps/api -- invocation-inputs.resolver.spec`
Expected: PASS.

- [ ] **Step 5: Delegate from the service**

In `workflow-runtime-orchestration-actions.service.ts`, import `resolveInvocationInputs` from the new file, delete the private method and the now-unused local `DEFAULT_AGENT_INVOCATION_WORKFLOW_ID`, and call the free function:

```typescript
import { resolveInvocationInputs } from "./invocation-inputs.resolver";
// ...
const inputs = resolveInvocationInputs(params);
```

- [ ] **Step 6: Run the service spec — confirm green**

Run: `npm run test --workspace=apps/api -- workflow-runtime-orchestration-actions.service.spec`
Expected: PASS.

- [ ] **Step 7: Lint + commit**

```bash
npm run lint:api
git add apps/api/src/workflow/workflow-runtime/invocation-inputs.resolver.ts \
        apps/api/src/workflow/workflow-runtime/invocation-inputs.resolver.spec.ts \
        apps/api/src/workflow/workflow-runtime/workflow-runtime-orchestration-actions.service.ts
git commit -m "refactor(workflow): extract pure InvocationInputsResolver"
```

---

# PHASE 2 — Reliability fixes (behavior changes → failing test first)

## Task 5: Persistent event-trigger dedupe (own commit + migration)

Replace the in-memory `handledEventKeys` Map (with its 5-min TTL / 1000-key cap) with a DB-backed dedupe store so triggers don't fire twice across a restart. Follow the `adding-entity-migration` skill.

**Files:**

- Create: `apps/api/src/workflow/database/entities/workflow-event-dedupe.entity.ts`
- Create: `apps/api/src/workflow/database/repositories/workflow-event-dedupe.repository.ts`
- Create: migration under `apps/api/src/database/migrations/` (timestamped)
- Modify: `apps/api/src/database/database.module.ts` (register entity + repository)
- Modify: `apps/api/src/workflow/workflow-event-trigger.service.ts`
- Test (new/extend): `apps/api/src/workflow/workflow-event-trigger.service.spec.ts`

**Interfaces:**

- Produces: `WorkflowEventDedupeRepository.claim(key: string, now: Date): Promise<boolean>` — returns `true` if the key was newly inserted (caller should process), `false` if it already existed within the retention window (caller should skip). `purgeExpired(before: Date): Promise<void>`.
- Entity columns: `dedupe_key` (varchar, unique index), `created_at` (timestamp, indexed).

- [ ] **Step 1: Write the failing dedupe test**

In `workflow-event-trigger.service.spec.ts`, add a test that a duplicate event key is only processed once even across simulated "restart" (the in-memory map is gone but the repo persists):

```typescript
it("processes a given event key only once via the persistent store", async () => {
  dedupeRepo.claim.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

  await service.handleWorkflowEventTrigger(binding, event);
  await service.handleWorkflowEventTrigger(binding, event);

  expect(workflowEngine.startWorkflow).toHaveBeenCalledTimes(1);
});
```

(Add `dedupeRepo` to the test module providers as a mock.)

- [ ] **Step 2: Run it — verify it fails**

Run: `npm run test --workspace=apps/api -- workflow-event-trigger.service.spec`
Expected: FAIL (service still uses the in-memory map / no `dedupeRepo` injected).

- [ ] **Step 3: Create the entity**

Create `workflow-event-dedupe.entity.ts`:

```typescript
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from "typeorm";

@Entity({ name: "workflow_event_dedupe" })
export class WorkflowEventDedupe {
  @PrimaryColumn({ type: "varchar", length: 512 })
  @Index({ unique: true })
  dedupe_key: string;

  @CreateDateColumn()
  @Index()
  created_at: Date;
}
```

- [ ] **Step 4: Create the repository with `claim` + `purgeExpired`**

Create `workflow-event-dedupe.repository.ts`. `claim` does an insert-or-ignore (`ON CONFLICT DO NOTHING`) and returns whether a row was inserted:

```typescript
async claim(key: string, now: Date): Promise<boolean> {
  const result = await this.repo
    .createQueryBuilder()
    .insert()
    .values({ dedupe_key: key, created_at: now })
    .orIgnore()
    .execute();
  return (result.identifiers?.length ?? 0) > 0;
}

async purgeExpired(before: Date): Promise<void> {
  await this.repo.createQueryBuilder()
    .delete()
    .where('created_at < :before', { before })
    .execute();
}
```

- [ ] **Step 5: Generate + author the migration**

Create the table with the unique index on `dedupe_key` and an index on `created_at`. Follow the `adding-entity-migration` skill for the up/down SQL and naming. Register `WorkflowEventDedupe` + repository in `database.module.ts`.

- [ ] **Step 6: Wire the service to the repo**

In `workflow-event-trigger.service.ts`: remove `handledEventKeys`, `EVENT_DEDUPE_TTL_MS`, `MAX_EVENT_DEDUPE_KEYS`, and the in-memory dedupe code. Inject `WorkflowEventDedupeRepository`. In `handleWorkflowEventTrigger`, compute the dedupe key as before and gate on `await this.dedupeRepo.claim(key, new Date())` (skip when `false`). Keep retention purge opportunistic (e.g. purge keys older than the prior 5-min window on init or on a low-frequency cadence).

- [ ] **Step 7: Run the spec — verify pass**

Run: `npm run test --workspace=apps/api -- workflow-event-trigger.service.spec`
Expected: PASS.

- [ ] **Step 8: Build + lint + commit (own commit, includes migration)**

```bash
npm run build:api
npm run lint:api
git add apps/api/src/workflow/database/entities/workflow-event-dedupe.entity.ts \
        apps/api/src/workflow/database/repositories/workflow-event-dedupe.repository.ts \
        apps/api/src/database/migrations/ apps/api/src/database/database.module.ts \
        apps/api/src/workflow/workflow-event-trigger.service.ts \
        apps/api/src/workflow/workflow-event-trigger.service.spec.ts
git commit -m "feat(workflow): persist event-trigger dedupe across restarts"
```

---

## Task 6: Make event-trigger bootstrap errors visible

Bootstrap registration failures are swallowed (`onModuleInit` catch at lines 82-89). Surface them: respect `WORKFLOW_FAIL_ON_BOOTSTRAP_VALIDATION_ERROR` (throw), and otherwise record a durable, observable signal rather than only a log line.

**Files:**

- Modify: `apps/api/src/workflow/workflow-event-trigger.service.ts:51-90`
- Test (extend): `apps/api/src/workflow/workflow-event-trigger.service.spec.ts`

**Interfaces:**

- Consumes: existing `Logger`; emit a structured warning state via the existing observability path used elsewhere in the service (reuse whatever event/metric the module already emits — do not introduce a new dependency if one exists).

- [ ] **Step 1: Write the failing test**

```typescript
it("rethrows bootstrap registration errors when the fail flag is set", async () => {
  process.env.WORKFLOW_FAIL_ON_BOOTSTRAP_VALIDATION_ERROR = "true";
  workflowRepo.findAll.mockRejectedValue(new Error("db down"));
  await expect(service.onModuleInit()).rejects.toThrow(/db down/);
  delete process.env.WORKFLOW_FAIL_ON_BOOTSTRAP_VALIDATION_ERROR;
});

it("records a visible degraded signal (not silent) when not failing hard", async () => {
  workflowRepo.findAll.mockRejectedValue(new Error("db down"));
  const errorSpy = vi.spyOn(service["logger"], "error");
  await service.onModuleInit();
  expect(errorSpy).toHaveBeenCalledWith(
    expect.stringContaining("event trigger bootstrap failed"),
    expect.anything(),
  );
  expect(service.isBootstrapDegraded()).toBe(true);
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npm run test --workspace=apps/api -- workflow-event-trigger.service.spec`
Expected: FAIL (no `isBootstrapDegraded`, current catch doesn't honor the flag for the `findAll` throw path).

- [ ] **Step 3: Implement visible bootstrap failure handling**

In `onModuleInit`, move the `WORKFLOW_FAIL_ON_BOOTSTRAP_VALIDATION_ERROR` check to also cover the outer `catch`; add a `private bootstrapDegraded = false;` flag set in the catch, and an `isBootstrapDegraded(): boolean` accessor. Keep the existing log but make the message explicit (`'event trigger bootstrap failed'`). When the flag is set, rethrow.

- [ ] **Step 4: Run the spec — verify pass**

Run: `npm run test --workspace=apps/api -- workflow-event-trigger.service.spec`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

```bash
npm run lint:api
git add apps/api/src/workflow/workflow-event-trigger.service.ts \
        apps/api/src/workflow/workflow-event-trigger.service.spec.ts
git commit -m "fix(workflow): surface event-trigger bootstrap failures instead of swallowing"
```

---

## Task 7: Move run display-name formatting out of the persistence tier

`getTriggerDisplayName`, `resolveWorkflowRunDisplayName` (module fns, lines 31-52) and `enrichWorkflowRunDisplayNames` (method, line ~184) are presentation concerns inside the persistence service. Move them to a dedicated helper; route `updateRunStatus` through the entity method.

**Files:**

- Create: `apps/api/src/workflow/workflow-run-display.helpers.ts`
- Test (new): `apps/api/src/workflow/workflow-run-display.helpers.spec.ts`
- Modify: `apps/api/src/workflow/workflow-persistence.service.ts`

**Interfaces:**

- Produces: `resolveWorkflowRunDisplayName(run: IWorkflowRun, workflowName: string | null): string`, `getTriggerDisplayName(run: IWorkflowRun): string | null`, and `WorkflowRunDisplayItem` type, all exported from `workflow-run-display.helpers.ts`. The `enrichWorkflowRunDisplayNames` logic becomes a pure helper `enrichWorkflowRunDisplayNames(runs, resolveName): WorkflowRunDisplayItem[]` (name lookup injected so it stays pure).

- [ ] **Step 1: Write the failing helper spec**

Create `workflow-run-display.helpers.spec.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { resolveWorkflowRunDisplayName } from "./workflow-run-display.helpers";

const base = { id: "abcdef123456", state_variables: {} } as never;

describe("resolveWorkflowRunDisplayName", () => {
  it("prefers the trigger display name", () => {
    const run = {
      ...base,
      state_variables: { trigger: { displayName: "Nightly" } },
    };
    expect(resolveWorkflowRunDisplayName(run as never, "wf")).toBe("Nightly");
  });
  it("falls back to workflow name, then run id prefix", () => {
    expect(resolveWorkflowRunDisplayName(base, "wf")).toBe("wf");
    expect(resolveWorkflowRunDisplayName(base, null)).toBe(
      "Workflow run abcdef12",
    );
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npm run test --workspace=apps/api -- workflow-run-display.helpers.spec`
Expected: FAIL (module not found).

- [ ] **Step 3: Move the formatters into the helper**

Create `workflow-run-display.helpers.ts` with `isRecord`, `getTriggerDisplayName`, `resolveWorkflowRunDisplayName`, the `WorkflowRunDisplayItem` type, and a pure `enrichWorkflowRunDisplayNames(runs, resolveName)` — all moved verbatim from the service file.

- [ ] **Step 4: Run helper spec — verify pass**

Run: `npm run test --workspace=apps/api -- workflow-run-display.helpers.spec`
Expected: PASS.

- [ ] **Step 5: Update the persistence service to consume the helper + entity method**

In `workflow-persistence.service.ts`: delete the moved module fns and the `WorkflowRunDisplayItem` type; import them from the helper. Update the `enrichWorkflowRunDisplayNames` method to call the pure helper, passing the service's name-lookup closure. Change `updateRunStatus` line 263 from `run.status = status;` to `run.updateStatus(status);`.

- [ ] **Step 6: Run the persistence service spec(s)**

Run: `npm run test --workspace=apps/api -- workflow-persistence`
Expected: PASS.

- [ ] **Step 7: Lint + commit**

```bash
npm run lint:api
git add apps/api/src/workflow/workflow-run-display.helpers.ts \
        apps/api/src/workflow/workflow-run-display.helpers.spec.ts \
        apps/api/src/workflow/workflow-persistence.service.ts
git commit -m "refactor(workflow): move run display formatting out of persistence tier"
```

---

# PHASE 3 — Break the in-module circular dependency

## Task 8: Remove the `forwardRef` between capability executor and tools service

The executor uses the tools service at exactly one call site (`this.runtimeTools.getCapabilities(...)`, line 218) inside an async method — it does not need it at construction. Resolve it lazily via `ModuleRef` through the existing `WORKFLOW_RUNTIME_TOOLS_SERVICE` token and define the narrow port interface.

**Files:**

- Modify: `apps/api/src/workflow/kernel/interfaces/workflow-kernel.ports.ts` (flesh out `IWorkflowRuntimeToolsService` with `getCapabilities`)
- Modify: `apps/api/src/workflow/workflow-runtime/workflow-runtime-capability-executor.service.ts`
- Test (existing): `workflow-runtime-capability-executor.service.spec.ts`

**Interfaces:**

- Consumes: `ModuleRef` (`@nestjs/core`), `WORKFLOW_RUNTIME_TOOLS_SERVICE` token, `IWorkflowRuntimeToolsService`.
- Produces: `IWorkflowRuntimeToolsService.getCapabilities(args)` matching the concrete `WorkflowRuntimeToolsService.getCapabilities` signature (copy the exact parameter/return types from that method).

- [ ] **Step 1: Confirm the executor spec is green**

Run: `npm run test --workspace=apps/api -- workflow-runtime-capability-executor.service.spec`
Expected: PASS.

- [ ] **Step 2: Define `getCapabilities` on the port interface**

In `workflow-kernel.ports.ts`, extend `IWorkflowRuntimeToolsService` with the exact `getCapabilities` signature from `WorkflowRuntimeToolsService` (copy parameter object + return type verbatim).

- [ ] **Step 3: Replace constructor forwardRef with lazy ModuleRef resolution**

In `workflow-runtime-capability-executor.service.ts`:

- Remove `forwardRef` and the `WorkflowRuntimeToolsService` constructor param.
- Add `private readonly moduleRef: ModuleRef` to the constructor.
- At the call site (line ~218):

```typescript
import { ModuleRef } from "@nestjs/core";
import { WORKFLOW_RUNTIME_TOOLS_SERVICE } from "../kernel/interfaces/workflow-kernel.ports";
import type { IWorkflowRuntimeToolsService } from "../kernel/interfaces/workflow-kernel.ports";

const runtimeTools = this.moduleRef.get<IWorkflowRuntimeToolsService>(
  WORKFLOW_RUNTIME_TOOLS_SERVICE,
  { strict: false },
);
const capabilitySnapshot = await runtimeTools.getCapabilities({
  /* same args */
});
```

Drop the now-unused `import { WorkflowRuntimeToolsService }`.

- [ ] **Step 4: Update the executor spec to provide the tools service via the token**

In `workflow-runtime-capability-executor.service.spec.ts`, replace the direct `WorkflowRuntimeToolsService` mock provider with a `ModuleRef` mock whose `get(WORKFLOW_RUNTIME_TOOLS_SERVICE)` returns the `getCapabilities` mock.

Run: `npm run test --workspace=apps/api -- workflow-runtime-capability-executor.service.spec`
Expected: PASS.

- [ ] **Step 5: Verify the module compiles without forwardRef**

Run: `npm run test --workspace=apps/api -- workflow-kernel.spec` (the `WorkflowRuntimeModule` boundary test — still skipped at this point, but the module should still compile in other suites).
Then: `npm run build:api`
Expected: build succeeds with no circular-dependency warning for these two services.

- [ ] **Step 6: Lint + commit**

```bash
npm run lint:api
git add apps/api/src/workflow/kernel/interfaces/workflow-kernel.ports.ts \
        apps/api/src/workflow/workflow-runtime/workflow-runtime-capability-executor.service.ts \
        apps/api/src/workflow/workflow-runtime/workflow-runtime-capability-executor.service.spec.ts
git commit -m "refactor(workflow): break runtime executor<->tools cycle via lazy ModuleRef"
```

---

# PHASE 4 — Remove `@Global()` (highest blast radius, last)

## Task 9: Migrate `RecordLearningService` to the engine port token

`RecordLearningService` injects the concrete `WorkflowEngineService` (line 35). Switch it to the `WORKFLOW_ENGINE_SERVICE` token + `IWorkflowEngineService` so it no longer depends on the concrete class export.

**Files:**

- Modify: `apps/api/src/memory/learning/record-learning.service.ts`
- Test (existing): `record-learning.service.spec.ts` (if present; otherwise add a minimal injection test)

**Interfaces:**

- Consumes: `WORKFLOW_ENGINE_SERVICE`, `IWorkflowEngineService` from `../../workflow/kernel/interfaces/workflow-kernel.ports`. Confirm the methods `RecordLearningService` calls on `workflowEngine` exist on `IWorkflowEngineService`; if a method is missing from the port, add it to the port interface (it already wraps the concrete service via `useExisting`).

- [ ] **Step 1: Identify the engine methods used**

Run: `npm run test --workspace=apps/api -- record-learning.service.spec` (confirm baseline). Grep `this.workflowEngine.` in the service; verify each method is on `IWorkflowEngineService`. Add any missing signatures to the port interface.

- [ ] **Step 2: Switch the injection to the token**

```typescript
import { WORKFLOW_ENGINE_SERVICE } from '../../workflow/kernel/interfaces/workflow-kernel.ports';
import type { IWorkflowEngineService } from '../../workflow/kernel/interfaces/workflow-kernel.ports';

constructor(
  private readonly candidates: LearningCandidateRepository,
  private readonly eventLedger: EventLedgerService,
  @Inject(WORKFLOW_ENGINE_SERVICE)
  private readonly workflowEngine: IWorkflowEngineService,
) {}
```

Remove `import { WorkflowEngineService }`.

- [ ] **Step 3: Run the spec — verify pass**

Run: `npm run test --workspace=apps/api -- record-learning.service.spec`
Expected: PASS (update the spec's provider to use the token if it referenced the concrete class).

- [ ] **Step 4: Lint + commit**

```bash
npm run lint:api
git add apps/api/src/memory/learning/record-learning.service.ts \
        apps/api/src/memory/learning/record-learning.service.spec.ts
git commit -m "refactor(learning): inject workflow engine via port token"
```

---

## Task 10: Add explicit `WorkflowModule` imports to the three implicit consumers

While `WorkflowModule` is still `@Global()` (so the app keeps booting), make `AutomationModule`, `LearningModule`, and `NotificationsModule` import it explicitly. This is the safe precursor to dropping `@Global()`.

**Files:**

- Modify: `apps/api/src/automation/automation.module.ts`
- Modify: `apps/api/src/memory/learning/learning.module.ts`
- Modify: `apps/api/src/notifications/notifications.module.ts`

**Interfaces:**

- Consumes: `WorkflowModule` exports (the port tokens consumed by `HeartbeatRunnerService`, `ScheduledJobsRunnerService`, `AutomationHooksService`, `LearningService`, `RecordLearningService`, `NotificationProducerService`).
- Caution: `WorkflowModule` imports `AutomationModule` (`workflow.module.ts:107`) and `WorkflowRuntimeModule` imports `AutomationModule` too. Adding `WorkflowModule` to `AutomationModule`'s imports creates a module cycle — use `forwardRef(() => WorkflowModule)` **only** in `AutomationModule` if Nest reports a cycle; prefer importing the narrower module that actually exports the needed token if one exists.

- [ ] **Step 1: Add the import to `LearningModule` (no cycle expected)**

Add `WorkflowModule` to `LearningModule.imports`. Run:
`npm run test --workspace=apps/api -- learning`
Expected: PASS.

- [ ] **Step 2: Add the import to `NotificationsModule`**

Add `WorkflowModule` to `NotificationsModule.imports`. Run the notifications specs.
Expected: PASS.

- [ ] **Step 3: Add the import to `AutomationModule`, handling the cycle**

Add `WorkflowModule` to `AutomationModule.imports`. Build:
`npm run build:api`
If Nest reports a cycle (`WorkflowModule` ⇄ `AutomationModule`), wrap with `forwardRef(() => WorkflowModule)` in `AutomationModule` only. Re-run build.
Expected: build succeeds.

- [ ] **Step 4: Boot smoke — app context still compiles**

Run the broad API suite to confirm DI still resolves everywhere:
`npm run test:api`
Expected: PASS (no provider-resolution failures).

- [ ] **Step 5: Lint + commit**

```bash
npm run lint:api
git add apps/api/src/automation/automation.module.ts \
        apps/api/src/memory/learning/learning.module.ts \
        apps/api/src/notifications/notifications.module.ts
git commit -m "refactor(workflow): import WorkflowModule explicitly in implicit consumers"
```

---

## Task 11: Drop `@Global()`, narrow exports, un-skip kernel boundary tests

**Files:**

- Modify: `apps/api/src/workflow/workflow.module.ts`
- Modify: `apps/api/src/workflow/kernel/workflow-kernel.spec.ts:282-308`

**Interfaces:**

- Consumes: the explicit imports added in Task 10; all external token consumers from Task 9.

- [ ] **Step 1: Un-skip the 7 kernel boundary tests (Red)**

In `workflow-kernel.spec.ts`, change the 7 `it.skip(...)` (lines 282-308) to `it(...)` and give each a real body mirroring the passing `WorkflowLaunchModule` test (lines 270-280): compile the submodule with `FakeGlobalModule`, `WorkflowKernelModule`, and the same module overrides, asserting `module` is defined and that the submodule does not pull `WorkflowModule` via `forwardRef`.

Run: `npm run test --workspace=apps/api -- workflow-kernel.spec`
Expected: some FAIL initially if a submodule still leans on globals (this is the signal to fix wiring).

- [ ] **Step 2: Remove `@Global()` and narrow exports**

In `workflow.module.ts`:

- Delete the `Global` import and the `@Global()` decorator.
- Narrow `exports` to the 4 kernel tokens (`WORKFLOW_ENGINE_SERVICE`, `WORKFLOW_PARSER_SERVICE`, `STATE_MACHINE_SERVICE`, `WORKFLOW_PERSISTENCE_SERVICE`) plus the re-exported submodules that external modules legitimately consume. Drop concrete-class exports whose only external consumers now use tokens (verify each against the consumer map in the spec before removing).
- Keep concrete exports still consumed within the workflow package via submodule imports.

- [ ] **Step 3: Build — fix any newly-surfaced DI gaps**

Run: `npm run build:api`
For each unresolved-provider error, add the explicit import of `WorkflowModule` (or the narrower owning module) to the failing consumer module. Repeat until the build is clean.

- [ ] **Step 4: Run the kernel boundary tests — verify all green**

Run: `npm run test --workspace=apps/api -- workflow-kernel.spec`
Expected: PASS for all 8 boundary tests (none skipped).

- [ ] **Step 5: Full API suite + lint (Phase gate)**

```bash
npm run test:api
npm run lint:api
```

Expected: PASS / clean. This is the DI smoke gate for the whole refactor.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workflow/workflow.module.ts apps/api/src/workflow/kernel/workflow-kernel.spec.ts
git commit -m "refactor(workflow): drop @Global(), narrow exports, enforce kernel boundary tests"
```

---

## Final verification (run before declaring the refactor complete)

- [ ] `npm run build --workspace=packages/core`
- [ ] `npm run build:api`
- [ ] `npm run test:api` — full suite green
- [ ] `npm run lint:api` — clean (no new suppressions)
- [ ] `npm run test:unit:web -- workflow-run-detail` — web import swap green
- [ ] Update `docs/guide` if the WorkflowModule boundary description references `@Global()`.
- [ ] Live-stack smoke for the Task 5 migration before deploy (new `workflow_event_dedupe` table applies cleanly).

---

## Self-Review (completed during authoring)

- **Spec coverage:** Every spec phase maps to tasks — Phase 0 → Tasks 1-2; Phase 1 → Tasks 3-4; Phase 2 → Tasks 5-7; Phase 3 → Task 8; Phase 4 → Tasks 9-11. The spec's "already resolved" items are excluded by design.
- **Backoff divergence:** The spec's conditional ("leave as-is if semantics differ") is resolved concretely — the two workflow helpers are consolidated with each other (identical algorithm), not forced onto the core util (different semantics). Documented in Task 2's preamble.
- **Type consistency:** `GitActionStrategy`/`GitActionParams` (Task 3), `resolveInvocationInputs`/`InvocationInputs` (Task 4), `claim`/`purgeExpired` (Task 5), `resolveWorkflowRunDisplayName`/`WorkflowRunDisplayItem` (Task 7), `IWorkflowRuntimeToolsService.getCapabilities` (Task 8) are referenced consistently across tasks.
- **Ordering risk:** Task 8 (cycle break) precedes Tasks 10-11 (@Global removal) per the spec gate; Task 10 (explicit imports while still global) de-risks Task 11.
