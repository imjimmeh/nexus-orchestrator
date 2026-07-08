# Plan: EPIC-209 Phase 5 — Pre-flight Gate Toggle, auto_merge / merge_method, and CEO Stalled-PR Awareness

**Date:** 2026-06-22
**Epic:** EPIC-209 (Pull-Request-Based Integration Strategy)
**Spec:** `docs/superpowers/specs/2026-06-22-pr-based-integration-strategy-design.md` (Section 6, Phase 5; signatures pinned in Section 10 — used verbatim below)
**Consumes (earlier phases):**

- `IntegrationStrategyResolver.resolve(inputs)` → `ResolvedIntegrationConfig { strategy, mergeMethod, autoMerge, preflightGate }` (Phase 1, Section 10.2).
- `MergeProvider` interface + `MERGE_PROVIDER` symbol (Phase 1 declares, Phase 2 implements): `openOrUpdatePullRequest`, `getPullRequestStatus`, `mergePullRequest` (Section 10.1).
- `MergeProviderFactory.resolveForRepository(repositoryUrl)` (Phase 2).
- `PullRequestTrackingRepository` (`recordOpenedPullRequest`, `findByProviderIdentity`) + `pull_request_tracking` rows in state `'open'` (Phase 3, Section 10.4).
- `RepositoryIntegrationSettings` + `resolveRepositoryIntegrationSettings(settings)` (Phase 1, Section 10.3) and the neutral trigger-input keys `integration_strategy` / `integration_merge_method` / `integration_auto_merge` / `integration_preflight_gate` (Section 10.6).
- The Phase-4 **PR poll reconciler** (`PullRequestPollReconciler`) + **PR webhook controller** + `core.integration.pr_merged.v1` (Section 10.5) + the kanban `pr_merged` consumer transition `awaiting-pr-merge → done`.
- The Phase-3 seed branch in `seed/workflows/work-item-ready-to-merge-default.workflow.yaml` (the `quality_gate` job + the `pull-request` PR path).

**Produces (for Phase 6):** a provider-agnostic merge-decision seam (`mergePullRequest(ref, method)` + provider-native auto-merge enablement) and a kanban stalled-PR fact-snapshot field, both consumed unchanged when GitLab/Bitbucket adapters land.

> **Dependency note (read first):** at the time this plan was written, Phases 1–4 are **planned but not yet merged**. This plan references the **pinned Section 10 signatures** and the Phase-3/Phase-4 plan artifacts as the stable contract. When executing Phase 5, first confirm the actual exported symbol names against the merged Phase 1–4 code (`apps/api/src/common/git/integration/*`, `PullRequestPollReconciler`, the kanban `pr_merged` consumer) and bind to the real names — **do not invent or redefine** any Section 10 type. If a consumed symbol's name differs from this plan, match the merged code; the _behaviour_ specified here is authoritative, the _exact local symbol_ defers to merged Phase 1–4.

---

## Goal

Tune the PR integration path delivered by Phases 1–4 along three independent axes, with `direct-push` repositories **byte-for-byte unchanged** throughout:

1. **Pre-flight gate toggle.** The in-container `quality_gate` job runs only when the resolved `preflightGate === true` (default `true`). For a `pull-request` repo with `preflightGate === false`, the workflow skips straight from `merge_prepare` to `merge_integrate` (push + open PR), trusting the provider's required checks as the gate of record. `direct-push` is unaffected (it has no PR gate-of-record, so its `quality_gate` always runs).
2. **auto_merge vs API-merge.**
   - `autoMerge === false` (default): the Phase-4 poll reconciler, on observing a tracked open PR whose required **checks are green** (`getPullRequestStatus().checks === 'passing'` **AND** `reviewDecision !== 'changes_requested'`), calls `MergeProvider.mergePullRequest(ref, mergeMethod)` with the configured method. Failing/pending checks → NOT merged (observe again next tick).
   - `autoMerge === true`: provider-native auto-merge is enabled at PR-open time; the reconciler **never** calls `mergePullRequest`, it only observes until the webhook/poll sees the merge. `mergeMethod` flows into the auto-merge enablement.
3. **CEO stalled-PR awareness (kanban-side).** `awaiting-pr-merge` is in-flight / not-stuck (never re-dispatched, never flagged stuck on age alone — already true from Phase 3). Phase 5 adds a **stalled-PR signal**: PRs whose work-item `lifecycle.merge` shows red checks, `changes_requested`, or an open age beyond `STALLED_PR_AGE_MS` surface to the CEO in the strategic fact snapshot as actionable items; a healthy open PR does not.

## Architecture

- **API-side (neutral, VCS-domain):**
  - `ResolvedIntegrationConfig` is already produced by `IntegrationStrategyResolver` (Phase 1) — Phase 5 only _consumes_ `autoMerge` / `mergeMethod` / `preflightGate`; no resolver change.
  - The **PR poll reconciler** (Phase 4) gains a merge-decision branch: for each tracked open PR it fetches `getPullRequestStatus(ref)`; if the repo's resolved config is `autoMerge === false` and checks are green, it calls `mergePullRequest(ref, mergeMethod)`. The reconciler must know each tracked PR's resolved `{ autoMerge, mergeMethod }` — Phase 5 persists those two fields on the `pull_request_tracking` row at open time (additive columns) so the reconciler reads them without a kanban round-trip (boundary-clean).
  - **Provider-native auto-merge** is enabled at PR-open time inside the `MergeIntegrateGitActionStrategy.openPullRequest(...)` path (Phase 3) by calling a new `MergeProvider.enableAutoMerge(ref, method)` capability when `autoMerge === true`. (The interface gains one optional method; `GitHubMergeProvider` implements it via octokit `enablePullRequestAutoMerge`.)
  - A small **checks-green predicate** (`isPullRequestMergeable(status)`) is a pure function so it is unit-tested in isolation and reused by the reconciler.
- **Kanban-side (lifecycle + CEO snapshot):**
  - `ProjectStrategicStateService.buildStrategicState` gains a `stalledPullRequests` field on `StrategicStaleness`, computed from work items in `awaiting-pr-merge` whose `metadata.lifecycle.merge` is red / changes-requested / over-`STALLED_PR_AGE_MS`. Healthy open PRs are excluded. Surfaced through `ProjectStateTool` under `strategic.staleness` (already wired — no tool change beyond the type widening).
  - PR check/review/age state reaches kanban via the work item's `metadata.lifecycle.merge` object. Phase 4's reconciler/webhook already updates `lifecycle.merge` on observed transitions; Phase 5 ensures the reconciler also writes the **observed status snapshot** (`checks`, `reviewDecision`, `openedAt`) onto `lifecycle.merge` so the kanban snapshot can read it. This write happens on the API side via the existing neutral lifecycle event/metadata-patch path — **kanban never queries the provider directly**.
- **Seed workflow:** the `quality_gate` job (and its dependents) become conditional on a new neutral trigger input `integration_preflight_gate`. When `false` on a PR repo, `merge_prepare` transitions directly to `merge_integrate`.

## Tech Stack

TypeScript (strict), NestJS (`nest build`; `@nestjs/schedule` `@Interval` for the reconciler), TypeORM (Postgres; additive migration), Vitest, Zod, Handlebars-templated YAML workflows, octokit (GitHub adapter, Phase 2). No new runtime dependencies.

## Global Constraints

- **TDD strictly:** failing test → run (expect FAIL) → minimal impl → run (expect PASS) → commit. One behaviour per Red/Green cycle. **Vitest** only.
- **Test commands:** API `npm run test --workspace=apps/api`; kanban `npm run test --workspace=apps/kanban`; contracts compiled via the kanban build. Typecheck before declaring done: `npm run build --workspace=packages/kanban-contracts`, `npm run build:api`, `npm run build:kanban`. Seed: `npm run validate:seed-data`.
- **Core/Kanban boundary (critical):** all merge mechanics, config resolution, the reconciler, the `pull_request_tracking` columns, and the provider auto-merge call are **API-side** and use **only** neutral `scopeId` / `contextId` and VCS terms (`provider`, `owner`, `repo`, `pr_number`, `head`, `base`, `checks`, `mergeMethod`, `autoMerge`). The CEO stalled-PR surfacing is **kanban-side**. **No** `kanban`, `workItem`, `work-item`, or project-domain identifiers in API/core code, tests, fixtures, comments, or migration SQL. Lint rule `nexus-boundaries/no-core-kanban-residue` enforces this — **never** add allowlists, `eslint-disable`, `@ts-ignore`, or compatibility aliases to bypass it.
- **`direct-push` unchanged:** an explicit regression test asserts the seed `direct-push` path still runs `quality_gate` → `merge_integrate` and that the reconciler never touches a `direct-push` repo (it has no tracked PR row). Do not alter `GitMergeService.integrateAndPush`, `merge-prepare-git-action.strategy.ts`, or the `direct-push` branch of `MergeIntegrateGitActionStrategy`.
- **No magic numbers:** the stalled threshold is the named constant `STALLED_PR_AGE_MS`; the reconcile interval reuses Phase 4's constant. No literal durations in branch logic.
- **No lint suppression.** Strong typing throughout; Section 10 signatures used verbatim.
- **Frequent atomic conventional commits** — one per Green step. End every commit message with the Co-Authored-By trailer.
- **Out of Phase-5 scope (do NOT build here):** GitLab/Bitbucket adapters and per-provider webhook ingress (Phase 6); any new lifecycle state; any change to the Phase-4 webhook controller's verification logic; re-dispatch of `awaiting-pr-merge` items (forbidden by spec Decision 6).

---

## File Structure

```
apps/api/src/
  common/git/integration/
    merge-provider.interface.ts                          (EDIT — add optional enableAutoMerge + isPullRequestMergeable helper export)
    merge-provider.helpers.ts                            (NEW — isPullRequestMergeable pure predicate)
    merge-provider.helpers.spec.ts                       (NEW — predicate unit tests)
    github-merge-provider.ts                             (EDIT — implement enableAutoMerge via octokit; Phase 2 file)
    github-merge-provider.spec.ts                        (EDIT — enableAutoMerge test)
    pull-request-tracking.entity.ts                      (EDIT — add auto_merge + merge_method columns)
    pull-request-tracking.repository.ts                  (EDIT — persist + read auto_merge/merge_method)
    pull-request-tracking.repository.types.ts            (EDIT — input fields)
    pull-request-tracking.repository.spec.ts             (EDIT — round-trip new fields)
    pull-request-poll-reconciler.service.ts              (EDIT — Phase 4 file: add merge-decision branch)
    pull-request-poll-reconciler.service.spec.ts         (EDIT — merge / no-merge / auto-merge tests)
  workflow/workflow-special-steps/git-actions/
    merge-integrate-git-action.strategy.ts               (EDIT — enable provider auto-merge when autoMerge=true)
    merge-integrate-git-action.strategy.spec.ts          (EDIT — auto-merge enable tests)
  database/
    migrations/20260622HHmmss-add-pr-tracking-merge-config.ts   (NEW — additive columns)
    migrations/registered-migrations.ts                  (EDIT — register migration)

packages/kanban-contracts/src/
  work-item-merge-metadata.types.ts                      (NEW — LifecycleMergeMetadata shape: checks/reviewDecision/openedAt/prUrl)
  work-item-merge-metadata.spec.ts                       (NEW — type-guard contract test)
  index.ts                                               (EDIT — export new type + guard)

apps/kanban/src/orchestration/strategic/
  project-strategic-state.types.ts                       (EDIT — add stalledPullRequests + StalledPullRequest type)
  stalled-pull-request.helpers.ts                        (NEW — STALLED_PR_AGE_MS + computeStalledPullRequests)
  stalled-pull-request.helpers.spec.ts                   (NEW — stalled vs healthy unit tests)
  project-strategic-state.service.ts                     (EDIT — populate stalledPullRequests)
  project-strategic-state.service.spec.ts                (EDIT — snapshot includes stalled, excludes healthy)

apps/kanban/src/mcp/tools/read/
  project-state.tool.ts                                  (NO CODE CHANGE — type-only widening flows through; confirm build)

seed/workflows/
  work-item-ready-to-merge-default.workflow.yaml         (EDIT — preflightGate-conditional quality_gate)
```

---

## Phase Ordering

API-side and kanban-side are independent and may run in either order; the seed (Task 8) depends only on the trigger key already forwarded by Phase 1. Recommended numbered order: predicate (1) → auto-merge enablement (2–3) → tracking columns + reconciler merge branch (4–5) → kanban stalled signal (6–7) → seed gate toggle (8) → regression sweep (9).

---

## Task 1 — `isPullRequestMergeable` checks-green predicate (pure, API-side)

**Files**

- `apps/api/src/common/git/integration/merge-provider.helpers.ts` (NEW)
- `apps/api/src/common/git/integration/merge-provider.helpers.spec.ts` (NEW)

**Interfaces**

- Consumes: `PullRequestStatus` (Section 10.1: `{ ref, state, checks, reviewDecision, mergeCommitSha, mergeable }`).
- Produces: `isPullRequestMergeable(status: PullRequestStatus): boolean` — `true` iff `state === 'open'` **AND** `checks === 'passing'` **AND** `reviewDecision !== 'changes_requested'`. Consumed by the reconciler (Task 5).

### Step 1.1 (Red) — failing predicate spec

Create `apps/api/src/common/git/integration/merge-provider.helpers.spec.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { isPullRequestMergeable } from "./merge-provider.helpers";
import type { PullRequestStatus } from "./merge-provider.interface";

function status(overrides: Partial<PullRequestStatus> = {}): PullRequestStatus {
  return {
    ref: {
      provider: "github",
      owner: "acme",
      repo: "widgets",
      number: 42,
      url: "https://github.com/acme/widgets/pull/42",
    },
    state: "open",
    checks: "passing",
    reviewDecision: "approved",
    mergeCommitSha: null,
    mergeable: true,
    ...overrides,
  };
}

describe("isPullRequestMergeable", () => {
  it("is true for an open PR with passing checks and no changes requested", () => {
    expect(isPullRequestMergeable(status())).toBe(true);
  });

  it("is true when review is required but checks pass (branch protection decides)", () => {
    expect(
      isPullRequestMergeable(status({ reviewDecision: "review_required" })),
    ).toBe(true);
  });

  it("is false when checks are failing", () => {
    expect(isPullRequestMergeable(status({ checks: "failing" }))).toBe(false);
  });

  it("is false when checks are pending", () => {
    expect(isPullRequestMergeable(status({ checks: "pending" }))).toBe(false);
  });

  it("is false when checks are unknown", () => {
    expect(isPullRequestMergeable(status({ checks: "unknown" }))).toBe(false);
  });

  it("is false when changes were requested even with passing checks", () => {
    expect(
      isPullRequestMergeable(status({ reviewDecision: "changes_requested" })),
    ).toBe(false);
  });

  it("is false when the PR is no longer open", () => {
    expect(isPullRequestMergeable(status({ state: "merged" }))).toBe(false);
    expect(isPullRequestMergeable(status({ state: "closed" }))).toBe(false);
  });
});
```

Run (expect FAIL — helper does not exist):

```bash
npm run test --workspace=apps/api -- merge-provider.helpers
```

Expected: `Cannot find module './merge-provider.helpers'` / suite fails to import.

### Step 1.2 (Green) — implement the predicate

Create `apps/api/src/common/git/integration/merge-provider.helpers.ts`:

```typescript
import type { PullRequestStatus } from "./merge-provider.interface";

/**
 * Pure "is this PR safe to API-merge now?" gate for the poll reconciler.
 *
 * A tracked PR is mergeable iff it is still open, its required checks are
 * observed green, and review has not requested changes. `review_required` /
 * `none` are NOT blockers here — provider branch protection is the gate of
 * record; this predicate only refuses to merge a PR the provider would also
 * refuse (red checks) or that a reviewer has explicitly rejected.
 *
 * Neutral VCS-domain logic — no kanban identifiers.
 */
export function isPullRequestMergeable(status: PullRequestStatus): boolean {
  return (
    status.state === "open" &&
    status.checks === "passing" &&
    status.reviewDecision !== "changes_requested"
  );
}
```

Run (expect PASS):

```bash
npm run test --workspace=apps/api -- merge-provider.helpers
```

### Step 1.3 (Commit)

```bash
git add apps/api/src/common/git/integration/merge-provider.helpers.ts \
  apps/api/src/common/git/integration/merge-provider.helpers.spec.ts
git commit -m "feat(api): isPullRequestMergeable checks-green predicate for PR reconciler

EPIC-209 Phase 5. Pure gate: open + checks passing + not changes_requested.
Reused by the poll reconciler's API-merge branch. Neutral VCS-domain only.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2 — Add `enableAutoMerge` to the `MergeProvider` interface (API-side)

**Files**

- `apps/api/src/common/git/integration/merge-provider.interface.ts` (EDIT)

**Interfaces**

- Consumes: `PullRequestRef`, `MergeMethod` (Section 10.1).
- Produces: `MergeProvider.enableAutoMerge(ref: PullRequestRef, method: MergeMethod): Promise<void>` — provider-native merge-when-green enablement. Optional on the interface so Phase-6 adapters that lack the capability degrade gracefully; the strategy (Task 3) guards on its presence.

### Step 2.1 (Green — interface-only, no behaviour test here)

Interface additions are exercised by Task 3 (strategy) and the GitHub adapter (Task 3.4). Add the method signature to the pinned interface **without** altering the Section 10.1 members:

```typescript
export interface MergeProvider {
  readonly providerKey: string; // 'github'
  openOrUpdatePullRequest(
    args: OpenOrUpdatePullRequestArgs,
  ): Promise<PullRequestRef>;
  getPullRequestStatus(ref: PullRequestRef): Promise<PullRequestStatus>;
  mergePullRequest(
    ref: PullRequestRef,
    method: MergeMethod,
  ): Promise<{ mergeCommitSha: string }>;
  /**
   * Enable provider-native "merge when green" so the engine does NOT API-merge.
   * Optional: a provider without auto-merge support omits it; callers must guard
   * on presence and fall back to reconciler-driven API-merge.
   */
  enableAutoMerge?(ref: PullRequestRef, method: MergeMethod): Promise<void>;
}
```

> Do not modify any other Section 10.1 type. Re-export `isPullRequestMergeable` from this module's barrel only if Phase 1–4 established one; otherwise import it directly from `merge-provider.helpers`.

Run (expect PASS — typecheck only, no new behaviour yet):

```bash
npm run build:api
```

### Step 2.2 (Commit)

```bash
git add apps/api/src/common/git/integration/merge-provider.interface.ts
git commit -m "feat(api): optional MergeProvider.enableAutoMerge capability

EPIC-209 Phase 5. Provider-native merge-when-green seam used when autoMerge=true;
optional so non-supporting providers degrade to reconciler API-merge.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3 — Enable provider auto-merge at PR-open time when `autoMerge === true`

**Files**

- `apps/api/src/workflow/workflow-special-steps/git-actions/merge-integrate-git-action.strategy.ts` (EDIT — Phase 3 file)
- `apps/api/src/workflow/workflow-special-steps/git-actions/merge-integrate-git-action.strategy.spec.ts` (EDIT)
- `apps/api/src/common/git/integration/github-merge-provider.ts` (EDIT — Phase 2 file)
- `apps/api/src/common/git/integration/github-merge-provider.spec.ts` (EDIT)

**Interfaces**

- Consumes: `IntegrationStrategyResolver.resolve(inputs)` → `{ autoMerge, mergeMethod }` (already called in Phase 3's strategy); `MergeProvider.enableAutoMerge` (Task 2); `MergeProvider.openOrUpdatePullRequest` (Section 10.1).
- Produces: when `autoMerge === true`, the strategy calls `provider.enableAutoMerge(ref, mergeMethod)` after opening the PR and records `auto_merge: true` / `merge_method` on the tracking row (Task 4); when `autoMerge === false`, it does NOT.

### Step 3.1 (Red) — strategy auto-merge tests

Extend `merge-integrate-git-action.strategy.spec.ts`. Reuse the Phase-3 `buildStrategy` factory but parameterise `autoMerge` / `mergeMethod` on the integration resolver mock and add `enableAutoMerge: vi.fn()` to the `mergeProvider` mock:

```typescript
it("pull-request + autoMerge=true: enables provider auto-merge with the configured method, does not API-merge", async () => {
  const { strategy, mergeProvider, trackingRepo } = buildStrategy({
    strategy: "pull-request",
    autoMerge: true,
    mergeMethod: "squash",
  });

  await strategy.execute({
    workflowRunId: "11111111-1111-1111-1111-111111111111",
    stepId: "merge_integrate",
    triggerContext,
    resolvedStepInputs: {
      repository_url: "https://github.com/acme/widgets.git",
      github_secret_id: "secret-1",
    },
  });

  expect(mergeProvider.openOrUpdatePullRequest).toHaveBeenCalledTimes(1);
  expect(mergeProvider.enableAutoMerge).toHaveBeenCalledWith(
    expect.objectContaining({ number: 42, provider: "github" }),
    "squash",
  );
  expect(mergeProvider.mergePullRequest).not.toHaveBeenCalled();

  const recordInput = trackingRepo.recordOpenedPullRequest.mock.calls[0][0];
  expect(recordInput).toMatchObject({ autoMerge: true, mergeMethod: "squash" });
});

it("pull-request + autoMerge=false: does NOT enable provider auto-merge, records autoMerge=false", async () => {
  const { strategy, mergeProvider, trackingRepo } = buildStrategy({
    strategy: "pull-request",
    autoMerge: false,
    mergeMethod: "merge",
  });

  await strategy.execute({
    workflowRunId: "11111111-1111-1111-1111-111111111111",
    stepId: "merge_integrate",
    triggerContext,
    resolvedStepInputs: {
      repository_url: "https://github.com/acme/widgets.git",
      github_secret_id: "secret-1",
    },
  });

  expect(mergeProvider.enableAutoMerge).not.toHaveBeenCalled();
  const recordInput = trackingRepo.recordOpenedPullRequest.mock.calls[0][0];
  expect(recordInput).toMatchObject({ autoMerge: false, mergeMethod: "merge" });
});
```

> Update the Phase-3 `buildStrategy` factory's `integrationResolver.resolve` mock to return `autoMerge: overrides.autoMerge ?? false` and `mergeMethod: overrides.mergeMethod ?? 'merge'`, and add `enableAutoMerge: vi.fn().mockResolvedValue(undefined)` to the `mergeProvider` mock.

Run (expect FAIL):

```bash
npm run test --workspace=apps/api -- merge-integrate-git-action.strategy
```

### Step 3.2 (Green) — strategy enables auto-merge + records config

In `merge-integrate-git-action.strategy.ts`, inside the existing `openPullRequest(...)` method, after `openOrUpdatePullRequest` resolves `ref` and before/with the `recordOpenedPullRequest` call, add the resolved config and the optional auto-merge enablement. The config is already resolved earlier in `execute(...)` (Phase 3 called `this.integrationResolver.resolve(resolvedStepInputs)`); pass it into `openPullRequest`:

```typescript
// in execute(...), the config is already resolved:
const config = this.integrationResolver.resolve(resolvedStepInputs);
if (config.strategy === "pull-request") {
  return this.openPullRequest({
    workflowRunId,
    stepId,
    triggerContext,
    resolvedStepInputs,
    baseBranch,
    targetBranch,
    autoMerge: config.autoMerge,
    mergeMethod: config.mergeMethod,
  });
}
```

```typescript
// inside openPullRequest(...), after `ref` is obtained:
if (params.autoMerge && provider.enableAutoMerge) {
  await provider.enableAutoMerge(ref, params.mergeMethod);
  this.logger.log(
    `git_operation [${stepId}]: enabled provider auto-merge (${params.mergeMethod}) for PR ${ref.url}`,
  );
}

await this.trackingRepo.recordOpenedPullRequest({
  provider: ref.provider,
  owner: ref.owner,
  repo: ref.repo,
  prNumber: ref.number,
  scopeId: triggerContext.repositoryId,
  contextId: triggerContext.worktreeId ?? "",
  workflowRunId,
  headBranch: targetBranch,
  baseBranch,
  prUrl: ref.url,
  autoMerge: params.autoMerge,
  mergeMethod: params.mergeMethod,
});
```

Add `autoMerge: boolean;` and `mergeMethod: MergeMethod;` to the `openPullRequest` params type, and import `MergeMethod` from `../../../common/git/integration/merge-provider.interface`.

Run (expect PASS):

```bash
npm run test --workspace=apps/api -- merge-integrate-git-action.strategy
```

### Step 3.3 (Red) — GitHub adapter `enableAutoMerge`

Extend `github-merge-provider.spec.ts` (Phase 2 file) with a test that octokit's GraphQL/REST auto-merge enablement is invoked with the mapped method. Mirror the existing octokit-mock style in that spec:

```typescript
it("enableAutoMerge enables merge-when-green with the mapped method", async () => {
  // octokitMock per the Phase-2 spec harness
  await provider.enableAutoMerge(
    {
      provider: "github",
      owner: "acme",
      repo: "widgets",
      number: 42,
      url: "https://github.com/acme/widgets/pull/42",
    },
    "squash",
  );

  // GitHub auto-merge is a GraphQL mutation (enablePullRequestAutoMerge);
  // assert the mock was called with mergeMethod SQUASH. Match the actual
  // octokit surface the Phase-2 adapter uses (graphql vs rest).
  expect(octokitMock.graphql).toHaveBeenCalledWith(
    expect.stringContaining("enablePullRequestAutoMerge"),
    expect.objectContaining({ mergeMethod: "SQUASH" }),
  );
});
```

Run (expect FAIL):

```bash
npm run test --workspace=apps/api -- github-merge-provider
```

### Step 3.4 (Green) — implement `enableAutoMerge` in `GitHubMergeProvider`

Add the method, mapping `MergeMethod` → GitHub's enum (`merge`→`MERGE`, `squash`→`SQUASH`, `rebase`→`REBASE`). Use the same octokit instance + node-id resolution the Phase-2 adapter already uses; reuse its credential resolution. Keep it neutral:

```typescript
private readonly autoMergeMethod: Record<MergeMethod, 'MERGE' | 'SQUASH' | 'REBASE'> = {
  merge: 'MERGE',
  squash: 'SQUASH',
  rebase: 'REBASE',
};

async enableAutoMerge(ref: PullRequestRef, method: MergeMethod): Promise<void> {
  const octokit = await this.octokitFor(ref); // Phase-2 helper
  const pullRequestId = await this.resolvePullRequestNodeId(octokit, ref); // GraphQL node id
  await octokit.graphql(
    `mutation($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!) {
       enablePullRequestAutoMerge(input: { pullRequestId: $pullRequestId, mergeMethod: $mergeMethod }) {
         pullRequest { id }
       }
     }`,
    { pullRequestId, mergeMethod: this.autoMergeMethod[method] },
  );
}
```

> Bind `octokitFor` / `resolvePullRequestNodeId` to whatever the Phase-2 adapter actually exposes (helper names may differ — match the merged code). If the Phase-2 adapter caches the PR node id from `openOrUpdatePullRequest`, reuse it; otherwise resolve it from `(owner, repo, number)`.

Run (expect PASS):

```bash
npm run test --workspace=apps/api -- github-merge-provider
npm run build:api
```

### Step 3.5 (Commit)

```bash
git add apps/api/src/workflow/workflow-special-steps/git-actions/merge-integrate-git-action.strategy.ts \
  apps/api/src/workflow/workflow-special-steps/git-actions/merge-integrate-git-action.strategy.spec.ts \
  apps/api/src/common/git/integration/github-merge-provider.ts \
  apps/api/src/common/git/integration/github-merge-provider.spec.ts
git commit -m "feat(api): enable provider auto-merge at PR-open when autoMerge=true

EPIC-209 Phase 5. pull-request strategy calls provider.enableAutoMerge(ref,
method) and records autoMerge/mergeMethod on tracking. GitHub adapter maps the
method to PullRequestMergeMethod via enablePullRequestAutoMerge. autoMerge=false
unchanged. Neutral VCS-domain only.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4 — Persist `auto_merge` + `merge_method` on `pull_request_tracking`

**Files**

- `apps/api/src/common/git/integration/pull-request-tracking.entity.ts` (EDIT — Phase 3 entity, Section 10.4)
- `apps/api/src/common/git/integration/pull-request-tracking.repository.types.ts` (EDIT)
- `apps/api/src/common/git/integration/pull-request-tracking.repository.ts` (EDIT)
- `apps/api/src/common/git/integration/pull-request-tracking.repository.spec.ts` (EDIT)
- `apps/api/src/database/migrations/20260622HHmmss-add-pr-tracking-merge-config.ts` (NEW — replace `HHmmss`; confirm next free timestamp under `apps/api/src/database/migrations/`)
- `apps/api/src/database/migrations/registered-migrations.ts` (EDIT)

**Interfaces**

- Consumes: Task 3 strategy passes `autoMerge` / `mergeMethod` into `recordOpenedPullRequest`.
- Produces: tracking rows carry `auto_merge boolean` + `merge_method varchar`, read by the reconciler (Task 5) so it knows whether/how to API-merge without a kanban round-trip.

### Step 4.1 (Red) — repository round-trips the new fields

Extend `pull-request-tracking.repository.spec.ts`. Add to the `input` fixture `autoMerge: false, mergeMethod: 'merge'` and assert they are persisted on insert:

```typescript
it("persists auto_merge and merge_method on a new row", async () => {
  typeormRepo.findOne.mockResolvedValue(null);

  const row = await repo.recordOpenedPullRequest({
    ...input,
    autoMerge: true,
    mergeMethod: "squash",
  });

  expect(row.auto_merge).toBe(true);
  expect(row.merge_method).toBe("squash");
});

it("updates auto_merge and merge_method on re-run", async () => {
  typeormRepo.findOne.mockResolvedValue({
    id: "existing",
    provider: "github",
    owner: "acme",
    repo: "widgets",
    pr_number: 42,
    state: "open",
    pr_url: "u",
    head_branch: "feature/x",
    base_branch: "main",
    scope_id: "s",
    context_id: "c",
    workflow_run_id: input.workflowRunId,
    merge_commit_sha: null,
    auto_merge: false,
    merge_method: "merge",
  } as never);

  const row = await repo.recordOpenedPullRequest({
    ...input,
    autoMerge: true,
    mergeMethod: "rebase",
  });

  expect(row.auto_merge).toBe(true);
  expect(row.merge_method).toBe("rebase");
});
```

Run (expect FAIL — fields/columns absent):

```bash
npm run test --workspace=apps/api -- pull-request-tracking.repository
```

### Step 4.2 (Green) — entity columns, input type, repository wiring, migration

`pull-request-tracking.entity.ts` — add two columns (default-backfilled `auto_merge=false`, `merge_method='merge'`):

```typescript
import type { MergeMethod, PullRequestState } from './merge-provider.interface';
// ...
@Column({ name: 'auto_merge', type: 'boolean', default: false })
auto_merge!: boolean;

@Column({ name: 'merge_method', type: 'varchar', length: 16, default: 'merge' })
merge_method!: MergeMethod;
```

`pull-request-tracking.repository.types.ts` — add to `RecordOpenedPullRequestInput`:

```typescript
import type { MergeMethod } from "./merge-provider.interface";
// ...
autoMerge: boolean;
mergeMethod: MergeMethod;
```

`pull-request-tracking.repository.ts` — set both fields in the create and the update branches of `recordOpenedPullRequest`:

```typescript
// update branch:
existing.auto_merge = input.autoMerge;
existing.merge_method = input.mergeMethod;
// ...
// create branch:
const created = this.repository.create({
  // ...existing fields...
  auto_merge: input.autoMerge,
  merge_method: input.mergeMethod,
});
```

Migration `20260622HHmmss-add-pr-tracking-merge-config.ts`:

```typescript
import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Add auto_merge + merge_method to pull_request_tracking (EPIC-209 Phase 5).
 * Lets the poll reconciler decide whether to API-merge and with which method
 * without a kanban round-trip. Additive, default-backfilled, boundary-neutral.
 */
export class AddPrTrackingMergeConfig20260622HHmmss implements MigrationInterface {
  public readonly transaction = false as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE pull_request_tracking
        ADD COLUMN IF NOT EXISTS "auto_merge" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "merge_method" varchar(16) NOT NULL DEFAULT 'merge';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE pull_request_tracking
        DROP COLUMN IF EXISTS "merge_method",
        DROP COLUMN IF EXISTS "auto_merge";
    `);
  }
}
```

`registered-migrations.ts` — import + append to `registeredMigrations`.

Run (expect PASS):

```bash
npm run test --workspace=apps/api -- pull-request-tracking.repository
npm run build:api
```

### Step 4.3 (Commit)

```bash
git add apps/api/src/common/git/integration/pull-request-tracking.entity.ts \
  apps/api/src/common/git/integration/pull-request-tracking.repository.ts \
  apps/api/src/common/git/integration/pull-request-tracking.repository.types.ts \
  apps/api/src/common/git/integration/pull-request-tracking.repository.spec.ts \
  apps/api/src/database/migrations/20260622HHmmss-add-pr-tracking-merge-config.ts \
  apps/api/src/database/migrations/registered-migrations.ts
git commit -m "feat(api): persist auto_merge + merge_method on pull_request_tracking

EPIC-209 Phase 5. Additive columns (default false / 'merge') so the reconciler
reads the resolved merge config per PR without a kanban round-trip.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5 — Poll reconciler API-merge branch (`autoMerge === false` + green checks → `mergePullRequest`)

**Files**

- `apps/api/src/common/git/integration/pull-request-poll-reconciler.service.ts` (EDIT — Phase 4 file)
- `apps/api/src/common/git/integration/pull-request-poll-reconciler.service.spec.ts` (EDIT)

**Interfaces**

- Consumes: `PullRequestTrackingRepository.findByState('open')` / the Phase-4 open-row query; `MergeProviderFactory.resolveForRepository(...)` → `MergeProvider`; `getPullRequestStatus(ref)` + `mergePullRequest(ref, method)` (Section 10.1); `isPullRequestMergeable(status)` (Task 1); the row's `auto_merge` / `merge_method` (Task 4).
- Produces: for each tracked open PR — if `auto_merge === false` and `isPullRequestMergeable(status)`, call `mergePullRequest(ref, row.merge_method)`; otherwise observe only. The existing Phase-4 merged-detection path (`state === 'merged'` → emit `pr_merged`) is unchanged.

### Step 5.1 (Red) — three reconciler tests

> Read the Phase-4 reconciler first and bind to its real ctor deps + open-row query method name. The harness below mocks: the tracking repo (open-row listing), the provider factory, a provider, and (for the Phase-4 merged path) the lifecycle emitter. Build a row factory.

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { PullRequestPollReconciler } from "./pull-request-poll-reconciler.service";

function makeRow(
  overrides: Partial<{ auto_merge: boolean; merge_method: string }> = {},
) {
  return {
    id: "row-1",
    provider: "github",
    owner: "acme",
    repo: "widgets",
    pr_number: 42,
    pr_url: "https://github.com/acme/widgets/pull/42",
    head_branch: "feature/x",
    base_branch: "main",
    scope_id: "scope-1",
    context_id: "context-1",
    workflow_run_id: "11111111-1111-1111-1111-111111111111",
    state: "open",
    merge_commit_sha: null,
    auto_merge: overrides.auto_merge ?? false,
    merge_method: overrides.merge_method ?? "merge",
  };
}

function buildReconciler(
  status: { state: string; checks: string; reviewDecision: string },
  row = makeRow(),
) {
  const provider = {
    providerKey: "github",
    openOrUpdatePullRequest: vi.fn(),
    getPullRequestStatus: vi.fn().mockResolvedValue({
      ref: {
        provider: "github",
        owner: "acme",
        repo: "widgets",
        number: 42,
        url: row.pr_url,
      },
      state: status.state,
      checks: status.checks,
      reviewDecision: status.reviewDecision,
      mergeCommitSha: null,
      mergeable: true,
    }),
    mergePullRequest: vi.fn().mockResolvedValue({ mergeCommitSha: "abc123" }),
    enableAutoMerge: vi.fn(),
  };
  const factory = { resolveForRepository: vi.fn().mockReturnValue(provider) };
  const trackingRepo = {
    findOpen: vi.fn().mockResolvedValue([row]), // bind to the Phase-4 method name
    markMerged: vi.fn(), // bind to the Phase-4 merged-write method
  };
  const lifecycleEmitter = { emitPrMerged: vi.fn() }; // bind to Phase-4 emitter
  const reconciler = new PullRequestPollReconciler(
    trackingRepo as never,
    factory as never,
    lifecycleEmitter as never,
  );
  return { reconciler, provider, trackingRepo };
}

describe("PullRequestPollReconciler API-merge branch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("autoMerge=false + green checks: API-merges with the row merge_method", async () => {
    const { reconciler, provider } = buildReconciler(
      { state: "open", checks: "passing", reviewDecision: "approved" },
      makeRow({ auto_merge: false, merge_method: "squash" }),
    );

    await reconciler.reconcileOnce();

    expect(provider.mergePullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ number: 42 }),
      "squash",
    );
  });

  it("autoMerge=false + failing checks: does NOT merge", async () => {
    const { reconciler, provider } = buildReconciler({
      state: "open",
      checks: "failing",
      reviewDecision: "approved",
    });

    await reconciler.reconcileOnce();

    expect(provider.mergePullRequest).not.toHaveBeenCalled();
  });

  it("autoMerge=false + pending checks: does NOT merge", async () => {
    const { reconciler, provider } = buildReconciler({
      state: "open",
      checks: "pending",
      reviewDecision: "review_required",
    });

    await reconciler.reconcileOnce();

    expect(provider.mergePullRequest).not.toHaveBeenCalled();
  });

  it("autoMerge=false + changes_requested (even with green checks): does NOT merge", async () => {
    const { reconciler, provider } = buildReconciler({
      state: "open",
      checks: "passing",
      reviewDecision: "changes_requested",
    });

    await reconciler.reconcileOnce();

    expect(provider.mergePullRequest).not.toHaveBeenCalled();
  });

  it("autoMerge=true: never API-merges (provider-native auto-merge owns it)", async () => {
    const { reconciler, provider } = buildReconciler(
      { state: "open", checks: "passing", reviewDecision: "approved" },
      makeRow({ auto_merge: true, merge_method: "merge" }),
    );

    await reconciler.reconcileOnce();

    expect(provider.mergePullRequest).not.toHaveBeenCalled();
  });
});
```

Run (expect FAIL — `reconcileOnce` has no API-merge branch yet):

```bash
npm run test --workspace=apps/api -- pull-request-poll-reconciler
```

> If the Phase-4 reconciler exposes its tick under a different public name than `reconcileOnce`, rename the test calls to match; expose a `reconcileOnce()` if Phase 4 only had a private `@Interval` handler (extract the body into a testable method that the `@Interval` method calls).

### Step 5.2 (Green) — add the merge-decision branch

In the reconciler's per-row loop (after fetching `status = await provider.getPullRequestStatus(ref)`), before/around the existing merged-state handling, add:

```typescript
import { isPullRequestMergeable } from "./merge-provider.helpers";
import type { MergeMethod } from "./merge-provider.interface";
// ...

// Phase-4 merged-detection path stays first (idempotent close on observed merge).
if (status.state === "merged") {
  // ...existing Phase-4 emit pr_merged + markMerged...
  return;
}

// Phase-5 API-merge decision: only when the engine owns the merge.
if (!row.auto_merge && isPullRequestMergeable(status)) {
  const method = row.merge_method as MergeMethod;
  await provider.mergePullRequest(status.ref, method);
  this.logger.log(
    `pr-reconciler: API-merged PR ${row.pr_url} (${method}); awaiting merged observation`,
  );
  // Do NOT flip state here — the next tick / webhook observes state==='merged'
  // and runs the single idempotent close path. (Convergent with Phase 4.)
  return;
}
```

> **Do not** short-circuit the Phase-4 merged path: API-merge only requests the merge; the observed-merge close (emit `core.integration.pr_merged.v1`, set `merge_commit_sha`, flip `state`) remains the single source of truth so webhook and poll converge. When `auto_merge === true`, the branch is skipped and the engine merely observes.

Run (expect PASS):

```bash
npm run test --workspace=apps/api -- pull-request-poll-reconciler
npm run build:api
```

### Step 5.3 (Commit)

```bash
git add apps/api/src/common/git/integration/pull-request-poll-reconciler.service.ts \
  apps/api/src/common/git/integration/pull-request-poll-reconciler.service.spec.ts
git commit -m "feat(api): reconciler API-merges green PRs when autoMerge=false

EPIC-209 Phase 5. Per tracked open PR: if auto_merge=false and checks are green
(isPullRequestMergeable), call mergePullRequest(ref, merge_method). Failing/
pending checks or changes_requested -> no merge. autoMerge=true -> observe only.
Merged-state close stays the single idempotent path. Neutral VCS-domain only.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6 — `LifecycleMergeMetadata` contract type (kanban-contracts)

**Files**

- `packages/kanban-contracts/src/work-item-merge-metadata.types.ts` (NEW)
- `packages/kanban-contracts/src/work-item-merge-metadata.spec.ts` (NEW)
- `packages/kanban-contracts/src/index.ts` (EDIT — export)

**Interfaces**

- Consumes: nothing.
- Produces: `LifecycleMergeMetadata` (the read shape of `metadata.lifecycle.merge` PR observations) + `readLifecycleMergeMetadata(metadata)` guard, consumed by the kanban stalled-PR helper (Task 7). Neutral on the contracts side: this is the VCS observation snapshot the API reconciler writes onto the item; kanban only reads it.

### Step 6.1 (Red) — guard contract test

`work-item-merge-metadata.spec.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { readLifecycleMergeMetadata } from "./work-item-merge-metadata.types";

describe("readLifecycleMergeMetadata", () => {
  it("extracts checks/reviewDecision/openedAt/prUrl from lifecycle.merge", () => {
    const meta = readLifecycleMergeMetadata({
      lifecycle: {
        merge: {
          status: "pull_request_opened",
          strategy: "pull-request",
          prUrl: "https://github.com/acme/widgets/pull/42",
          checks: "failing",
          reviewDecision: "changes_requested",
          openedAt: "2026-06-22T00:00:00.000Z",
        },
      },
    });
    expect(meta).toEqual({
      prUrl: "https://github.com/acme/widgets/pull/42",
      checks: "failing",
      reviewDecision: "changes_requested",
      openedAt: "2026-06-22T00:00:00.000Z",
    });
  });

  it("returns null when there is no PR merge metadata", () => {
    expect(
      readLifecycleMergeMetadata({
        lifecycle: { merge: { status: "succeeded" } },
      }),
    ).toBeNull();
    expect(readLifecycleMergeMetadata(null)).toBeNull();
    expect(readLifecycleMergeMetadata(undefined)).toBeNull();
    expect(readLifecycleMergeMetadata({})).toBeNull();
  });

  it("tolerates partial fields (unknown checks, missing review)", () => {
    const meta = readLifecycleMergeMetadata({
      lifecycle: {
        merge: {
          strategy: "pull-request",
          prUrl: "u",
          openedAt: "2026-06-22T00:00:00.000Z",
        },
      },
    });
    expect(meta).toEqual({
      prUrl: "u",
      checks: "unknown",
      reviewDecision: "none",
      openedAt: "2026-06-22T00:00:00.000Z",
    });
  });
});
```

Run (expect FAIL):

```bash
npm run test --workspace=apps/kanban -- work-item-merge-metadata
```

> If `packages/kanban-contracts` exposes its own Vitest `test` script, run it there instead; otherwise the spec runs via the kanban workspace which compiles the contracts. Confirm the package's `scripts` before running.

### Step 6.2 (Green) — type + guard

`work-item-merge-metadata.types.ts`:

```typescript
/** VCS-neutral PR observation snapshot the API reconciler records onto a work
 *  item's metadata.lifecycle.merge. Kanban reads this; it never queries the
 *  provider directly. */
export interface LifecycleMergeMetadata {
  prUrl: string;
  checks: "pending" | "passing" | "failing" | "unknown";
  reviewDecision: "approved" | "changes_requested" | "review_required" | "none";
  openedAt: string; // ISO 8601
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const CHECKS = new Set(["pending", "passing", "failing", "unknown"]);
const REVIEW = new Set([
  "approved",
  "changes_requested",
  "review_required",
  "none",
]);

export function readLifecycleMergeMetadata(
  metadata: unknown,
): LifecycleMergeMetadata | null {
  if (!isRecord(metadata)) return null;
  const lifecycle = metadata["lifecycle"];
  if (!isRecord(lifecycle)) return null;
  const merge = lifecycle["merge"];
  if (!isRecord(merge)) return null;
  const prUrl = merge["prUrl"];
  const openedAt = merge["openedAt"];
  if (typeof prUrl !== "string" || typeof openedAt !== "string") return null;

  const checksRaw = merge["checks"];
  const reviewRaw = merge["reviewDecision"];
  return {
    prUrl,
    openedAt,
    checks:
      typeof checksRaw === "string" && CHECKS.has(checksRaw)
        ? (checksRaw as LifecycleMergeMetadata["checks"])
        : "unknown",
    reviewDecision:
      typeof reviewRaw === "string" && REVIEW.has(reviewRaw)
        ? (reviewRaw as LifecycleMergeMetadata["reviewDecision"])
        : "none",
  };
}
```

Export both from `packages/kanban-contracts/src/index.ts`.

Run (expect PASS):

```bash
npm run test --workspace=apps/kanban -- work-item-merge-metadata
npm run build --workspace=packages/kanban-contracts
```

### Step 6.3 (Commit)

```bash
git add packages/kanban-contracts/src/work-item-merge-metadata.types.ts \
  packages/kanban-contracts/src/work-item-merge-metadata.spec.ts \
  packages/kanban-contracts/src/index.ts
git commit -m "feat(kanban-contracts): LifecycleMergeMetadata read shape + guard

EPIC-209 Phase 5. Neutral PR-observation snapshot (prUrl/checks/reviewDecision/
openedAt) the API records onto lifecycle.merge; kanban reads it to surface
stalled PRs. Tolerant guard defaults checks=unknown / review=none.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7 — CEO stalled-PR signal in the strategic fact snapshot (kanban-side)

**Files**

- `apps/kanban/src/orchestration/strategic/stalled-pull-request.helpers.ts` (NEW — `STALLED_PR_AGE_MS` + `computeStalledPullRequests`)
- `apps/kanban/src/orchestration/strategic/stalled-pull-request.helpers.spec.ts` (NEW)
- `apps/kanban/src/orchestration/strategic/project-strategic-state.types.ts` (EDIT — add `stalledPullRequests` + `StalledPullRequest`)
- `apps/kanban/src/orchestration/strategic/project-strategic-state.service.ts` (EDIT)
- `apps/kanban/src/orchestration/strategic/project-strategic-state.service.spec.ts` (EDIT)

**Interfaces**

- Consumes: `readLifecycleMergeMetadata` + `LifecycleMergeMetadata` (Task 6); work items with `status === 'awaiting-pr-merge'` (Phase 3 status).
- Produces: `StrategicStaleness.stalledPullRequests: StalledPullRequest[]` — surfaced through `ProjectStateTool` under `strategic.staleness` (already wired). A healthy open PR is absent; a red / changes-requested / over-age PR is present and CEO-actionable.

### Step 7.1 (Red) — pure helper tests

`stalled-pull-request.helpers.spec.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  STALLED_PR_AGE_MS,
  computeStalledPullRequests,
} from "./stalled-pull-request.helpers";

const NOW = new Date("2026-06-22T12:00:00.000Z").getTime();

function item(
  id: string,
  status: string,
  merge: Record<string, unknown> | null,
) {
  return {
    id,
    title: `item ${id}`,
    status,
    metadata: merge ? { lifecycle: { merge } } : null,
  } as never;
}

const HEALTHY = {
  status: "pull_request_opened",
  strategy: "pull-request",
  prUrl: "https://github.com/acme/widgets/pull/1",
  checks: "passing",
  reviewDecision: "approved",
  openedAt: new Date(NOW - 60_000).toISOString(), // 1 min old
};

describe("computeStalledPullRequests", () => {
  it("exposes STALLED_PR_AGE_MS as a named 24h constant", () => {
    expect(STALLED_PR_AGE_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("excludes a healthy, fresh, green open PR", () => {
    const result = computeStalledPullRequests(
      [item("wi-1", "awaiting-pr-merge", HEALTHY)],
      NOW,
    );
    expect(result).toEqual([]);
  });

  it("flags a PR with failing checks", () => {
    const result = computeStalledPullRequests(
      [item("wi-2", "awaiting-pr-merge", { ...HEALTHY, checks: "failing" })],
      NOW,
    );
    expect(result).toEqual([
      {
        id: "wi-2",
        title: "item wi-2",
        prUrl: HEALTHY.prUrl,
        reason: "red_checks",
      },
    ]);
  });

  it("flags a PR with changes_requested", () => {
    const result = computeStalledPullRequests(
      [
        item("wi-3", "awaiting-pr-merge", {
          ...HEALTHY,
          reviewDecision: "changes_requested",
        }),
      ],
      NOW,
    );
    expect(result[0]).toMatchObject({
      id: "wi-3",
      reason: "changes_requested",
    });
  });

  it("flags a green PR that has been open beyond STALLED_PR_AGE_MS", () => {
    const result = computeStalledPullRequests(
      [
        item("wi-4", "awaiting-pr-merge", {
          ...HEALTHY,
          openedAt: new Date(NOW - STALLED_PR_AGE_MS - 1).toISOString(),
        }),
      ],
      NOW,
    );
    expect(result[0]).toMatchObject({ id: "wi-4", reason: "stale_open" });
  });

  it("ignores items that are not awaiting-pr-merge", () => {
    const result = computeStalledPullRequests(
      [item("wi-5", "in-progress", { ...HEALTHY, checks: "failing" })],
      NOW,
    );
    expect(result).toEqual([]);
  });

  it("ignores awaiting-pr-merge items without PR merge metadata", () => {
    const result = computeStalledPullRequests(
      [item("wi-6", "awaiting-pr-merge", null)],
      NOW,
    );
    expect(result).toEqual([]);
  });
});
```

Run (expect FAIL):

```bash
npm run test --workspace=apps/kanban -- stalled-pull-request.helpers
```

### Step 7.2 (Green) — helper + threshold constant

`stalled-pull-request.helpers.ts`:

```typescript
import { readLifecycleMergeMetadata } from "@nexus/kanban-contracts";

/** A PR open past this age (and not yet merged) is surfaced to the CEO as
 *  actionable even when its checks are green — it is not progressing. 24h. */
export const STALLED_PR_AGE_MS = 24 * 60 * 60 * 1000;

const AWAITING_PR_MERGE = "awaiting-pr-merge";

export type StalledPullRequestReason =
  | "red_checks"
  | "changes_requested"
  | "stale_open";

export interface StalledPullRequest {
  id: string;
  title: string;
  prUrl: string;
  reason: StalledPullRequestReason;
}

interface StalledWorkItemInput {
  id: string;
  title: string;
  status: string;
  metadata: unknown;
}

/**
 * Pure CEO stalled-PR detector. An `awaiting-pr-merge` item with PR merge
 * metadata is stalled when its checks are red, a reviewer requested changes, or
 * it has been open beyond STALLED_PR_AGE_MS. Healthy, fresh, green PRs are
 * excluded so the snapshot only flags CEO-actionable PRs.
 */
export function computeStalledPullRequests(
  items: ReadonlyArray<StalledWorkItemInput>,
  nowMs: number = Date.now(),
): StalledPullRequest[] {
  const stalled: StalledPullRequest[] = [];
  for (const item of items) {
    if (item.status !== AWAITING_PR_MERGE) continue;
    const merge = readLifecycleMergeMetadata(item.metadata);
    if (merge === null) continue;

    const reason = classify(merge, nowMs);
    if (reason !== null) {
      stalled.push({
        id: item.id,
        title: item.title,
        prUrl: merge.prUrl,
        reason,
      });
    }
  }
  return stalled;
}

function classify(
  merge: ReturnType<typeof readLifecycleMergeMetadata> & object,
  nowMs: number,
): StalledPullRequestReason | null {
  if (merge.checks === "failing") return "red_checks";
  if (merge.reviewDecision === "changes_requested") return "changes_requested";
  const openedMs = Date.parse(merge.openedAt);
  if (Number.isFinite(openedMs) && nowMs - openedMs > STALLED_PR_AGE_MS) {
    return "stale_open";
  }
  return null;
}
```

`project-strategic-state.types.ts` — add the type + field:

```typescript
import type { StalledPullRequest } from "./stalled-pull-request.helpers";

export type StrategicStaleness = {
  // ...existing fields...
  stalledPullRequests: StalledPullRequest[];
};
```

> Add `stalledPullRequests: []` to the `EMPTY_STALENESS` constant in `project-strategic-state.service.ts` (the no-orchestration branch) to keep the type satisfied.

### Step 7.3 (Red→Green) — service populates the field

Extend `project-strategic-state.service.spec.ts` with a case asserting a red `awaiting-pr-merge` item appears and a healthy one does not:

```typescript
it("surfaces stalled PRs in staleness, excludes healthy open PRs", async () => {
  // arrange the repo mock to return one red awaiting-pr-merge item and one
  // healthy awaiting-pr-merge item (mirror the existing spec's item fixtures).
  const state = await service.buildStrategicState(projectId, []);
  expect(state.staleness.stalledPullRequests).toHaveLength(1);
  expect(state.staleness.stalledPullRequests[0]).toMatchObject({
    reason: "red_checks",
  });
});
```

Run (expect FAIL), then wire the service (`buildStrategicState`): after loading `items`, compute and attach the field:

```typescript
import { computeStalledPullRequests } from "./stalled-pull-request.helpers";
// ...
const staleness: StrategicStaleness = {
  // ...existing fields...
  stalledPullRequests: computeStalledPullRequests(
    items.map((i) => ({
      id: i.id,
      title: i.title,
      status: i.status,
      metadata: i.metadata,
    })),
  ),
};
```

> Confirm `KanbanWorkItemEntity` exposes `title` and `metadata` — bind the mapping to the entity's actual property names. The `computeStalledPullRequests` default `nowMs = Date.now()` keeps the service call side-effect-free in production; the helper spec injects `nowMs` for determinism.

Run (expect PASS):

```bash
npm run test --workspace=apps/kanban -- project-strategic-state
npm run test --workspace=apps/kanban -- stalled-pull-request.helpers
npm run build:kanban
npm run build --workspace=packages/kanban-contracts
```

### Step 7.4 — confirm `ProjectStateTool` surfaces it (type-only)

`project-state.tool.ts` returns `strategic.staleness` verbatim, so widening `StrategicStaleness` flows through with no code change. Confirm the build:

```bash
npm run build:kanban
```

### Step 7.5 (Commit)

```bash
git add apps/kanban/src/orchestration/strategic/stalled-pull-request.helpers.ts \
  apps/kanban/src/orchestration/strategic/stalled-pull-request.helpers.spec.ts \
  apps/kanban/src/orchestration/strategic/project-strategic-state.types.ts \
  apps/kanban/src/orchestration/strategic/project-strategic-state.service.ts \
  apps/kanban/src/orchestration/strategic/project-strategic-state.service.spec.ts
git commit -m "feat(kanban): surface stalled PRs to the CEO strategic fact snapshot

EPIC-209 Phase 5. awaiting-pr-merge items with red checks / changes_requested /
open beyond STALLED_PR_AGE_MS (24h) appear in staleness.stalledPullRequests;
healthy open PRs do not. Read from lifecycle.merge; never queries the provider.
Kanban-side only.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8 — Seed workflow: make `quality_gate` conditional on `preflightGate`

**Files**

- `seed/workflows/work-item-ready-to-merge-default.workflow.yaml` (EDIT)

**Interfaces**

- Consumes: neutral trigger key `{{ trigger.integration_preflight_gate }}` (Section 10.6, forwarded by Phase 1 kanban side; absent ⇒ defaults to `true` per the resolver).
- Produces: when `integration_preflight_gate` is `false` (and only on the `pull-request` strategy), `merge_prepare` transitions directly to `merge_integrate`; otherwise the existing `quality_gate` runs. `direct-push` always runs `quality_gate` (it has no provider gate-of-record).

### Step 8.1 — author the conditional transition (validated by `validate:seed-data`)

The cleanest split is at the `merge_prepare` → next transition. Today `merge_prepare` (clean) goes to `quality_gate`. Add a higher-priority transition that, **only when the strategy is `pull-request` AND the pre-flight gate is disabled**, skips straight to `merge_integrate`. Keep all other `merge_prepare` transitions (conflict / auth_error / failed) untouched.

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
    # Pre-flight gate disabled (PR repos only): skip the in-container gate and
    # let the provider's required checks be the gate of record.
    - condition: >-
        jobs.merge_prepare.output.merge_outcome == 'succeeded' &&
        trigger.integration_strategy == 'pull-request' &&
        trigger.integration_preflight_gate == false
      next: merge_integrate
    - condition: "jobs.merge_prepare.output.merge_outcome == 'succeeded'"
      next: quality_gate
    - condition: "jobs.merge_prepare.output.merge_outcome == 'conflict'"
      next: resolve_local_conflicts
    - condition: "jobs.merge_prepare.output.merge_outcome == 'auth_error'"
      next: emit_merge_failed
    - condition: "jobs.merge_prepare.output.merge_outcome == 'failed'"
      next: emit_merge_failed
```

Also forward the three PR-strategy inputs onto the `merge_integrate` job so the strategy resolver (Phase 3) sees them on this path too (they were already added to `merge_integrate` in Phase 3 Task 10; ensure `integration_preflight_gate` is present alongside `integration_strategy`, `integration_merge_method`, `integration_auto_merge`):

```yaml
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
    integration_strategy: "{{ trigger.integration_strategy }}"
    integration_merge_method: "{{ trigger.integration_merge_method }}"
    integration_auto_merge: "{{ trigger.integration_auto_merge }}"
    integration_preflight_gate: "{{ trigger.integration_preflight_gate }}"
    repository_url: "{{ trigger.repository_url }}"
    github_secret_id: "{{ trigger.github_secret_id }}"
  # transitions unchanged from Phase 3 (succeeded / pull_request_opened / conflict / auth_error / failed)
```

> **`depends_on` caveat:** `merge_integrate` currently declares `depends_on: [quality_gate]`. When the pre-flight-skip transition routes `merge_prepare → merge_integrate`, `quality_gate` is condition-skipped. Confirm the engine treats a condition-skipped dependency as satisfied for `depends_on` (the existing remediation branches already rely on skipped siblings). If `depends_on: [quality_gate]` would block on the skip path, change it to `depends_on: [merge_prepare]` (the real upstream on both paths) — read the DAG/dependency-resolution code before deciding, and prefer the minimal change that keeps both paths valid. Do NOT remove the dependency wholesale.
> `direct-push` repos never satisfy the skip condition (`integration_strategy != 'pull-request'`), so their `quality_gate` always runs — byte-for-byte unchanged.

### Step 8.2 — validate

```bash
npm run validate:seed-data
```

Expected: PASS (DAG resolves on both the gated and gate-skipped PR paths and the unchanged direct-push path).

### Step 8.3 (Commit)

```bash
git add seed/workflows/work-item-ready-to-merge-default.workflow.yaml
git commit -m "feat(seed): make pre-flight quality gate conditional on preflightGate

EPIC-209 Phase 5. pull-request repos with integration_preflight_gate=false skip
the in-container quality_gate (provider checks are the gate of record); all
other paths and direct-push unchanged. Forwards merge config inputs onto
merge_integrate.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9 — Full regression sweep + boundary lint

**Files** — none (verification only).

```bash
npm run build --workspace=packages/kanban-contracts
npm run build:api
npm run build:kanban
npm run build --workspace=apps/web
npm run test --workspace=apps/api
npm run test --workspace=apps/kanban
npm run lint:api
npm run lint:kanban
npm run validate:seed-data
```

Expected: all green. Confirm `nexus-boundaries/no-core-kanban-residue` raises **no** finding against the API-side Phase-5 files (`merge-provider.helpers.ts`, the reconciler edit, the tracking columns/migration, the strategy auto-merge edit) — they carry only `scopeId` / `contextId` and VCS terms (`checks`, `mergeMethod`, `autoMerge`, `provider`, `pr_number`). If it flags anything, fix the residue in code — do not add an allowlist or `eslint-disable`. The kanban stalled-PR helper and the `LifecycleMergeMetadata` read-shape are correctly kanban/contracts-side.

Explicit acceptance checklist (each backed by a test above):

- `preflightGate=false` (PR repo) skips the gate → **Task 8** seed transition (validated by `validate:seed-data`).
- `autoMerge=false` + green checks → `mergePullRequest` called with the configured method → **Task 5** test 1.
- `autoMerge=false` + failing/pending/changes_requested → NOT merged → **Task 5** tests 2–4.
- `autoMerge=true` → provider auto-merge enabled (**Task 3**) and reconciler does NOT call `mergePullRequest` (**Task 5** test 5).
- A stalled PR (red checks) appears in the CEO snapshot while a healthy open PR does not → **Task 7** helper + service tests.

Final commit if any lint-driven fixes were needed:

```bash
git add -A
git commit -m "chore(epic-209): phase 5 regression sweep and boundary verification

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes on decisions deliberately deferred

- **Writing the PR observation snapshot (`checks`/`reviewDecision`/`openedAt`) onto `lifecycle.merge`:** this is the data feed Task 7 reads. Phase 3 already records `prUrl` + `openedAt` (PR-open time) into `lifecycle.merge`; the **reconciler-side write of live `checks`/`reviewDecision`** belongs to Phase 4's observation path. If Phase 4 did not yet persist those onto the item, add a minimal metadata-patch on each reconcile tick (API-side emits the existing neutral lifecycle/metadata event; kanban applies it) — keep it boundary-clean (the API emits neutral fields; kanban's existing patch handler stores them). Verify against the merged Phase 4 before assuming it exists; if absent, add it as a small Red/Green micro-cycle on the reconciler (write observed `checks`/`reviewDecision` via the Phase-4 emitter) **before** Task 7's service wiring can show non-empty results live.
- **`merge_method` validation at config time:** the resolver (Phase 1) already validates the enum; no Phase-5 change.
- **Re-dispatch of stalled PRs:** explicitly NOT added — the CEO decides actions from the snapshot; Phase 5 only surfaces. No automatic re-dispatch of `awaiting-pr-merge` (spec Decision 6).
- **Docs (`docs/guide`, settings descriptions):** update opportunistically to document `auto_merge` / `merge_method` / `preflight_gate` per-repo config; doc-only, not gated by a test.

---

## Phase boundary — what Phase 6 consumes from Phase 5

Phase 5 leaves three provider-agnostic seams Phase 6 (GitLab + Bitbucket adapters) consumes unchanged:

1. **`MergeProvider.enableAutoMerge?(ref, method)` + `mergePullRequest(ref, method)`** are the only merge-decision entry points. A Phase-6 adapter implements them (or omits `enableAutoMerge` to degrade to reconciler API-merge) behind the same `MergeProvider` interface; the reconciler's `isPullRequestMergeable` gate and `auto_merge`/`merge_method` row fields require **zero** change.
2. **The poll reconciler's merge-decision branch** is provider-neutral (`MergeProviderFactory.resolveForRepository` selects the adapter; the branch reads `getPullRequestStatus().checks`/`reviewDecision`). Phase 6 only adds adapters + per-provider webhook ingress; the decision logic is settled.
3. **The kanban stalled-PR signal** reads `lifecycle.merge` (`checks`/`reviewDecision`/`openedAt`), which is provider-agnostic. Any Phase-6 provider that maps its native check/review state into the neutral `PullRequestChecksStatus` / review enum surfaces stalled PRs to the CEO with no kanban change.

`direct-push` repositories remain byte-for-byte unchanged at every Phase-5 step.
