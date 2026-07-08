# WorkflowModule Comprehensive Refactor — Design

> Date: 2026-06-20
> Source analysis: [docs/analysis/ANALYSIS-refactoring-opportunities-2026-06.md](../../analysis/ANALYSIS-refactoring-opportunities-2026-06.md)
> Branch: `refactor/workflow-module-decomposition`

## Context

The June 2026 static analysis flagged `WorkflowModule`
(`apps/api/src/workflow/workflow.module.ts`) as one of the two most severe
Single-Responsibility violations in the system: `@Global()`, ~40 providers, ~30
exports, owning execution / persistence / events / audit / concurrency /
telemetry / delegation / subagent provisioning. The analysis also flagged two
workflow complexity hotspots (H-4, H-5), several duplication clusters, and two
reliability gaps in the workflow area.

A current-state verification (2026-06-20) found the codebase has moved on from
the analysis snapshot. The following items are **already resolved** and are out
of scope:

- `normalizeOptionalString` — consolidated into
  `packages/core/src/common/string.utils.ts`; only a kanban-local copy remains
  (a separate concern outside this refactor).
- `sleep(ms)` — consolidated into `apps/api/src/common/utils/async.utils.ts`.
- A shared `computeExponentialBackoffMs` already exists in `async.utils.ts`.
- A `kernel/` ports layer already exists
  (`apps/api/src/workflow/kernel/interfaces/workflow-kernel.ports.ts`) with the
  tokens `WORKFLOW_ENGINE_SERVICE`, `WORKFLOW_PARSER_SERVICE`,
  `STATE_MACHINE_SERVICE`, `WORKFLOW_PERSISTENCE_SERVICE`,
  `WORKFLOW_RUNTIME_CAPABILITY_EXECUTOR_SERVICE`,
  `WORKFLOW_RUNTIME_TOOLS_SERVICE` — but adoption is partial.

## Verified current state (the work that remains)

| Item                                     | Current state                                                                                                                                                                                                                    | File reference                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `@Global()` WorkflowModule               | Still global. `AutomationModule`, `Memory`/`LearningModule`, `NotificationsModule` inject workflow services **without importing** WorkflowModule (rely on global). `OperationsModule` and `WebhooksModule` import it explicitly. | `workflow.module.ts:95`                                                                         |
| Concrete-class injection bypassing token | `RecordLearningService` injects the concrete `WorkflowEngineService`, not `WORKFLOW_ENGINE_SERVICE`.                                                                                                                             | `memory/learning/record-learning.service.ts:35`                                                 |
| Skipped kernel tests                     | 7 `it.skip` tests "`<Module> should not import WorkflowModule via forwardRef`", reason "deep dependency mocking requirements".                                                                                                   | `workflow/kernel/workflow-kernel.spec.ts:282–306`                                               |
| In-module circular dependency            | Exactly one `forwardRef` inside `workflow/`: `WorkflowRuntimeCapabilityExecutorService ↔ WorkflowRuntimeToolsService`. Both tokens already minted.                                                                               | `workflow-runtime/workflow-runtime-capability-executor.service.ts:28`                           |
| H-4 git handler                          | 548 lines; `execute()` switch dispatches 5 actions to private methods. `ISpecialStepHandler` exists; no per-action strategy. Strong 482-line spec.                                                                               | `workflow-special-steps/step-git-operation-special-step.handler.ts`                             |
| H-5 orchestration actions                | 486 lines; `resolveInvocationInputs` is flat inline mapping (9 `normalizeOptionalString` calls). 1111-line spec.                                                                                                                 | `workflow-runtime/workflow-runtime-orchestration-actions.service.ts:67`                         |
| `isTerminalWorkflowRunStatus` dedup      | Canonical exists in `@nexus/core`. 3 divergent copies remain: web inline; lowercase `Set` in `workflow-runtime-await-actions`; array in `subagent-orphan-reconciler`.                                                            | `workflow-runtime-await-actions.service.ts:47`, `subagent-orphan-reconciler.service.ts:10`      |
| Backoff dedup                            | Shared `computeExponentialBackoffMs` unused by 2 workflow helpers (different multiplier/jitter-ratio config shape).                                                                                                              | `workflow-run-auto-retry.helpers.ts:488`, `step-agent-in-session-transient-retry.helpers.ts:67` |
| Event-trigger reliability                | In-memory dedup `Map` (comment acknowledges it is not persisted across restarts); bootstrap errors swallowed unless `WORKFLOW_FAIL_ON_BOOTSTRAP_VALIDATION_ERROR` set.                                                           | `workflow-event-trigger.service.ts:36, 82`                                                      |
| Persistence-tier SoC                     | 3 display-name formatters live in the persistence service; `updateRunStatus` sets `run.status = status` directly instead of `run.updateStatus()`.                                                                                | `workflow-persistence.service.ts:31, 43, 184, 263`                                              |

## Goals

1. Remove `@Global()` from `WorkflowModule` and make every consumer import it
   explicitly, injecting through the kernel port tokens.
2. Eliminate the in-module circular dependency.
3. Split the two complexity hotspots (H-4, H-5) into testable units.
4. Finish the two remaining dedup clusters (`isTerminalWorkflowRunStatus`,
   backoff).
5. Close the two reliability gaps (persistent event-trigger dedup + visible
   bootstrap errors; persistence-tier SoC).

## Non-goals

- Kanban-side duplicates (`normalizeOptionalString` in kanban, web inline
  `isTerminalWorkflowRunStatus` is folded in opportunistically only because it is
  a one-line import swap).
- The `MemoryModule ↔ LearningModule` circular dependency (analysis item #14) —
  outside `workflow/`, tracked separately.
- Any change to runtime behavior except the explicitly-scoped Phase 2 reliability
  fixes.

## Constraints

- Core/Kanban boundary preserved (`apps/api/src` and `packages/core` stay
  Kanban-neutral).
- No lint suppressions (`eslint-disable`, `@ts-ignore`, etc.).
- Narrowest-module-boundary rule (`CLAUDE.md` → Workflow Module Boundaries).
- TDD throughout: existing specs are the safety net for pure refactors;
  behavior-change items get a failing test first.
- Each phase is an independently-shippable atomic commit (Phase 2 persistent
  dedup is its own commit because it carries a migration).

## Phased design

Phases are ordered by blast radius, lowest first. Phase 3 must precede Phase 4
(the `@Global` removal cannot land cleanly while the runtime `forwardRef` tangle
remains). Phase 4 is gated on all prior phases.

### Phase 0 — Dedup leftovers (low risk, no DI changes)

- Replace the 3 divergent `isTerminalWorkflowRunStatus` copies with the canonical
  `@nexus/core` export. Care points: the `workflow-runtime-await-actions`
  lowercase `Set` requires normalizing case at the call site to preserve
  behavior; `subagent-orphan-reconciler` swaps array `.includes()` for the
  function; the web inline copy is a one-line import swap.
- Make `workflow-run-auto-retry.helpers.ts` and
  `step-agent-in-session-transient-retry.helpers.ts` delegate to
  `computeExponentialBackoffMs`. Their config uses
  `initialDelayMs`/`maxDelayMs`/`backoffMultiplier`/`jitterRatio` vs. the shared
  `baseMs`/`maxMs`/boolean-jitter shape — an adapter is required. **Behavior must
  be preserved**: write characterization tests over the existing delay outputs
  first; if delegating changes clamping or jitter semantics, document the
  divergence and leave the helper as-is rather than force the consolidation.

### Phase 1 — Complexity hotspots (class-level, isolated)

- **H-4**: extract each git action (`merge`, `provision_worktree`,
  `remove_worktree`, `create_branch`, `commit_paths`) into a `GitActionStrategy`
  implementation behind a small interface, dispatched via a registry map. The
  handler becomes a thin dispatcher delegating to the strategy. Keep the 482-line
  spec green throughout; add focused per-strategy unit tests.
- **H-5**: extract `resolveInvocationInputs`'s flat mapping into a pure, typed
  `InvocationInputsResolver` (validated input DTO → `InvocationInputs`),
  unit-tested in isolation. The 1111-line service spec stays green.

### Phase 2 — Reliability fixes (behavior changes → failing test first)

- **Persistent event-trigger dedup** _(own commit + migration)_: replace the
  in-memory dedup `Map` in `WorkflowEventTriggerService` with a DB-backed dedup
  store (new entity + migration following `adding-entity-migration`), so event
  triggers do not duplicate across process restart. Bounded/evictable to avoid
  unbounded growth.
- **Bootstrap error visibility**: surface swallowed `onModuleInit` registration
  errors. Respect the existing `WORKFLOW_FAIL_ON_BOOTSTRAP_VALIDATION_ERROR`
  flag; when not failing hard, emit a clear, user-visible signal rather than only
  a log line.
- **Persistence-tier SoC**: move `getTriggerDisplayName`,
  `resolveWorkflowRunDisplayName`, and `enrichWorkflowRunDisplayNames` out of
  `WorkflowPersistenceService` into a presentation-tier helper; route
  `updateRunStatus` through the entity's `run.updateStatus()` method.

### Phase 3 — Break the in-module circular dependency

- Resolve `WorkflowRuntimeCapabilityExecutorService ↔ WorkflowRuntimeToolsService`
  by injecting through the existing
  `WORKFLOW_RUNTIME_CAPABILITY_EXECUTOR_SERVICE` /
  `WORKFLOW_RUNTIME_TOOLS_SERVICE` tokens (interface injection), removing the
  `forwardRef`. If token injection alone does not sever the cycle, extract the
  shared dependency into a third unidirectional service.

### Phase 4 — Remove `@Global()` (highest blast radius, last)

- Migrate `RecordLearningService` from concrete `WorkflowEngineService` to the
  `WORKFLOW_ENGINE_SERVICE` token.
- Add explicit `WorkflowModule` imports to `AutomationModule`,
  `Memory`/`LearningModule`, `NotificationsModule`.
- Narrow `WorkflowModule.exports` to the 4 port tokens + re-exported submodules;
  drop concrete-class exports whose consumers can switch to tokens.
- Remove `@Global()`.
- Un-skip the 7 `WorkflowKernelSpec` `forwardRef` tests and make them pass.
- **Phase gate**: full Nest application context compiles (DI smoke), unit suites
  green, lint clean.

## Testing strategy

- Pure refactors (Phases 0, 1, 3): rely on existing specs as the regression net;
  run the relevant spec green before and after each change; add unit tests for
  every newly-extracted unit.
- Behavior changes (Phase 2): Red-Green-Refactor — failing test first for
  persistent dedup, bootstrap visibility, and the `updateRunStatus` routing.
- Phase 4 gate: a Nest `Test.createTestingModule` compile of the affected
  consumer modules plus the un-skipped kernel `forwardRef` tests.

## Risks

- **Phase 4 DI breakage**: removing `@Global` can surface hidden transitive
  injections beyond the 3 known consumers. Mitigation: the kernel compile smoke
  test + incremental module-by-module import addition.
- **Phase 0 backoff semantics**: forcing the shared util may alter retry timing.
  Mitigation: characterization tests gate the swap; divergence is documented and
  left alone if behavior would change.
- **Phase 2 migration**: a new table requires the standard migration review and a
  live-stack smoke before deploy.

## Rollout

Each phase merges independently. Phases 0–1 and 3 are behavior-preserving and
low-risk. Phase 2's migration follows the normal migration path. Phase 4 needs a
DI smoke verification before merge.
