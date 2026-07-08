# Design: Pull-Request-Based Integration Strategy (EPIC-209)

**Date:** 2026-06-22
**Epic:** EPIC-209
**Status:** Approved — ready for implementation planning
**Related review:** Architecture review of git repository / branch / worktree management (2026-06-22), recommendation 5.

---

## 1. Purpose

Today the Nexus orchestration engine is the **sole merge authority**. When a work item reaches
`ready-to-merge`, the `work-item-ready-to-merge-default` workflow merges base → feature in a worktree,
runs an in-container quality gate, then merges feature → base in the shared clone and **pushes directly
to the base branch** (`git -c core.hooksPath=/dev/null push`). This is correct for local / airgapped /
provider-less repositories and remains the default.

This design adds an **opt-in, per-repository `pull-request` integration strategy**: for hosted
repositories (GitHub first), the engine pushes the feature branch and **opens a pull request** instead
of pushing to the base branch. The provider's required checks and branch protection become the gate of
record; the work item moves to a new `awaiting-pr-merge` state and transitions to `done` only when the
PR is observed merged.

`direct-push` repositories must remain **byte-for-byte unchanged** at every phase.

---

## 2. Design Decisions (resolved)

| #   | Decision                                       | Choice                                                                                                                                                                                                           |
| --- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Lifecycle state for "PR open"                  | **New distinct status `awaiting-pr-merge`** between `ready-to-merge` and `done`. Existing `in-review` (active group, pre-merge-ready) is left untouched.                                                         |
| 2   | PR-merged detection                            | **Webhook (secret-verified) primary + polling reconciler fallback.** Both converge on the same idempotent state.                                                                                                 |
| 3   | Merge timing                                   | **Configurable `auto_merge`, default off (API-merge).** Default: Nexus calls `mergePullRequest()` once required checks are observed green. `auto_merge=on`: enable provider-native merge-when-green and observe. |
| 4   | Pre-flight in-container gate                   | **Configurable `preflight_gate`, default on (fail-fast).** Avoids opening obviously-broken PRs; can be disabled to avoid double execution against provider CI.                                                   |
| 5   | Conflict handling                              | **Keep `merge_prepare`** — resolve base→feature conflicts in the worktree first so the PR opens already-mergeable. Reuses existing conflict-resolution remediation.                                              |
| 6   | Orchestration treatment of `awaiting-pr-merge` | **Not-stuck + surface stalled PRs.** Never re-dispatch or flag stuck on age alone, but surface red checks / changes-requested / over-threshold PRs to the CEO.                                                   |
| 7   | Config storage                                 | **Extend `repository_workflow_settings` JSONB** with an `integration` sub-object on `KanbanProjectEntity`. No new column; consistent with existing per-repo workflow gating.                                     |

---

## 3. Core/Kanban Boundary — Data Flow

The central constraint (`CLAUDE.md` → Core/Kanban Boundary): **git/provider mechanics stay API-side; the
lifecycle state machine and config storage stay kanban-side; the API/core layer must contain no kanban
domain identifiers.** The strategy values (`direct-push` / `pull-request`), PR mechanics, and provider
adapters are **VCS-domain, not kanban-domain**, so they are boundary-legal API-side. Config _storage_
and _lifecycle state_ are kanban-side.

```
                       KANBAN-SIDE                                  API-SIDE
                       (lifecycle + config storage)                (git/provider mechanics)

repository_workflow_settings.integration  ──forward as neutral──►  trigger inputs
  { strategy, merge_method,                  git-domain fields      (integration_strategy, ...)
    auto_merge, preflight_gate }             on ready-to-merge            │
                                             trigger payload              ▼
                                                                  IntegrationStrategyResolver
                                                                  (validate enum, default direct-push)
                                                                         │
                                                                         ▼
                                                                  git_operation: merge_integrate
                                                                   ├─ direct-push → merge→base, push (today)
                                                                   └─ pull-request → push feature branch
                                                                        → MergeProvider.openOrUpdatePullRequest()
                                                                        → persist PR-tracking row
                                                                        → return PR URL/number
                                                                         │
   work_item_patch_metadata (MCP) ◄──────── workflow records PR URL ─────┤
   transition ready-to-merge → awaiting-pr-merge ◄──────────────────────-┘

                                            ┌──── webhook (secret-verified) ────┐
                                            │     poll reconciler (fallback)     │
                                            ▼                                    │
                                     PR observed merged ─────────────────────────┘
                                            │
   core-lifecycle-stream.consumer  ◄── emit core.integration.pr_merged.v1 ───────
   (scopeId, contextId, mergeCommit)        (neutral lifecycle event)
            │
            ▼
   transition awaiting-pr-merge → done
   record mergeCommit in lifecycle.merge
```

**Why a PR-tracking row (API-side, neutral):** the webhook/poll path receives a `(provider, owner, repo,
pr_number)` and must map it back to a work item. The workflow that opened the PR knows
`scopeId`/`contextId`, so it persists `(provider, owner, repo, pr_number) → { scopeId, contextId,
workflow_run_id, head, base, status }`. The webhook/poll reconciler looks up this row and emits the
neutral `pr_merged` lifecycle event. No kanban identifiers cross into API/core.

---

## 4. Components

### 4.1 API-side (new)

- **`MergeProvider` interface** — `openOrUpdatePullRequest(args)`, `getPullRequestStatus(ref)`,
  `mergePullRequest(ref, method)`. Stable contract selected by repository config.
- **`GitHubMergeProvider`** — octokit-backed adapter. Credentials resolved from `github_secret_id` via
  an extension of the existing secret-store + `GitAuthEnvResolverService` pattern.
- **Provider factory** — resolves the adapter from config / `repository_url`; GitLab + Bitbucket added
  in Phase 6 behind the same interface.
- **`IntegrationStrategyResolver`** — reads neutral step inputs, validates the strategy enum, defaults to
  `direct-push`.
- **PR-tracking entity + migration** — neutral table joining `(provider, owner, repo, pr_number)` to
  `{ scopeId, contextId, workflow_run_id, head, base, status }`.
- **PR webhook controller** — secret-verified ingress for PR events; idempotent.
- **PR poll reconciler** — periodic check of open tracked PRs; convergent fallback for missed webhooks.
- **`core.integration.pr_merged.v1`** — new neutral core lifecycle event (scopeId, contextId,
  mergeCommit, prUrl).

### 4.2 Kanban-side (new)

- **`awaiting-pr-merge` status** — added to `WorkItemStatusSchema`, `WORK_ITEM_STATUS_GROUPS`, transition
  validation, and the web board UI.
- **`integration` sub-object** on `RepositoryWorkflowSettings` (`packages/kanban-contracts`) + resolver
  (default `direct-push`) + forwarding into the `ready-to-merge` trigger payload.
- **`pr_merged` consumer handler** in `core-lifecycle-stream.consumer` → transition
  `awaiting-pr-merge → done` and record `mergeCommit` in `lifecycle.merge`.
- **Stalled-PR signal** — orchestration fact snapshot marks `awaiting-pr-merge` as in-flight (not stuck),
  and flags red-checks / changes-requested / over-threshold PRs as CEO-actionable.

### 4.3 Workflow / seed

- `work-item-ready-to-merge-default.workflow.yaml` gains a strategy branch after `merge_prepare` +
  pre-flight gate: `direct-push` keeps the current `merge_integrate`; `pull-request` pushes the feature
  branch, opens/updates the PR, records metadata, and transitions to `awaiting-pr-merge`.

---

## 5. Existing Infrastructure We Build On

| Existing                                                                                                      | Location                                                                                    |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `GitMergeService` (`prepareMergeInWorktree` / `integrateAndPush`)                                             | `apps/api/src/common/git/git-merge.service.ts`                                              |
| `git_operation` handler + action union                                                                        | `apps/api/src/workflow/workflow-special-steps/step-git-operation-special-step.handler.ts`   |
| `MergeBranchResolverService`                                                                                  | `apps/api/src/workflow/workflow-special-steps/git-actions/merge-branch-resolver.service.ts` |
| Merge action strategies (`merge-prepare`, `merge-integrate`)                                                  | `apps/api/src/workflow/workflow-special-steps/git-actions/`                                 |
| Failure classification (`isPrePushHookFailure`, `isPushRejected`, `classifyAuthError`, `quality_gate_failed`) | `apps/api/src/common/git/git-merge.helpers.ts`                                              |
| `GitAuthEnvResolverService`                                                                                   | `apps/api/src/common/git/git-auth-env-resolver.service.ts`                                  |
| Ready-to-merge workflow + bounded remediation                                                                 | `seed/workflows/work-item-ready-to-merge-default.workflow.yaml`                             |
| `KanbanProjectEntity` (`repository_url`, `base_path`, `github_secret_id`, `repository_workflow_settings`)     | `apps/kanban/src/database/entities/kanban-project.entity.ts`                                |
| `RepositoryWorkflowSettings` types                                                                            | `packages/kanban-contracts/src/repository-workflow-settings.types.ts`                       |
| Work-item statuses + groups                                                                                   | `packages/kanban-contracts/src/work-item.schema.ts`                                         |
| Transition + metadata-patch MCP tools                                                                         | `apps/kanban/src/mcp/tools/mutation/`                                                       |
| Core lifecycle stream consumer                                                                                | `apps/kanban/src/core/core-lifecycle-stream.consumer.ts`                                    |
| Kanban lifecycle event publisher                                                                              | `apps/kanban/src/work-item/kanban-lifecycle-event-publisher.ts`                             |

No existing octokit / GitHub API usage — Phase 2 introduces the dependency.

---

## 6. Phased Delivery

| Phase | Scope                                                                                                                                                                           | Outcome                                     |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **1** | `MergeProvider` interface + `IntegrationStrategyResolver`; `integration` config sub-object (type + resolver + trigger forwarding), default `direct-push`                        | Strategy selectable; zero behaviour change  |
| **2** | `GitHubMergeProvider` adapter + `github_secret_id` credential resolution + provider factory                                                                                     | Open/inspect/merge PRs via API              |
| **3** | `merge_integrate` strategy branch (push feature + open/update PR), PR-tracking entity + migration, `awaiting-pr-merge` status, workflow DAG branch, PR URL in `lifecycle.merge` | PR repos route through review               |
| **4** | PR webhook controller (secret-verified) + poll reconciler + `core.integration.pr_merged.v1` + kanban consumer transition                                                        | Lifecycle closes on observed provider merge |
| **5** | Pre-flight gate toggle, `auto_merge` / `merge_method` config + reconciler API-merge, CEO stalled-PR awareness                                                                   | Tuning, auto-merge, stuck-PR visibility     |
| **6** | GitLab + Bitbucket adapters + per-provider webhook ingress behind `MergeProvider`                                                                                               | Multi-provider parity                       |

Each phase ships independently, TDD throughout (`Red → Green → Refactor`), with `direct-push` unchanged.

---

## 7. Non-Goals

- Replacing `direct-push` (remains default + only option for provider-less repos).
- Building a code-review UI inside Nexus — review happens on the provider; we link to it.
- Changing the worktree/clone model (covered by the 2026-06-22 hardening plan, recommendations 1–4).

---

## 8. Risks

- **Latency:** PR integration is async; `done` may lag by minutes-to-hours. The loop must treat
  `awaiting-pr-merge` as not-stuck.
- **Provider coupling:** Each adapter is provider-specific surface area (API drift, rate limits, scopes).
  Mitigated by the stable `MergeProvider` interface.
- **Credential scope:** PR creation needs broader token scopes than push-only; validate at config time.
- **Dual gates:** If both pre-flight and provider CI run, watch duplicated cost; keep pre-flight cheap
  and disablable.
- **Boundary drift:** PR/provider mechanics stay API-side; lifecycle state stays kanban-side.

---

## 9. Success Criteria

- A repository can be switched to `pull-request` with no code change; work items then land via a PR whose
  URL is recorded on the item.
- Provider required-checks / branch-protection are honoured (a red PR does not merge).
- Work items transition to `done` only on an observed provider merge, with the merge commit linked.
- `direct-push` repositories are byte-for-byte unchanged.
- Full audit trail (PR URL + checks + decision + merge commit) is queryable per work item.

---

## 10. Canonical Interfaces (pinned — all phase plans use these exact signatures)

These signatures are the single source of truth across phases. Implementation plans must not redefine
them; later phases consume the names/types declared here.

### 10.1 `MergeProvider` (API-side) — Phase 1 declares, Phase 2 implements

```typescript
// apps/api/src/common/git/integration/merge-provider.interface.ts
export const MERGE_PROVIDER = Symbol("MERGE_PROVIDER");

export type IntegrationStrategy = "direct-push" | "pull-request";
export type MergeMethod = "merge" | "squash" | "rebase";
export type PullRequestState = "open" | "merged" | "closed";
export type PullRequestChecksStatus =
  | "pending"
  | "passing"
  | "failing"
  | "unknown";

export interface OpenOrUpdatePullRequestArgs {
  scopeId: string; // neutral project/scope id
  contextId: string; // neutral work-item/context id
  workflowRunId: string;
  repositoryUrl: string; // e.g. https://github.com/owner/repo(.git)
  githubSecretId: string;
  headBranch: string; // feature branch (already pushed)
  baseBranch: string; // target/base branch
  title: string;
  body: string;
}

export interface PullRequestRef {
  provider: string; // 'github' | 'gitlab' | 'bitbucket'
  owner: string;
  repo: string;
  number: number;
  url: string;
}

export interface PullRequestStatus {
  ref: PullRequestRef;
  state: PullRequestState;
  checks: PullRequestChecksStatus;
  reviewDecision: "approved" | "changes_requested" | "review_required" | "none";
  mergeCommitSha: string | null; // populated when state === 'merged'
  mergeable: boolean | null;
}

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
}
```

**Canonical factory method (pinned):** the provider factory's resolution method is named
`resolveForRepository(repositoryUrl: string, providerOverride?: string): MergeProvider` — all phases use
this exact name. (Phase 6 adds the `providerOverride` parameter; Phases 2–5 call the single-arg form.)

### 10.2 `IntegrationStrategyResolver` (API-side) — Phase 1

```typescript
// apps/api/src/common/git/integration/integration-strategy.resolver.ts
export interface ResolvedIntegrationConfig {
  strategy: IntegrationStrategy; // default 'direct-push'
  mergeMethod: MergeMethod; // default 'merge'
  autoMerge: boolean; // default false
  preflightGate: boolean; // default true
}

export class IntegrationStrategyResolver {
  // Reads neutral, possibly-undefined step inputs; never throws on absent/unknown; defaults to direct-push.
  resolve(
    inputs: Record<string, unknown> | undefined,
  ): ResolvedIntegrationConfig;
}
```

### 10.3 Kanban config (kanban-contracts) — Phase 1

```typescript
// packages/kanban-contracts/src/repository-workflow-settings.types.ts (extended)
export interface RepositoryIntegrationSettings {
  strategy: IntegrationStrategy; // 'direct-push' | 'pull-request', default 'direct-push'
  mergeMethod: MergeMethod; // default 'merge'
  autoMerge: boolean; // default false
  preflightGate: boolean; // default true
}
export interface RepositoryWorkflowSettings {
  enabled: boolean;
  overrides: Record<string, RepositoryWorkflowOverride>;
  integration?: RepositoryIntegrationSettings; // absent ⇒ direct-push defaults
}
// resolveRepositoryIntegrationSettings(settings): Required<RepositoryIntegrationSettings>
```

### 10.4 PR-tracking entity (API-side, neutral) — Phase 3

```typescript
// apps/api/src/common/git/integration/pull-request-tracking.entity.ts
// table: pull_request_tracking
// columns: id (uuid pk), provider, owner, repo, pr_number (int),
//          scope_id, context_id, workflow_run_id, head_branch, base_branch,
//          pr_url, github_secret_id (NOT NULL), repository_url (NOT NULL),
//          state ('open'|'merged'|'closed'), merge_commit_sha (nullable),
//          created_at, updated_at
// unique: (provider, owner, repo, pr_number)
// index:  (state) for the poll reconciler
//
// github_secret_id + repository_url let the Phase-4 poll reconciler and Phase-5
// merge resolve credentials/host from a bare PullRequestRef without changing the
// pinned MergeProvider signatures (Section 10.1): the provider looks the row up by
// (provider, owner, repo, number) and reads github_secret_id off it.
```

### 10.5 Neutral lifecycle event — Phase 4

```typescript
// core.integration.pr_merged.v1 envelope payload
export interface CoreIntegrationPrMergedV1 {
  scopeId: string;
  contextId: string;
  prUrl: string;
  mergeCommitSha: string;
}

// core.integration.pr_status.v1 envelope payload (Phase 5)
// Sibling event emitted by the poll reconciler on every still-open tick so the
// kanban-side stalled-PR detector sees the current dynamic provider status. The
// static openedAt is stamped once at PR open by the merge_integrate strategy and
// recorded via the seed record_pr_metadata job; this event refreshes only the
// dynamic fields. No status transition is implied — closing the lifecycle stays
// owned by core.integration.pr_merged.v1.
export interface CoreIntegrationPrStatusV1 {
  scopeId: string;
  contextId: string;
  prUrl: string;
  checks: "pending" | "passing" | "failing" | "unknown";
  reviewDecision: "approved" | "changes_requested" | "review_required" | "none";
}
```

### 10.6 Neutral trigger-input keys (kanban → API projection) — Phase 1/3

`integration_strategy`, `integration_merge_method`, `integration_auto_merge`, `integration_preflight_gate`
— flat, neutral, VCS-domain keys placed on the `ready-to-merge` trigger payload. The API
`IntegrationStrategyResolver` reads exactly these keys.
