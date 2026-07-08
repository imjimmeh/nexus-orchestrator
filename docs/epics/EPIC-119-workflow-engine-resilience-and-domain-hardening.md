# EPIC-119 — Workflow Engine Resilience and Domain Hardening

**Status:** Planned  
**Created:** 2026-04-18  
**Source Analysis:** [docs/analysis/ANALYSIS-workflow-errors-root-cause-2026-04-18.md](../analysis/ANALYSIS-workflow-errors-root-cause-2026-04-18.md)  
**Related Epics:** EPIC-023 (git worktree), EPIC-034 (workflow-driven kanban lifecycle), EPIC-036 (worktree hardening), EPIC-033 (observability/event sourcing), EPIC-041 (workflow concurrency policy)

---

## Background

A session-level JSONL analysis of two workflow runs (f2647e0f QA-review, 3d4a4f41 orchestration-decision) from 2026-04-18, combined with event_ledger queries across that time window, surfaced nine recurring failure classes. They cluster into four domains:

1. **Git worktree lifecycle** — lock-state handling, stale-path reuse, branch assumption mismatch, FS I/O instability
2. **Status transition integrity** — stale/racing commands reach a guard that rejects them with no graceful handling
3. **Retry amplification** — aggressive max_attempts drives repeated collisions against corrupted shared state
4. **Observability gaps** — empty failure reasons in event_ledger make triage and root-cause analysis slow

The goal of this epic is to fix all nine root causes **at the domain boundary level** — not with patches, but with correct models, state machines, and contracts that prevent the failure classes from being expressible in the first place. Code quality target: DRY, SOLID, separation of concerns, no dead paths.

---

## Root Cause Reference

All nine root causes are documented in detail in  
[docs/analysis/ANALYSIS-workflow-errors-root-cause-2026-04-18.md](../analysis/ANALYSIS-workflow-errors-root-cause-2026-04-18.md).

| #    | Failure Class                                                                                                        | Primary File(s)                                                                           | Severity   |
| ---- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------- |
| RC-1 | `git worktree remove` uses single `-f`; locked tree needs `-f -f`                                                    | `worktree-operations.service.ts#L99`                                                      | High       |
| RC-2 | Deterministic worktree path + high retry count = repeated stale collisions                                           | `git-path.service.ts#L6`, `workflow-run-auto-retry.helpers.ts#L102`                       | High       |
| RC-3 | Stale/corrupted git object I/O instability on mounted workspace paths                                                | `git-worktree.service.ts#L362`, `L368`                                                    | High       |
| RC-4 | `provision_worktree` / `cleanup_worktree_clean` failures propagate to workflow failure with no intermediate recovery | `step-manage-worktree-special-step.handler.ts#L104`, `L230`                               | Medium     |
| RC-5 | Hard-coded `main` default branch when repo topology differs                                                          | `step-manage-worktree-special-step.handler.ts#L21`, `branch-operations.service.ts#L36`    | Medium     |
| RC-6 | `done → in-review` transition rejected; stale orchestration commands not gracefully absorbed                         | `work-item.constants.ts#L27`, `step-transition-status-special-step.handler.ts#L49`, `L86` | Medium     |
| RC-7 | Tool-mount EIO / workspace scandir failures under `/tmp/nexus-tools`                                                 | `tool-mounting.service.ts#L21`, `L76`, `L172`                                             | Medium     |
| RC-8 | External provider 429 throttling — no quota manager or circuit breaker                                               | (provider gateway layer)                                                                  | Low–Medium |
| RC-9 | `tool.execution.completed` failure events recorded with empty reason                                                 | `telemetry-gateway-runtime.helpers.ts#L112`, `L121`                                       | Low        |

---

## Design Principles

- **Model the domain correctly first.** A worktree is a finite-state machine; a work item status is a finite-state machine. Express them as such in code (typed state unions, explicit transition tables) rather than ad-hoc `if` trees.
- **Fail loudly at the boundary, absorb gracefully at the caller.** Domain services throw typed errors. Orchestration callers catch typed errors and decide whether to retry, skip, or fail the workflow step.
- **Classify before retrying.** The retry subsystem must inspect error type — not just "did it throw?" — and apply per-class policy (transient → backoff-retry; permanent → skip; lock-conflict → force-remove then re-provision).
- **One source of truth per concept.** Branch default logic lives in one service. Transition policy lives in one typed state machine. Error shape lives in one `ErrorEnvelope` type. Duplicates are removed.
- **Everything observable.** Every failure reason must be captured in the event_ledger with enough structured detail to self-triage without reading logs.

---

## Phase 1 — Foundations: Error Taxonomy + State Machine Schemas (Sprint 1)

### Goals

Establish the typed contracts that all later phases depend on. No behaviour changes yet.

### Stories

#### 1.1 — `ErrorEnvelope` canonical type

**Files to create/modify:**

- `packages/core/src/errors/error-envelope.types.ts` _(new)_

Define a discriminated union covering all error classes the orchestration layer can emit:

```ts
export type ErrorEnvelope =
  | { kind: "worktree.lock"; path: string; hint: string }
  | { kind: "worktree.stale"; path: string }
  | { kind: "worktree.io"; path: string; errno: string }
  | { kind: "worktree.branch-missing"; branch: string; remote: string }
  | { kind: "transition.illegal"; from: WorkItemStatus; to: WorkItemStatus }
  | {
      kind: "transition.stale";
      from: WorkItemStatus;
      requested: WorkItemStatus;
      current: WorkItemStatus;
    }
  | { kind: "provider.quota"; provider: string; retryAfterMs?: number }
  | { kind: "tool.io"; toolName: string; errno: string }
  | { kind: "unknown"; message: string; raw?: unknown };
```

Export from `@nexus/core`. No business logic here — this is a schema file only.

**Acceptance criteria:**

- TypeScript compiles with zero errors.
- ESLint clean.
- Exported from `@nexus/core` index.

---

#### 1.2 — `WorkItemStatus` state machine schema

**Files to modify:**

- `apps/api/src/project/work-item.constants.ts`

Replace the implicit transition graph with a single exported typed `WORK_ITEM_TRANSITIONS` map keyed by `WorkItemStatus`, valued by `ReadonlyArray<WorkItemStatus>`. This is the single source of truth.

```ts
export const WORK_ITEM_TRANSITIONS: Record<
  WorkItemStatus,
  ReadonlyArray<WorkItemStatus>
> = {
  todo: ["in-progress", "blocked"],
  "in-progress": ["in-review", "blocked", "todo"],
  "in-review": ["done", "in-progress", "blocked"],
  done: ["blocked"], // intentional: done is near-terminal
  blocked: ["todo", "in-progress"],
  archived: [],
} as const;
```

All callers of the transition guard must import from this map. No duplication allowed.

**Acceptance criteria:**

- `work-item-service-mutations.helpers.ts` guard reads only from `WORK_ITEM_TRANSITIONS`.
- `step-transition-status-special-step.handler.ts` reads from the same map.
- No other file re-defines allowed transitions.
- Lint clean.

---

#### 1.3 — Architectural lint rule: no raw `Error` throws from domain services

**Files to create:**

- `apps/api/eslint-domain-errors.mjs` _(or add rule to existing config)_

Add a custom ESLint rule (or `no-restricted-syntax` pattern) that disallows `throw new Error(...)` in any file under `apps/api/src/common/git/**` and `apps/api/src/project/**`. These files must throw `ErrorEnvelope`-typed objects only.

Rationale: raw `Error` throws escape the typed error system and land in event_ledger as "unknown" or empty.

**Acceptance criteria:**

- `npm run lint` flags raw throws in the covered paths.
- Existing violations listed in a one-time waiver file (cleaned up in Phase 6).

---

### Exit criteria Phase 1

- `ErrorEnvelope` exported from `@nexus/core`, imported by at least one service.
- `WORK_ITEM_TRANSITIONS` is the single transition truth; no duplication.
- Lint gates active.

---

## Phase 2 — WorktreeDomain: Lock Handling, Leasing, Branch Inference (Sprints 2–3)

### Goals

Fix RC-1 through RC-5. All worktree failures become typed, retried with correct policy, and the deterministic path is protected by a lease.

### Stories

#### 2.1 — Double-force worktree remove (RC-1)

**Files to modify:**

- `apps/api/src/common/git/worktree/worktree-operations.service.ts`

Change L99 remove command: detect locked working-tree message in stderr and re-attempt with `-f -f`. Use a narrow regex match against the known git error text rather than unconditionally using `-f -f` (which swallows other protection classes).

```ts
// Pseudocode for locked-tree retry
if (
  stderr.includes("locked working tree") ||
  stderr.includes("use --force --force")
) {
  await this.exec("git", ["worktree", "remove", "--force", "--force", path]);
} else {
  throw toErrorEnvelope(stderr, path);
}
```

Throw `ErrorEnvelope { kind: 'worktree.lock' }` if second attempt also fails.

**Acceptance criteria:**

- Unit test: mocked git stderr simulates "locked working tree" message → second `-f -f` call is made.
- Unit test: non-lock error → no second attempt, throws `worktree.lock` envelope.

---

#### 2.2 — Worktree path lease mechanism (RC-2)

**Files to create/modify:**

- `apps/api/src/common/git/worktree/worktree-lease.service.ts` _(new)_
- `apps/api/src/common/git/git-worktree.service.ts`

Introduce a `WorktreeLease` in-memory service (backed by a `Map<path, LeaseRecord>`) that:

1. Grants a lease for a path with a TTL (default 15 minutes).
2. Refuses `provision` if a lease is already held for the same path by a different run.
3. Releases the lease on successful remove or on TTL expiry.

```ts
interface LeaseRecord {
  runId: string;
  stepId: string;
  grantedAt: Date;
  expiresAt: Date;
}
```

`GitWorktreeService.provision()` acquires a lease before attempting `worktree add`. If the lease is denied, it throws `ErrorEnvelope { kind: 'worktree.stale' }`. The caller (retry policy) treats `worktree.stale` as a non-retriable permanent failure and fails the step immediately.

**Acceptance criteria:**

- Unit test: second provision call for same path from different run ID → throws `worktree.stale`.
- Unit test: same run can re-acquire after its own remove.
- Integration: no duplicate provision events for same deterministic path within a single workflow run.

---

#### 2.3 — Stale-cleanup must halt on lock error (RC-3)

**Files to modify:**

- `apps/api/src/common/git/git-worktree.service.ts` (L362, L368)

The stale-worktree cleanup loop currently continues past lock failures. Change to:

- On `ErrorEnvelope { kind: 'worktree.lock' }` → attempt the double-force remove (delegate to 2.1 fix).
- On `ErrorEnvelope { kind: 'worktree.io' }` → log the error, **halt the cleanup loop for this path**, and emit a `git.worktree.io_error` telemetry event.
- Do not continue silently.

**Acceptance criteria:**

- Unit test: stale cleanup with simulated lock error → double-force called, then loop continues to next path.
- Unit test: stale cleanup with EIO → loop halted for that path, telemetry event emitted.

---

#### 2.4 — Branch inference service (RC-5)

**Files to modify:**

- `apps/api/src/common/git/branch/branch-operations.service.ts` (L36)
- `apps/api/src/workflow/step-manage-worktree-special-step.handler.ts` (L21)

Replace the hard-coded `main` default with a `resolveBranch(repoPath: string, hint?: string): Promise<string>` method that:

1. Uses `hint` if provided and resolves locally.
2. Falls back to `git symbolic-ref refs/remotes/origin/HEAD` → strip `refs/remotes/origin/` prefix.
3. Falls back to inspecting local HEAD.
4. Throws `ErrorEnvelope { kind: 'worktree.branch-missing' }` only if all three fail.

Delete the `main` constant from `step-manage-worktree-special-step.handler.ts`.

**Acceptance criteria:**

- Unit test: `hint` resolves correctly.
- Unit test: no `hint`, origin HEAD exists → inferred correctly.
- Unit test: no `hint`, no origin HEAD, local HEAD exists → local branch used.
- Unit test: all three fail → throws `worktree.branch-missing`.

---

#### 2.5 — Retry classifier for worktree errors (RC-2 amplifier)

**Files to modify:**

- `apps/api/src/workflow/workflow-run-auto-retry.helpers.ts` (L102)
- `apps/api/src/workflow/workflow-run-job-execution.service.ts` (L117)

Extract a `classifyForRetry(error: ErrorEnvelope | unknown): RetryPolicy` function:

```ts
type RetryPolicy =
  | { action: "retry"; delayMs: number; maxAttempts: number }
  | { action: "skip" }
  | { action: "fail"; reason: string };
```

Policy table:
| Error kind | Policy |
|---|---|
| `worktree.lock` | retry × 2, 5 s delay, then fail |
| `worktree.stale` | fail immediately (lease conflict) |
| `worktree.io` | fail immediately (filesystem problem, retry won't help) |
| `worktree.branch-missing` | fail immediately |
| `transition.illegal` | skip (no-op) |
| `transition.stale` | skip (no-op) |
| `provider.quota` | retry × 3, use `retryAfterMs` from envelope |
| `tool.io` | retry × 1, 2 s delay |
| `unknown` | retry × 3, 10 s delay (existing behaviour) |

Remove the global `max_attempts=10` config. Replace with per-class policy from the table above.

**Acceptance criteria:**

- Unit tests covering each policy entry.
- `max_attempts` global config removed from system settings or overridden per class.

---

### Exit criteria Phase 2

- RC-1 through RC-5 covered by typed fixes.
- No repeated `worktree.provision.failed` events for the same path within one run (verified by integration test or event_ledger query).
- Unit test coverage ≥ 90 % on all new/modified services.

---

## Phase 3 — StatusTransitionDomain: Optimistic Concurrency + Stale Command Absorption (Sprint 4)

### Goals

Fix RC-6. Status transitions are idempotent, stale commands are absorbed without errors, and concurrent updates are safe.

### Stories

#### 3.1 — Transition guard with stale-command absorption

**Files to modify:**

- `apps/api/src/workflow/step-transition-status-special-step.handler.ts` (L49, L86)
- `apps/api/src/project/work-item-service-mutations.helpers.ts` (L180, L182)

Change the handler to:

1. Read the **current** status from DB (not from cached step context).
2. If `current === requested` → no-op (already idempotent — keep this).
3. If `WORK_ITEM_TRANSITIONS[current].includes(requested)` → apply transition.
4. If transition is not allowed **and** `requested` is an earlier-pipeline status (e.g., `in-review` but current is `done`) → emit `ErrorEnvelope { kind: 'transition.stale' }` and **no-op** (skip, do not throw).
5. Only throw `ErrorEnvelope { kind: 'transition.illegal' }` if the transition is logically impossible from any path (e.g., `archived → in-progress`).

The retry classifier (Phase 2, story 2.5) marks both `transition.stale` and `transition.illegal` as `skip`.

**Acceptance criteria:**

- Unit test: `done → in-review` → stale absorption, no throw, event emitted.
- Unit test: `archived → in-progress` → illegal, throw.
- Unit test: `in-progress → done` → applied.
- Integration: no `transition.illegal` events in event_ledger during a normal orchestration cycle.

---

#### 3.2 — Optimistic concurrency guard on `updateStatus`

**Files to modify:**

- `apps/api/src/project/work-item-service-mutations.helpers.ts`
- TypeORM entity for work items

Add an optimistic concurrency column (`version: number`, TypeORM `@VersionColumn`) to the work item entity. Pass `currentVersion` in the update query. If the version has changed, treat as `transition.stale` and emit the envelope.

**Note:** requires a database migration. Use the `adding-entity-migration` skill to scaffold the migration.

**Acceptance criteria:**

- Migration passes on clean DB.
- Unit test: concurrent update with version mismatch → `transition.stale` envelope.

---

### Exit criteria Phase 3

- No `done → in-review` (or equivalent stale) errors in event_ledger during a 10-cycle orchestration run.
- `updateStatus` is version-guarded.

---

## Phase 4 — Provider Quota Manager + Circuit Breaker (Sprint 5)

### Goals

Fix RC-8. Rate-limit failures are absorbed behind a quota manager and surfaced to the orchestration layer with structured retry guidance.

### Stories

#### 4.1 — `ProviderQuotaManager` service

**Files to create:**

- `apps/api/src/ai/provider-quota-manager.service.ts` _(new)_

Implements a per-provider token-bucket or leaky-bucket rate limiter:

- Tracks `requestsThisMinute` per provider key.
- Tracks `quotaResetAt` when a 429 is received (parses `Retry-After` header or uses `retryAfterMs` from error envelope).
- Exposes `canSend(provider: string): boolean` and `recordQuotaError(provider: string, retryAfterMs: number): void`.

The AI execution path (wherever the provider call is made) must call `canSend()` before dispatching and call `recordQuotaError()` on 429. If `canSend()` returns false, throw `ErrorEnvelope { kind: 'provider.quota' }` immediately — do not attempt the call.

**Acceptance criteria:**

- Unit test: after `recordQuotaError`, `canSend` returns false for the quota window.
- Unit test: after quota window, `canSend` returns true.
- Integration: 429 responses result in `provider.quota` envelope, retry respects `retryAfterMs`.

---

#### 4.2 — Circuit breaker for persistent provider failures

**Files to create/modify:**

- `apps/api/src/ai/provider-circuit-breaker.service.ts` _(new)_

Wraps the provider call with a simple three-state circuit (closed / open / half-open):

- Opens after N consecutive failures (default 5) within a rolling window.
- Half-open after the cool-down period expires; allows one probe request.
- Closes if the probe succeeds.

Emits a `provider.circuit.opened` / `provider.circuit.closed` telemetry event.

**Acceptance criteria:**

- Unit tests for all three state transitions.
- Telemetry events verified.

---

### Exit criteria Phase 4

- No unbounded 429 retry loops in workflow execution.
- Circuit breaker prevents cascading failures during provider outages.

---

## Phase 5 — Observability: `ErrorEnvelope` Rollout + Telemetry Coverage (Sprint 6)

### Goals

Fix RC-7 and RC-9. Every failure recorded in event_ledger has a structured, non-empty reason field. Tool-mount failures are surfaced with actionable details.

### Stories

#### 5.1 — Telemetry normalization for all `ErrorEnvelope` kinds (RC-9)

**Files to modify:**

- `apps/api/src/telemetry/telemetry-gateway-runtime.helpers.ts` (L112, L121)

Replace the two-path extraction (`payload.errorMessage` / `details.error`) with a single `extractFailureReason(event: TelemetryEvent): string` function that:

1. Checks for an `ErrorEnvelope` in `payload.envelope`.
2. Falls back to `payload.errorMessage`.
3. Falls back to `details.error`.
4. Falls back to `details.message`.
5. Falls back to `String(payload)` truncated to 200 chars.

Returns `"(no reason captured)"` as an explicit sentinel — never empty string.

Add a CI check that fails if `"(no reason captured)"` appears in event_ledger after any E2E test run (query via test teardown).

**Acceptance criteria:**

- Unit tests for each fallback path.
- Zero empty `failure_reason` in event_ledger during E2E runs.

---

#### 5.2 — Atomic tool-mount writes to prevent EIO (RC-7)

**Files to modify:**

- `apps/api/src/tool/tool-mounting.service.ts` (L76, L172)

Replace direct file writes with an atomic write pattern:

1. Write to `<path>.tmp`.
2. `fsync`.
3. `rename` (atomic on POSIX, near-atomic on Win/WSL2).

Add a per-session cleanup guard: cleanup only removes files owned by the current session ID (tracked in a lightweight registry), preventing race with active readers.

**Acceptance criteria:**

- Unit test: write failure mid-way does not leave a partial file at the final path.
- Unit test: cleanup does not remove files owned by a different session.

---

#### 5.3 — Health-check endpoint for mounted filesystem paths

**Files to create:**

- `apps/api/src/tool/tool-mount-health.service.ts` _(new)_

Exposes a `checkMountHealth(): Promise<MountHealthReport>` that runs `statfs` (or equivalent) on the tool-mount path and workspace mount path, returning:

```ts
interface MountHealthReport {
  toolMount: { path: string; healthy: boolean; errno?: string };
  workspaceMount: { path: string; healthy: boolean; errno?: string };
}
```

Integrate with the existing `doctor` diagnostics module (EPIC-082).

**Acceptance criteria:**

- Health check returns `healthy: false` with an `errno` when the path is unavailable.
- Integrated into `/api/doctor` endpoint.

---

### Exit criteria Phase 5

- No empty failure reasons in event_ledger.
- Tool-mount writes are atomic.
- Mount health is queryable via `/api/doctor`.

---

## Phase 6 — Cleanup, ADRs, Freeze Legacy Paths (Sprint 7)

### Goals

Close out technical debt opened by this epic; ensure the codebase is cleaner than before.

### Stories

#### 6.1 — Delete legacy duplicate transition logic

Remove any transition-guard code not consolidated under `WORK_ITEM_TRANSITIONS` from Phase 1.

#### 6.2 — Remove global `max_attempts` config

Delete the system-settings key for global `max_attempts`. Document the per-class retry policy in code and in ADR.

#### 6.3 — Architecture Decision Records

Write the following ADRs in `docs/adrs/`:

- `ADR-XXX-worktree-lease-and-retry-classifier.md` — why leasing was chosen over lock-polling; retry policy table rationale.
- `ADR-XXX-errorenvelope-discriminated-union.md` — why discriminated union over exception hierarchy; cross-package contract rationale.
- `ADR-XXX-optimistic-concurrency-work-item-status.md` — why version column over pessimistic lock.

#### 6.4 — Lint waivers resolved

All violations listed in the Phase 1 lint waiver file (1.3) must be resolved. Waiver file deleted.

#### 6.5 — Regression test additions to `packages/e2e-tests`

For each root cause, at minimum one scenario-level test must exist in `packages/e2e-tests` that exercises the failure path and asserts correct behaviour (skip, retry with backoff, or structured event_ledger entry). See skill `testing-unit-patterns` ([.agents/skills/testing-unit-patterns/SKILL.md](../../.agents/skills/testing-unit-patterns/SKILL.md)).

---

## Implementation Order

```
Phase 1 (Sprint 1)  ─ ErrorEnvelope + WORK_ITEM_TRANSITIONS schema + lint rules
      │
      ▼
Phase 2 (Sprints 2–3) ─ Worktree domain: lock fix, lease, stale cleanup, branch inference, retry classifier
      │
      ▼
Phase 3 (Sprint 4)  ─ StatusTransition domain: stale absorption, optimistic concurrency
      │
      ▼
Phase 4 (Sprint 5)  ─ Provider quota manager + circuit breaker
      │
      ▼
Phase 5 (Sprint 6)  ─ Observability: telemetry normalization, atomic writes, mount health
      │
      ▼
Phase 6 (Sprint 7)  ─ Cleanup, ADRs, E2E regression tests
```

---

## Acceptance Criteria (Epic-level)

- [ ] No `worktree.provision.failed` or `worktree.remove.failed` events repeated for the same path/run in event_ledger.
- [ ] No `transition.illegal` events for `done → in-review` during a normal orchestration cycle.
- [ ] No empty `failure_reason` in event_ledger across any E2E test run.
- [ ] `ProviderQuotaManager` absorbs 429 responses; no unbounded retry loops.
- [ ] All new and modified services are lint-clean (zero ESLint warnings or errors).
- [ ] Unit test coverage ≥ 90 % on all net-new service files.
- [ ] At least one E2E scenario per root cause in `packages/e2e-tests`.
- [ ] Three ADRs written and merged.
- [ ] `npm run build:api` and `npm run build:web` pass with zero errors.

---

## Files Referenced by Root Causes

| File                                                                   | Relevant Root Causes |
| ---------------------------------------------------------------------- | -------------------- |
| `apps/api/src/common/git/worktree/worktree-operations.service.ts`      | RC-1, RC-3           |
| `apps/api/src/common/git/git-worktree.service.ts`                      | RC-2, RC-3           |
| `apps/api/src/common/git/path/git-path.service.ts`                     | RC-2                 |
| `apps/api/src/common/git/branch/branch-operations.service.ts`          | RC-5                 |
| `apps/api/src/workflow/step-manage-worktree-special-step.handler.ts`   | RC-4, RC-5           |
| `apps/api/src/workflow/workflow-run-job-execution.service.ts`          | RC-2, RC-4           |
| `apps/api/src/workflow/workflow-run-auto-retry.helpers.ts`             | RC-2                 |
| `apps/api/src/workflow/step-transition-status-special-step.handler.ts` | RC-6                 |
| `apps/api/src/project/work-item.constants.ts`                          | RC-6                 |
| `apps/api/src/project/work-item-service-mutations.helpers.ts`          | RC-6                 |
| `apps/api/src/tool/tool-mounting.service.ts`                           | RC-7                 |
| `apps/api/src/telemetry/telemetry-gateway-runtime.helpers.ts`          | RC-9                 |
| `packages/core/src/errors/error-envelope.types.ts` _(new)_             | RC-1 through RC-9    |

---

## Skills and Instructions to Apply

- **adding-entity-migration** ([.agents/skills/adding-entity-migration/SKILL.md](../../.agents/skills/adding-entity-migration/SKILL.md)) — required for story 3.2 (version column migration).
- **testing-unit-patterns** ([.agents/skills/testing-unit-patterns/SKILL.md](../../.agents/skills/testing-unit-patterns/SKILL.md)) — required for all new service unit tests.
- **nestjs-module-conventions** ([.agents/skills/nestjs-module-conventions/SKILL.md](../../.agents/skills/nestjs-module-conventions/SKILL.md)) — required for `WorktreeLease`, `ProviderQuotaManager`, `CircuitBreaker` services.
- **API quality gate** ([.github/instructions/api-quality-gate.instructions.md](../../.github/instructions/api-quality-gate.instructions.md)) — must be satisfied by all modified `apps/api/src/**/*.ts` files.
- **Lint warning policy** ([.github/instructions/lint-warning-policy.instructions.md](../../.github/instructions/lint-warning-policy.instructions.md)) — no `eslint-disable` suppression allowed.
