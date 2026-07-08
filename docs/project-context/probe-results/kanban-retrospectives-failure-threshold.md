---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: kanban-retrospectives-failure-threshold
outcome: success
inferred_status: implemented
confidence_score: 0.95
evidence_refs:
  - apps/kanban/src/retrospectives/kanban-retrospective-failure-threshold.service.ts
  - apps/kanban/src/retrospectives/kanban-retrospective-failure-threshold.types.ts
  - apps/kanban/src/retrospectives/kanban-retrospective-failure-threshold.service.spec.ts
  - apps/kanban/src/retrospectives/kanban-retrospective.service.ts
  - apps/kanban/src/retrospectives/retrospectives.module.ts
  - apps/kanban/src/orchestration/orchestration-cycle-decision.service.ts
  - apps/kanban/src/orchestration/orchestration-continuation.types.ts
  - apps/kanban/src/orchestration/orchestration-continuation.service.ts
  - apps/kanban/src/orchestration/orchestration-continuation-reconciler.service.ts
  - apps/kanban/src/orchestration/orchestration.service.ts
  - apps/kanban/src/orchestration/orchestration-cycle-decision.service.spec.ts
  - apps/kanban/src/orchestration/orchestration-continuation.poll-fallback.spec.ts
  - apps/kanban/src/orchestration/orchestration-continuation-reconciler.service.spec.ts
  - apps/kanban/src/retrospectives/kanban-retrospective.integration.spec.ts
  - apps/kanban/test/retrospectives/retrospective-lifecycle.integration-spec.ts
source_paths:
  - apps/kanban/src/retrospectives/kanban-retrospective-failure-threshold.service.ts
  - apps/kanban/src/retrospectives/kanban-retrospective-failure-threshold.types.ts
  - apps/kanban/src/retrospectives/kanban-retrospective-failure-threshold.service.spec.ts
  - apps/kanban/src/retrospectives/kanban-retrospective.service.ts
  - apps/kanban/src/retrospectives/retrospectives.module.ts
  - apps/kanban/src/orchestration/orchestration-cycle-decision.service.ts
  - apps/kanban/src/orchestration/orchestration-continuation.types.ts
  - apps/kanban/src/orchestration/orchestration-continuation.service.ts
  - apps/kanban/src/orchestration/orchestration-continuation-reconciler.service.ts
  - apps/kanban/src/orchestration/orchestration.service.ts
  - apps/kanban/src/orchestration/orchestration-cycle-decision.service.spec.ts
  - apps/kanban/src/orchestration/orchestration-continuation.poll-fallback.spec.ts
  - apps/kanban/src/orchestration/orchestration-continuation-reconciler.service.spec.ts
  - apps/kanban/src/retrospectives/kanban-retrospective.integration.spec.ts
  - apps/kanban/test/retrospectives/retrospective-lifecycle.integration-spec.ts
updated_at: 2026-06-17T19:30:00.000Z
---

# Probe Result: Kanban Retrospectives - Failure Threshold Trigger

## Narrative Summary

The `failure_threshold` retrospective trigger for work item
`2b8d0c51-ad27-4f10-9448-38502c8bbf35` is **fully implemented and wired
end-to-end** between kanban orchestration and the retrospectives module.
The 18th-pass probe (`kanban-retrospectives-failure-trigger`,
`updated_at: 2026-06-15T19:05:00.000Z`) flagged this as MISSING; the
19th-pass coordinate job's claim that the implementation has merged is
confirmed on disk. All five expected artefacts are present:

1. **`KanbanRetrospectiveFailureThresholdService`** owns the
   `consecutive_failure_count` counter on the orchestration's
   `metadata.consecutive_failure_count` field, persists the increment
   via `KanbanOrchestrationRepository.save`, and fires a
   `failure_threshold` retrospective via
   `KanbanRetrospectiveService.runForFailureThreshold` when the new
   count meets or exceeds the configurable
   `FAILURE_THRESHOLD_COUNT` env var (default 3).
2. **`IKanbanRetrospectiveFailureThresholdService`** interface plus the
   `KANBAN_RETROSPECTIVE_FAILURE_THRESHOLD_SERVICE` injection token.
3. **`KanbanRetrospectiveService.runForFailureThreshold`** public method
   delegating to the trigger-agnostic `executeRun` with
   `triggerType: "failure_threshold"`.
4. **`OrchestrationCycleDecisionService.CycleDecisionInput`** extended
   with the `consecutiveFailure?: boolean` field, and the service
   invokes `failureThresholdService.checkFailureThreshold` synchronously
   when the flag is set, while also draining a
   `pending_consecutive_failure_count` flag persisted by the
   orchestrator-side reconciler.
5. **`RetrospectivesModule`** registers the new service as a provider
   under both the concrete class and the `useExisting` token binding,
   and exports both — so `OrchestrationModule` (which already imports
   `RetrospectivesModule`) sees the service via constructor injection
   into `OrchestrationService`.

In short: this scope is no longer a TODO. The orchestration side has
two producers that feed the trigger — the synchronous FAILED signal from
`OrchestrationContinuationService.reconcileLinkedRunForStaleState` and
the state-marking path from
`OrchestrationContinuationReconcilerService.maybeMarkPendingConsecutiveFailure`
— and `OrchestrationCycleDecisionService` is the sole orchestrator-side
caller of `checkFailureThreshold` (per the inline comments at
`orchestration-cycle-decision.service.ts:108-112` and the cross-service
contract at `orchestration.service.ts:104-110`).

## Capability Updates

### A. `KanbanRetrospectiveFailureThresholdService` — class on disk with counter ownership + threshold firing

File:
`apps/kanban/src/retrospectives/kanban-retrospective-failure-threshold.service.ts`

- Class declaration (lines 30-32):
  ```ts
  export class KanbanRetrospectiveFailureThresholdService
    implements IKanbanRetrospectiveFailureThresholdService
  ```
- Counter ownership: `checkFailureThreshold(projectId)` (line 50)
  reads `metadata.consecutive_failure_count` (line 69), increments
  (line 70), persists via `KanbanOrchestrationRepository.save` (line
  73-83), and then evaluates the threshold (line 100).
- Threshold firing: when `newCount >= threshold` (line 101), calls
  `this.retrospectives.runForFailureThreshold(...)` (line 118-122).
- Counter reset: `resetConsecutiveFailureCount(projectId)` (line 130).
- Helpers: `getRecordMetadata` (line 156), `formatErrorMessage` (line
  162), `readFailureThresholdCount` (line 9-11).

### B. Interface + DI token

File:
`apps/kanban/src/retrospectives/kanban-retrospective-failure-threshold.types.ts`

- Token constant (lines 8-9):
  ```ts
  export const KANBAN_RETROSPECTIVE_FAILURE_THRESHOLD_SERVICE =
    "KANBAN_RETROSPECTIVE_FAILURE_THRESHOLD_SERVICE";
  ```
- Interface declaration (lines 20-40): defines `checkFailureThreshold`
  and `resetConsecutiveFailureCount`.

### C. `runForFailureThreshold` on the retrospective service

File: `apps/kanban/src/retrospectives/kanban-retrospective.service.ts`
(lines 533-552). Method delegates to `this.executeRun` with
`triggerType: "failure_threshold"` and the supplied `idempotencyKey`
(`retro:failure:<projectId>:<count>`).

### D. `FAILURE_THRESHOLD_COUNT` env var (default 3)

File:
`apps/kanban/src/retrospectives/kanban-retrospective-failure-threshold.service.ts`

- `const DEFAULT_FAILURE_THRESHOLD_COUNT = 3;` (line 6).
- `function readFailureThresholdCount()` (lines 9-11) reads
  `Number(process.env.FAILURE_THRESHOLD_COUNT)`, falls back to the
  default for non-finite / non-positive values.
- Called from `checkFailureThreshold` at line 100:
  `const threshold = readFailureThresholdCount();`.

### E. `RetrospectivesModule` provider registration

File: `apps/kanban/src/retrospectives/retrospectives.module.ts`
- Concrete provider (line 22):
  `KanbanRetrospectiveFailureThresholdService`.
- Token-based `useExisting` binding (lines 25-28):
  `KANBAN_RETROSPECTIVE_FAILURE_THRESHOLD_SERVICE →
  KanbanRetrospectiveFailureThresholdService`.
- Exports (lines 30-37) the concrete class, the token binding, and the
  `IKanbanRetrospectiveFailureThresholdService` type token.

`OrchestrationModule` imports `RetrospectivesModule`
(`apps/kanban/src/orchestration/orchestration.module.ts:39`), so the
service is reachable via constructor injection. This is exercised in
`OrchestrationService` (constructor parameter at line 93) and asserted
by the decorator metadata test
(`apps/kanban/src/orchestration/orchestration.service.spec.ts:147-177`).

### F. `OrchestrationCycleDecisionService.CycleDecisionInput.consecutiveFailure`

File: `apps/kanban/src/orchestration/orchestration-cycle-decision.service.ts`

- Local `CycleDecisionInput` type (lines 20-36) includes
  `consecutiveFailure?: boolean` (line 35).
- The corresponding field is also surfaced on
  `OrchestrationService.recordCycleDecision`'s input type
  (`apps/kanban/src/orchestration/orchestration.service.ts:537`) and on
  the higher-level `EvaluateContinuationInput`
  (`apps/kanban/src/orchestration/orchestration-continuation.types.ts:32`).
- The cycle decision service consumes the flag at line 167:
  `if (args.input.consecutiveFailure === true)`.

### G. Co-located spec coverage

File:
`apps/kanban/src/retrospectives/kanban-retrospective-failure-threshold.service.spec.ts`
(332 lines). Test cases:

**`describe("checkFailureThreshold")`** (13 cases, lines 45-241):
- "does nothing when no orchestration exists for the project"
- "skips the trigger when the new count is below the configured threshold"
- "persists the incremented counter on every call (single point of mutation)"
- "starts from 1 when no previous consecutive_failure_count exists"
- "increments an existing consecutive_failure_count"
- "handles null metadata on the orchestration and starts at 1"
- "does not modify other metadata keys when incrementing the counter"
- "fires the retrospective when the new count hits the default threshold of 3"
- "fires the retrospective when the new count exceeds the threshold"
- "builds the idempotency key in the format 'retro:failure:<projectId>:<count>'"
- "respects a custom FAILURE_THRESHOLD_COUNT env var"
- "ignores non-numeric FAILURE_THRESHOLD_COUNT and falls back to 3"
- "bails out without firing when the orchestration save throws"

**`describe("resetConsecutiveFailureCount")`** (5 cases, lines 246-308):
- "is a no-op when no orchestration exists for the project"
- "is a no-op when the counter is already 0"
- "resets a non-zero counter back to 0"
- "preserves other metadata keys when resetting"
- "does not throw when the orchestration save fails"

Plus integration coverage:

- `apps/kanban/src/retrospectives/kanban-retrospective.integration.spec.ts`
  (the canonical end-to-end suite for the failure-threshold path):
  - "does NOT create a run when the incremented count is below the default threshold"
  - "creates a run with trigger_type='failure_threshold' when at the threshold"
  - "completes the retrospective run when evidence is available"
  - "uses the idempotency key format 'retro:failure:<projectId>:<count>'"
  - "fires when the incremented count exceeds the threshold"
  - "skips a duplicate idempotency key and returns the existing run ID"
  - "end-to-end: increments consecutive_failure_count across multiple workflow failures and triggers at the third"
  - "initialises count to 1 when metadata is null"
  - "is a no-op when no orchestration exists for the project"
  - "respects FAILURE_THRESHOLD_COUNT env var for the threshold check"
  - "does not erase other metadata keys when incrementing the counter"
  - "resetConsecutiveFailureCount returns the counter to 0"
  - "resetConsecutiveFailureCount is a no-op when the counter is already 0"
  - "resetConsecutiveFailureCount is a no-op when no orchestration exists"
- `apps/kanban/test/retrospectives/retrospective-lifecycle.integration-spec.ts`
  (`describe("KanbanRetrospectiveService failure_threshold trigger acceptance")`,
  line 807 onward): 5 acceptance tests asserting run creation,
  persistence of consecutive_failure_count, env-var override, and
  no-orchestration short-circuit.

Orchestrator-side coverage:

- `apps/kanban/src/orchestration/orchestration-cycle-decision.service.spec.ts`:
  16 scenarios across four describe blocks
  (`recordCycleDecision failure-threshold trigger`,
  `recordCycleDecision drains pending consecutive failures`,
  `recordCycleDecision resets the counter on a complete decision`,
  `recordCycleDecision safety guards preserve failure trigger`).
  These cover the synchronous trigger, the missing/false branch, error
  swallow behaviour, the pending-drain replay path, duplicate-replay
  interleaving, the clear-error tolerance, the complete-decision reset,
  and the failure-vs-reset precedence on a `complete` decision with
  `consecutiveFailure: true`.
- `apps/kanban/src/orchestration/orchestration-continuation.poll-fallback.spec.ts`:
  asserts that `evaluateProjectContinuation` is invoked with
  `consecutiveFailure: true` when the linked run's status is `FAILED`
  (lines 370-422) and not when the status is `COMPLETED` (lines
  424-…).
- `apps/kanban/src/orchestration/orchestration-continuation-reconciler.service.spec.ts`:
  describes the `FAILED workflow retrospective` block
  (line 813) — 5 tests asserting that
  `markPendingConsecutiveFailure` is called with the failed-run count
  when reconciled runs are `FAILED`, that it is not called when none
  are FAILED, and that errors are tolerated.

### H. End-to-end invocation path

The trigger fires from two producers on the orchestration side, both
funneled through `OrchestrationCycleDecisionService.recordCycleDecision`:

1. **Synchronous FAILED signal path** — when
   `OrchestrationContinuationService.reconcileLinkedRunForStaleState`
   resolves the linked workflow run to `FAILED`, it returns
   `{ kind: "noLinkedRun", consecutiveFailure: true }`
   (`apps/kanban/src/orchestration/orchestration-continuation.service.ts:333-334`).
   The outer poll loop then calls
   `evaluateProjectContinuation({ projectId, trigger: "poll_reconciliation", consecutiveFailure: true })`
   (lines 286-287), which routes through
   `OrchestrationService.recordCycleDecision` →
   `OrchestrationCycleDecisionService.recordCycleDecision`. Inside the
   cycle decision service, the `consecutiveFailure === true` branch
   (`orchestration-cycle-decision.service.ts:167-169`) invokes
   `this.runFailureThresholdTrigger(args.projectId)` →
   `this.deps.failureThresholdService.checkFailureThreshold(projectId)`
   (line 564).

2. **State-driven / pending-count path** —
   `OrchestrationContinuationReconcilerService.maybeMarkPendingConsecutiveFailure`
   (`apps/kanban/src/orchestration/orchestration-continuation-reconciler.service.ts:163-185`)
   calls `orchestrationService.markPendingConsecutiveFailure(...)` when
   the periodic stale-reconciler detects FAILED linked runs. The
   orchestration's `metadata.pending_consecutive_failure_count` is
   incremented. On the next cycle decision,
   `OrchestrationCycleDecisionService.drainPendingConsecutiveFailure`
   (lines 587-610) replays the pending count as successive
   `checkFailureThreshold` calls and clears the pending flag via
   `this.deps.clearPendingConsecutiveFailure(args.projectId)`.

The `OrchestrationService` constructor injects
`IKanbanRetrospectiveFailureThresholdService` (line 93) and passes it
into the `OrchestrationCycleDecisionService` constructor (line 111), so
the wiring is real DI — not a stub. The decorator-metadata test in
`orchestration.service.spec.ts:147-177` verifies that the design:paramtypes
entry for the failure-threshold parameter is `Object` (the
interface-erased marker), confirming the interface-based decoupling
described in the types file.

In summary: the new service has both a direct caller (the cycle
decision service, exercising the synchronous trigger) and a
state-mediated caller (the reconciler, exercising the drain path).
Neither producer is "orphan": both are wired through NestJS DI in
`OrchestrationModule` and `RetrospectivesModule`.

### I. Status of remaining open issues from the 18th-pass probe

- **FAILED-path integration test** — Closed. The acceptance suite in
  `apps/kanban/test/retrospectives/retrospective-lifecycle.integration-spec.ts`
  plus the in-tree integration spec
  `apps/kanban/src/retrospectives/kanban-retrospective.integration.spec.ts`
  exercise the FAILED-path end-to-end with real (in-memory) repository
  and evidence mocks, asserting run creation, status, idempotency key,
  trigger type, core-event emission, and counter persistence.
- **Settings key** — Partially open / design choice. The 18th-pass
  probe flagged the absence of `retrospective_failure_threshold_*`
  keys in `packages/kanban-contracts/src/settings.schema.ts` and
  `apps/kanban/src/settings/kanban-settings.constants.ts`. This
  implementation deliberately routes the threshold through the
  `FAILURE_THRESHOLD_COUNT` env var instead of the settings table
  (`apps/kanban/src/retrospectives/kanban-retrospective-failure-threshold.service.ts:6-11`).
  This is consistent with the work-item spec at
  `docs/work-items/2b8d0c51-ad27-4f10-9448-38502c8bbf35.md` (which
  calls for "FAILURE_THRESHOLD_COUNT (env var, default 3)"). It is a
  deliberate divergence from the broader EPIC-202 acceptance criteria
  the 18th-pass probe inferred, which mentioned settings keys. If the
  team wants the threshold to be runtime-tunable per project, a
  follow-up would need to extend
  `packages/kanban-contracts/src/settings.schema.ts` and call
  `KanbanSettingsService.getNumber(...)` instead of (or in addition
  to) the env var. As shipped, the env-var approach matches the work
  item, and there is no settings key.
- **Event listener** — Closed by design. The 18th-pass probe asked
  whether a `FailureThresholdEventHandler` would be added on the
  kanban `EventEmitter2` singleton. The implementation instead
  uses (a) a synchronous in-band signal through the cycle-decision
  flow (driven by the reconciler/continuation services detecting FAILED
  workflow-run status) and (b) a state-driven drain on the next cycle
  decision. The `kanban-event-emitter.ts` bus is unchanged and the
  `CycleDecisionEventHandler` is unchanged. This satisfies the work
  item's "Wire failure_threshold retrospective trigger in Kanban
  orchestration" wording without introducing a new event-listener
  surface. A future enhancement could publish a
  `kanban.failure_threshold_crossed` event on the in-process bus for
  downstream observers, but it is not required by the work item.

## Health Findings

- **Test coverage is comprehensive** — 332-line co-located unit spec
  for the new service, 13 integration scenarios in
  `kanban-retrospective.integration.spec.ts`, 5 acceptance scenarios in
  `retrospective-lifecycle.integration-spec.ts`, 16 orchestrator-side
  scenarios in `orchestration-cycle-decision.service.spec.ts`, plus
  producer-side coverage in
  `orchestration-continuation.poll-fallback.spec.ts` (FAILED path) and
  `orchestration-continuation-reconciler.service.spec.ts` (5
  markPendingConsecutiveFailure tests).
- **Best-effort error semantics on the cycle decision path** — both
  `runFailureThresholdTrigger` (line 555-570) and
  `runFailureCounterReset` (line 614-624) on
  `OrchestrationCycleDecisionService` log and swallow errors so a
  retro/historic-store hiccup cannot break the orchestration cycle
  decision path. The drain's `clearPendingConsecutiveFailure` step is
  similarly tolerant (line 600-606).
- **Decoupled via interface + token** — the threshold service is
  consumed by `OrchestrationService` through the
  `IKanbanRetrospectiveFailureThresholdService` interface, not the
  concrete class. The cycle decision service depends on the same
  interface. This keeps cross-module coupling narrow and consistent
  with the project's NestJS interface-extraction pattern
  (`IKanbanRetrospectiveFailureThresholdService` mirrors the
  `IKanbanRetrospectiveService` style).
- **Counter is durable** — the
  `consecutive_failure_count` lives in `orchestration.metadata` and is
  persisted via `KanbanOrchestrationRepository.save` on every
  increment, so the counter survives a process restart. This is more
  robust than the prior in-process map approach the 18th-pass probe
  noted for `CycleDecisionEventHandler`.
- **Idempotency** — `runForFailureThreshold` uses the deterministic
  key `retro:failure:<projectId>:<count>` (constructed at
  `kanban-retrospective-failure-threshold.service.ts:120`), so a
  retried threshold call within the same count is deduped by
  `findByIdempotencyKey` in `executeRun`. The integration spec
  explicitly asserts this dedup behaviour at
  `kanban-retrospective.integration.spec.ts` ("skips a duplicate
  idempotency key and returns the existing run ID").
- **Retrospectives controller is unchanged** — there is no new HTTP
  endpoint for the failure-threshold trigger, which is correct: the
  trigger is internal and synchronous, not user-driven. The
  `runForCompletion` and `runManualReplay` public surface remains
  intact.
- **No new lint or boundary violations** — the failure-threshold
  service lives under `apps/kanban/src/retrospectives/`, fully
  inside the Kanban app, so the
  `nexus-boundaries/no-core-kanban-residue` rule continues to be
  satisfied. The orchestrator-side changes are also confined to
  `apps/kanban/src/orchestration/`.
- **Module cycle resolution** — `OrchestrationModule` imports
  `RetrospectivesModule` (line 39), and `RetrospectivesModule`
  imports `CoreIntegrationModule` and `DatabaseModule` (lines 14-15)
  but does **not** import `OrchestrationModule`. Therefore no
  `forwardRef` was needed for this scope; the cycle decision is the
  boundary.
- **Churn signal** — the relevant files are recent (timestamps in
  service spec headers are 2026-05-16, 2026-06-13, 2026-06-17,
  consistent with a fresh implementation landing around the 19th-pass
  coordinate cycle).

## Open Questions

- **Should `FAILURE_THRESHOLD_COUNT` also be exposed as a Kanban
  settings key?** The 18th-pass probe's open question (and the broader
  EPIC-202 acceptance criteria) called for a
  `retrospective_failure_threshold_count` settings key. The shipped
  implementation uses only the env var. If runtime per-project tuning
  is required, a follow-up would need to add the key to
  `packages/kanban-contracts/src/settings.schema.ts` and route the
  read through `KanbanSettingsService.getNumber(...)` inside the new
  service (or as a fallback when the env var is unset). Product
  decision pending.
- **Should there also be a `retrospective_failure_threshold_window_*`
  setting?** The 18th-pass probe also floated a windowed
  "N failures in M minutes" semantics. The shipped implementation
  uses an unbounded consecutive counter — any number of consecutive
  failures eventually triggers, but only one retrospective is fired per
  threshold-crossing (because `executeRun` dedupes on
  `retro:failure:<projectId>:<count>` and the counter only increments
  on further failures). If the team wants the trigger to suppress
  re-firing within a cooldown window after a failure-threshold
  retrospective completes, the existing 15-minute
  `RETROSPECTIVE_COOLDOWN_MS` cooldown in
  `kanban-retrospective.service.ts:39` already applies (and is
  bypassed only by `manual_override`, which the failure path does not
  set), so this is largely a non-issue. The `no_delta` short-circuit
  may also block re-firing if the delta snapshot hasn't changed — see
  the next open question.
- **Will the `no_delta` short-circuit suppress repeated
  failure-threshold firings?** `executeRun` has a `no_delta`
  short-circuit (lines 169-178) that compares the current
  `deltaSnapshot` against the most recent completed run's snapshot via
  `toStableJson`. If a project fails three times in a row without any
  board-state change between firings, the first failure-threshold
  retrospective would emit and the next one (if the counter were ever
  reset/re-incremented to the threshold with the same snapshot) would
  be skipped as `no_delta`. In practice the counter does not reset
  while failures continue (only on `complete`), so this is mostly a
  latent concern. Product decision pending if the team wants repeated
  failure-threshold firings even when the snapshot is unchanged.
- **Are the `consecutive_failure_count` and
  `pending_consecutive_failure_count` counters persisted on every
  failure?** Yes — the failure-threshold service persists on every
  `checkFailureThreshold` call (line 73-83) and
  `OrchestrationService.markPendingConsecutiveFailure` persists the
  pending flag on every reconciler detection
  (`orchestration.service.ts:589-605`). However, the schema and
  column types for these new metadata keys are implicit
  (`JSONB`-shaped under `metadata`); if migrations need to add a
  dedicated column or index, that's a separate concern. As of this
  probe, no migration has been added for these counters.
- **Why is `IKanbanRetrospectiveFailureThresholdService` exported
  from `RetrospectivesModule` as a value (not just a type)?** In
  `retrospectives.module.ts:35`, the interface symbol is listed under
  `exports`. As an interface it is type-only at runtime and is
  stripped by the TypeScript compiler, so this entry is benign but
  slightly misleading. If the team prefers, a follow-up could remove
  the value-position export since the `useExisting` token binding on
  line 26 already exposes the runtime instance.

## Resolution

The 18th-pass probe (`kanban-retrospectives-failure-trigger`) is
superseded. The 19th-pass coordinate job's report is accurate: all
five expected artefacts are present and the wiring is complete end to
end. This scope is `implemented`.