# Honor Orchestration Lifecycle `status` as an Auto-Wake Stop Signal

**Date:** 2026-06-20
**Status:** Approved (design)
**Area:** `apps/kanban` — project orchestration auto-wake

## Context

A CEO orchestration cycle (run `7a8be0c5`) launched against project `458935f0` even though the
project's orchestration showed as "complete / not running" in the UI. Investigation traced the
trigger to a **manually-triggered merge workflow that failed**:

1. Merge run `f2bd1885` (workflow _"Work Item Ready-to-Merge Default Auto-Merge"_) failed at
   `20:43:53`.
2. The API published a terminal `core.workflow.run.*` (FAILED) event onto the `core_lifecycle_stream`.
3. `CoreLifecycleStreamConsumer.handleTerminalWorkflowRun`
   (`apps/kanban/src/core/core-lifecycle-stream.consumer.ts:316`) classified it via
   `resolveContinuationTrigger(...)` → `workflow_failed` and called
   `ProjectOrchestrationWakeupService.requestWakeup({ reason: "workflow_failed", source: "core_lifecycle_stream" })`.
4. The suppression check passed, the cycle lease was acquired, and a fresh CEO cycle dispatched at
   `20:44:02` (9s after the failure).

### Root cause

`OrchestrationService.complete()` and `pause()` flip the persisted
`kanban_orchestrations.status` column to `completed` / `paused`, but **never record a suppressing
`cycle_decision`**. The auto-wake suppression authority
(`OrchestrationObservabilityService.getAutoWakeSuppressionState` →
`resolveNonAutoWakeDecision`, `apps/kanban/src/orchestration/orchestration-stop-decisions.ts`)
reads **only** `cycle_decision` / `decision_log` — it never consults `status`.

For project `458935f0` the DB confirmed the decoupling: `status = "completed"` but
`metadata.cycle_decision = "repeat"` with all 92 decision-log entries `repeat`. Because `repeat` is
not in `NON_AUTO_WAKE_DECISIONS` (`{ pause, complete, blocked }`), suppression returned
`suppressed: false`, so the project stayed auto-wake-armed and any terminal workflow event — including
the hand-fired merge — re-woke the CEO loop.

The `status` column is the field the UI shows and the operator controls (set only by the explicit
`complete_orchestration` MCP tool and the `orchestration.controller` HTTP endpoint — never by an
automatic per-cycle path), so "completed" is a **deliberate, durable** state, not transient.

## Decision

Make the persisted lifecycle **`status`** a first-class auto-wake suppression signal, keeping a single
suppression authority.

`OrchestrationObservabilityService.getAutoWakeSuppressionState(state)` returns `suppressed: true` when:

- the existing decision-based check matches (`cycle_decision` ∈ `{ pause, complete, blocked }`), **or**
- `state.status` ∈ **`{ "completed", "paused" }`** (the stopped lifecycle states).

Active states (`initializing`, `orchestrating`) do not suppress.

The existing guard in `requestWakeup` is unchanged:

```ts
if (suppressionState.suppressed && this.isAutomaticWakeup(input)) {
  return { emitted: false, reason: "orchestration_auto_wake_suppressed" };
}
```

Consequences of reusing this guard, by design:

- **Automatic** sources (`core_lifecycle_stream`, `orchestration_continuation_reconciler`,
  `revision_complete`) are suppressed when the project is stopped.
- **Manual** wakeups (operator-initiated) bypass the guard — i.e. a stopped project does not auto-wake
  **until manually resumed**.

### Why honor `status` rather than also writing a `cycle_decision` in `complete()`/`pause()`

Single source of truth. `status` is the operator-facing lifecycle field; coupling suppression to it
removes the decoupling bug at its source and simultaneously fixes the identical latent `pause()` bug.
Writing a decision inside `complete()`/`pause()` as well would be redundant belt-and-suspenders — out of
scope (YAGNI).

### Resume / re-arm

`resume()` and `start()` already set `status = "orchestrating"` (and `start()` additionally clears
`cycle_decision` and resets `decision_log`), so an explicit operator resume or restart re-arms auto-wake.
No new state, column, or migration is required — we read an existing column.

### Deliberate, documented consequence

Once `completed` (or `paused`), a project will **not** auto-wake even if new ready work appears or a
reconciler tick fires — it waits for a manual resume. This matches the "complete should mean complete"
intent and must be documented so it is not mistaken for a regression.

## Scope / Blast Radius

In scope:

- `apps/kanban/src/orchestration/orchestration-observability.service.ts` —
  `getAutoWakeSuppressionState` also suppresses on stopped `status`.
- Supporting type/helper adjustments if the suppression result needs to convey a status-based reason.
- Tests (unit + targeted integration).
- Documentation note (`docs/guide` orchestration section).

Out of scope:

- No `@nexus/core` event-schema change, no API emitter change, no provenance/`launch_source` threading.
- No database schema or migration.
- No change to `complete()` / `pause()` write paths.
- No change to the `requestWakeup` guard structure, coalesce windows, or cycle-lease logic.

## Testing (TDD)

`getAutoWakeSuppressionState` (unit):

- `status: "completed"`, `cycle_decision: "repeat"` → `suppressed: true`.
- `status: "paused"`, no decision → `suppressed: true`.
- `status: "orchestrating"`, `cycle_decision: "repeat"` → `suppressed: false` (regression guard: the
  normal autonomous loop must keep auto-waking).
- `status: "orchestrating"`, `cycle_decision: "pause"` → `suppressed: true` (existing behavior intact).

`ProjectOrchestrationWakeupService.requestWakeup` (unit):

- automatic source (`core_lifecycle_stream`) + `status: "completed"` →
  `{ emitted: false, reason: "orchestration_auto_wake_suppressed" }`.
- manual source + `status: "completed"` → still emits (resume path unaffected).

Integration / consumer:

- A terminal `workflow_failed` lifecycle event for a `completed` project does **not** dispatch a CEO
  cycle (reproduces the `7a8be0c5` scenario and asserts it no longer occurs).

## Verification

- `npm run test:kanban` (targeted files first), `npm run lint:kanban`.
- Live re-verify after kanban rebuild/redeploy: mark a project `completed`, fail a manual workflow in its
  scope, confirm no orchestration cycle is dispatched; then `resume` and confirm auto-wake re-arms.
