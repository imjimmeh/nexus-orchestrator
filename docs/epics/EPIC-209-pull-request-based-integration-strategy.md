# EPIC-209: Pull-Request-Based Integration Strategy

**Epic ID:** EPIC-209
**Status:** Proposed
**Priority:** P2
**Theme:** Git Integration, Merge Authority, Auditability & External Provider Parity
**Created:** 2026-06-22
**Depends On:** EPIC-036 (Workflow Run Dedup & Worktree Hardening), EPIC-113 (Private Repository Import & Repository-Grounded Bootstrap), EPIC-144 (Failure Classification & Repair Policy), EPIC-198 (External Ticket Provider Sync Platform)
**Soft Depends On:** Git Concurrency & Worktree Hardening plan (`docs/superpowers/plans/2026-06-22-git-concurrency-and-worktree-hardening.md`) — recommendations 1–4 of the same review that produced this epic

**Related review:** Architecture review of git repository / branch / worktree management (2026-06-22). This epic is **recommendation 5** of that review; recommendations 1–4 are covered by the plan above.

---

## 1. Context

Today the Nexus orchestration engine is the **sole merge authority**. When a work item reaches `ready-to-merge`, the `work-item-ready-to-merge-default` workflow runs a two-stage merge entirely inside our own infrastructure:

1. `merge_prepare` merges base → feature in the context worktree (conflict markers left for a resolution agent).
2. An in-container quality gate runs `build && lint && test`.
3. `merge_integrate` merges feature → base in the shared clone and **pushes directly to the base branch**, deliberately bypassing pre-push hooks (`git -c core.hooksPath=/dev/null push`).

This is fast and self-contained, and it is the right default for local/airgapped or provider-less repositories. But it has structural limitations for repositories hosted on GitHub/GitLab/Bitbucket:

1. **We are the only gate.** The only quality signal is the workflow's own in-container gate. A misconfigured workflow, a skipped gate, or a classification gap (see the merge-gate timeout/clamp and python-less-container incidents) can push unvetted code straight onto the mainline. The hosting provider's CI, required checks, and branch-protection rules are bypassed entirely.
2. **No human/async review surface.** There is no PR for a human (or an external reviewer/bot) to inspect, comment on, approve, or block before the change lands on the base branch. Everything is decided synchronously inside one workflow run.
3. **Weak audit & rollback story.** Direct pushes leave only the merge commit + our event ledger. There is no provider-side review thread, no checks history, no one-click revert, and no linkage between a merged change and the work item that produced it beyond what we record ourselves.
4. **Provider CI is duplicated or ignored.** Teams that already run CI on PRs get either nothing (we bypass it) or double execution (our gate + theirs) with no shared status.

The 2026-06-22 review concluded the worktree foundation is sound and recommended hardening the shared `.git` as a concurrency boundary (recommendations 1–4, now planned). Recommendation 5 — **offer PR-based integration as a per-repository option** — is larger and provider-coupled, hence this epic rather than the plan.

### What already exists (we build on it, not around it)

- **Two-stage merge engine:** `GitMergeService` (`prepareMergeInWorktree` / `integrateAndPush`), `git_operation` special step with `merge_prepare` / `merge_integrate` / `merge` actions, and `MergeBranchResolverService`.
- **Failure classification:** `isPrePushHookFailure`, `isPushRejected`, `classifyAuthError`, `quality_gate_failed` outcome + bounded remediation (EPIC-144).
- **Repository metadata (kanban-side):** `KanbanProjectEntity` already stores `repository_url`, `base_path`, `github_secret_id`; `repository_workflow_settings` already gates per-project workflow behaviour.
- **Secret store:** provider credentials encrypted server-side, referenced by id (`github_secret_id`, `llm_providers.secret_id` pattern).
- **External provider platform:** EPIC-198 establishes provider-sync patterns we can mirror for PR providers.
- **Auth env resolution:** `GitAuthEnvResolverService` already injects push credentials per scope.

### Target State

- A per-repository **integration strategy** setting: `direct-push` (today's behaviour, default) or `pull-request`.
- For `pull-request` repos, `merge_integrate` instead **pushes the feature branch** (hooks still bypassed locally, since the provider re-runs CI) and **opens/updates a PR** against the base branch via a provider adapter.
- The work item moves to a new lifecycle state (e.g. `in-review`) with the PR URL recorded in `lifecycle.merge` metadata; it transitions to `done` only when the PR is **merged** (observed via webhook or poll).
- A pluggable **`MergeProvider` adapter** (GitHub first) behind a stable interface, selected by repository config, consistent with the core/kanban boundary (git/provider mechanics stay API-side; lifecycle state stays kanban-side).
- Provider CI becomes the gate of record; our in-container gate becomes optional pre-flight (fail fast before opening a PR) rather than the sole authority.
- Full audit trail: PR URL, checks status, review decisions, and merge commit all linked to the work item.

---

## 2. Design Pillars

| Pillar                         | Mechanism                                                                                                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Opt-in, non-breaking**       | New `integration_strategy` repo setting; absent/`direct-push` preserves today's behaviour exactly. No existing repo changes flow until explicitly switched. |
| **Provider as gate of record** | For PR repos, the provider's required checks + branch protection decide mergeability; our gate is fast-fail pre-flight only.                                |
| **Pluggable providers**        | A `MergeProvider` interface (open PR, update PR, get PR status, merge PR) with a GitHub adapter first; GitLab/Bitbucket later. Selected by repo config.     |
| **Lifecycle reflects review**  | New `in-review` state; PR URL + checks + decision recorded in `lifecycle.merge`; `done` only on observed PR merge.                                          |
| **Boundary-clean**             | Git/provider mechanics + adapters live API-side; the lifecycle state machine + metadata stay kanban-side; communication via existing core lifecycle events. |
| **Resilient & idempotent**     | Re-running integration finds-or-creates the PR (idempotent by head/base + work-item key); webhook and poll paths converge on the same state.                |

---

## 3. Architecture Sketch

```
ready-to-merge (work item)
   │
   ▼  merge_prepare (unchanged: base→feature in worktree)
   │
   ▼  optional pre-flight gate (build/lint/test in container) — fail fast
   │
   ├── integration_strategy = direct-push ──► merge_integrate (today: merge→base, push)
   │
   └── integration_strategy = pull-request ──► push feature branch
                                              └► MergeProvider.openOrUpdatePullRequest()
                                                 │  record PR URL → lifecycle.merge
                                                 ▼
                                            work item → in-review
                                                 │
                          ┌──────────────────────┴───────────────────────┐
                          ▼ (webhook: PR merged)         ▼ (poll fallback) │
                    MergeProvider status = merged ───────────────────────┘
                                                 │
                                                 ▼  record merge commit → work item → done
```

**New components (API-side):**

- `MergeProvider` interface + `GitHubMergeProvider` adapter (`openOrUpdatePullRequest`, `getPullRequestStatus`, `mergePullRequest`).
- `IntegrationStrategyResolver` — resolves `direct-push` vs `pull-request` from repository config.
- PR status ingress: a webhook controller (preferred) with a polling reconciler fallback.

**New config (kanban-side metadata, resolved API-side):**

- `integration_strategy: 'direct-push' | 'pull-request'` (per project/repository; default `direct-push`).
- Optional `merge_method: 'merge' | 'squash' | 'rebase'` and `auto_merge: boolean` for PR repos.

**Lifecycle (kanban-side):**

- New `in-review` status between `ready-to-merge` and `done`, gated on observed PR merge.

---

## 4. Open Questions / Decisions Needed

1. **Webhook vs poll** for PR-merged detection — webhook is timely but needs an ingress endpoint + secret verification; poll is simpler but laggy. Likely both (webhook primary, poll reconciler fallback), mirroring EPIC-198 patterns.
2. **Auto-merge** — do we enable provider auto-merge (merge-when-checks-pass) or wait and merge via API once checks are green? Auto-merge offloads timing to the provider but reduces our control.
3. **Pre-flight gate** — keep our in-container gate as fail-fast before opening a PR, or drop it entirely for PR repos and rely solely on provider CI? Keeping it avoids opening obviously-broken PRs.
4. **Conflict handling for PR repos** — `merge_prepare` still resolves conflicts against base in the worktree before pushing, so PRs open mergeable; confirm this is sufficient vs. letting the provider show conflicts.
5. **`in-review` re-entry** — how the orchestration cycle treats `in-review` items (don't re-dispatch, but do surface stuck/blocked PRs to the CEO).

---

## 5. Phased Delivery

Epic-sized; each phase ships independently with its own implementation plan in `docs/plans/` or `docs/superpowers/plans/`.

| Phase | Scope                                                                                                                                             | Outcome                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **1** | `MergeProvider` interface + `IntegrationStrategyResolver`; repo config `integration_strategy` (kanban metadata + resolver), default `direct-push` | Strategy selectable; zero behaviour change           |
| **2** | `GitHubMergeProvider` adapter (open/update PR, status, merge) using `github_secret_id` credentials                                                | We can open and inspect PRs via API                  |
| **3** | `merge_integrate` PR branch: push feature + open/update PR; record PR URL in `lifecycle.merge`; `in-review` lifecycle state                       | PR repos route through review instead of direct push |
| **4** | PR-merged detection: webhook ingress (secret-verified) + polling reconciler; transition `in-review → done` on observed merge                      | Lifecycle closes on real provider merge              |
| **5** | Optional pre-flight gate for PR repos; `merge_method` / `auto_merge` config; orchestration-cycle awareness of `in-review`                         | Tuning, auto-merge, stuck-PR visibility              |
| **6** | Additional adapters (GitLab/Bitbucket) behind the same interface                                                                                  | Multi-provider parity                                |

---

## 6. Non-Goals

- Replacing `direct-push` — it remains the default and the only option for provider-less/local/imported-without-remote repositories.
- Building a code-review UI inside Nexus — review happens on the provider; we link to it.
- Changing the worktree/clone model — that is covered by the 2026-06-22 hardening plan (recommendations 1–4).

---

## 7. Risks & Consequences

- **Latency:** PR-based integration is asynchronous; `done` may lag by minutes-to-hours waiting on CI/review. The orchestration loop must treat `in-review` as not-stuck.
- **Provider coupling:** Each adapter is provider-specific surface area (API drift, rate limits, auth scopes). Mitigated by the stable `MergeProvider` interface.
- **Credential scope:** PR creation needs broader token scopes than push-only. Document and validate at config time.
- **Dual gates:** If both our pre-flight gate and provider CI run, watch for duplicated cost; make pre-flight cheap/optional.
- **Boundary drift:** Keep PR/provider mechanics API-side; do not leak provider domain into core. Lifecycle state stays kanban-side.

---

## 8. Success Criteria

- A repository can be switched to `pull-request` strategy with no code change, and work items then land via a PR whose URL is recorded on the item.
- Provider required-checks/branch-protection are honoured (a red PR does not merge).
- Work items transition to `done` only on an observed provider merge, with the merge commit linked.
- `direct-push` repositories are byte-for-byte unchanged in behaviour.
- Full audit trail (PR URL + checks + decision + merge commit) is queryable per work item.
