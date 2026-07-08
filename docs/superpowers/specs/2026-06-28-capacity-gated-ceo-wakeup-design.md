# Capacity-Gated CEO Orchestration Wakeup — Design

**Date:** 2026-06-28
**Status:** Approved (brainstorming) — pending implementation plan
**Area:** `apps/kanban` orchestration / lifecycle stream

## Problem

The Project Orchestration Cycle (CEO) workflow (`project_orchestration_cycle_ceo`)
fires far more often than it usefully should. It launches after **every**
work-item automation workflow finishes — e.g. when an item goes
`in-progress → in-review`, then again `in-review → ready-to-merge` — even though
the item is still occupying a dispatch capacity slot the whole time. The cycle
only does useful work when a slot actually frees up (an item merges into `done`)
or when there is genuine headroom/stewardship to act on.

### Root cause

`ProjectOrchestrationWakeupService.requestWakeup()` is the single entry point that
emits `ProjectOrchestrationCycleRequestedEvent`. Its dominant caller is the core
lifecycle stream consumer:

- `apps/kanban/src/core/core-lifecycle-stream.consumer.ts:446` —
  `evaluateContinuationForTerminalRun()` calls `requestWakeup()` for **every**
  terminal workflow run linked to a work item.
- `apps/kanban/src/core/core-lifecycle-stream.helpers.ts:75` —
  `resolveContinuationTrigger()` classifies any `COMPLETED` run carrying a real
  work-item id as `work_item_completed`.

`work_item_completed` is a misnomer: it means "a work-item-linked workflow run
completed," **not** "the work item reached `done`." Because each lifecycle stage
is its own workflow run, every stage transition terminalizes a run and requests a
wakeup.

The wakeup service has gates — human-stop suppression, a 60s coalesce window, and
a cycle lease (`apps/kanban/src/orchestration/project-orchestration-wakeup.service.ts:43`)
— but **none are capacity-aware**. Once the 60s window lapses, the next stage
completion launches a fresh cycle even though no slot freed.

### Existing signal we reuse

A "capacity slot" is already precisely defined by
`isProjectDispatchActive(item)` in
`apps/kanban/src/dispatch/project-dispatch-capacity.ts:24`:

- **Active (consuming a slot):** `in-progress`, `in-review`, `ready-to-merge`, or
  any item with a `linked_run_id` / `current_execution_id` that is not `done`.
- **Terminal (frees a slot):** `done`.

The stale-reconciler path already self-suppresses on project capacity
(`orchestration-continuation-reconciler.service.ts:271`). The lifecycle-stream
path simply does not.

## Goals

1. Stop the CEO cycle from waking on intermediate stage transitions that do not
   free a capacity slot.
2. Keep waking when a run genuinely frees the slot it held (merge → `done`,
   failure → `blocked`, stale-link cleared → inactive).
3. Make the behavior customizable: a global default with a per-project override,
   plus a legacy escape hatch that restores the old fire-on-every-terminal
   behavior.
4. Leave the wakeup service's existing gates (human-stop, coalesce, lease) and
   non-work-item run handling untouched.

## Non-goals

- Changing how non-work-item runs (the CEO cycle itself, lifecycle runs) request
  wakeups.
- Changing the stale reconciler, the 60s coalesce window, or the cycle lease.
- Changing how stages advance (status-changed events still drive the next stage
  workflow independently of the CEO cycle).

## Design

### Behavioral gate: "did this run free the slot it held?"

Add one gate to `evaluateContinuationForTerminalRun()`: only request a wakeup for
a **work-item** terminal run when the owning work item is **no longer consuming a
dispatch slot** after reconciliation.

The signal is the existing `isProjectDispatchActive(item)` predicate applied to
the freshly reloaded work-item record (loaded after
`reconcileTerminalWorkflowRun` has cleared any stale links and after the workflow
itself has transitioned the item's status):

| Post-run item state            | `isProjectDispatchActive` | Decision |
| ------------------------------ | ------------------------- | -------- |
| `done` (merge completed)       | false                     | **wake** |
| `blocked` (failed, parked)     | false                     | **wake** |
| stale link cleared → inactive  | false                     | **wake** |
| `in-review` / `ready-to-merge` | true                      | suppress |
| `in-progress` (retrying)       | true                      | suppress |

Suppressed-but-genuinely-stuck runs remain covered by the stale reconciler
(60s interval), so nothing is permanently stranded.

This **item-level "slot freed"** test is chosen over the board-level
`canLaunchNewWork` test because it matches the requirement exactly ("only when a
work item is no longer taking up a capacity slot") and does not fire on
`in-progress → in-review` merely because the board happens to have spare
headroom.

Non-work-item runs (`workItemRunKind === "other"`) keep their current behavior
and always request a wakeup as they do today.

### Customization

- **Global setting** `orchestration_wake_policy` — enum:
  - `slot_freed` (**default**): apply the gate above.
  - `every_terminal` (legacy escape hatch): always wake on every terminal run, as
    today.
- **Per-project override**: a new nullable `orchestration_settings` JSONB column
  on `kanban_projects`, shape `{ wakePolicy?: 'slot_freed' | 'every_terminal' }`,
  surfaced through the project update DTO.
- **Resolution precedence:** project override → global setting → `slot_freed`
  default.

### Components (each small and independently testable)

1. **Pure resolver** `resolveWakePolicy(projectOverride, globalSetting): WakePolicy`
   — precedence + normalization of unknown values to the default.
2. **Pure decision** `shouldWakeForTerminalRun({ policy, workItemRunKind, itemStillActive }): { wake: boolean; suppressReason?: string }`
   — `every_terminal` ⇒ always wake; non-work-item run ⇒ always wake;
   `slot_freed` ⇒ wake iff `!itemStillActive`.
3. **Consumer wiring** in `evaluateContinuationForTerminalRun()` — after
   `reconcileTerminalWorkflowRun`, reload the work-item record, compute
   `itemStillActive` via `isProjectDispatchActive`, resolve the policy, and skip
   `requestWakeup` with a debug log carrying `suppressReason` when suppressed.
4. **Settings + contracts** — add `orchestration_wake_policy` to the kanban
   settings key union, defaults, and description; add a typed enum read path.
5. **Migration + DTO** — add the `orchestration_settings` column migration and the
   project update DTO field + service plumbing.

### Data flow

```
terminal run event
  → reconcileTerminalWorkflowRun (clear stale links)
  → reload work-item record
  → resolveWakePolicy(project.orchestrationSettings, globalSetting)
  → shouldWakeForTerminalRun({ policy, workItemRunKind, itemStillActive })
      → wake:    requestWakeup()  (existing gates still apply underneath)
      → suppress: debug log (suppressReason), no event
```

### Error handling

- If the work-item reload fails, fail **open** (request the wakeup) so a transient
  read error cannot strand the board — matching the reconciler's
  `resolveProjectDispatchCapacity` catch-and-continue posture.
- Unknown / malformed policy values normalize to `slot_freed`.

## Testing (TDD)

- **Pure-function unit tests** for `resolveWakePolicy` (precedence, unknown-value
  normalization) and `shouldWakeForTerminalRun` (matrix of policy × runKind ×
  active).
- **Consumer tests**: `done` → wakes; `in-review` → suppressed;
  `every_terminal` → always wakes; project override beats global; reload failure
  → fails open.
- **Settings default test** and **migration test** per existing patterns.

## Edge cases

- Failed-and-retrying item stays active → suppressed → stale reconciler catches a
  genuinely stuck run after 60s.
- A stranded link cleared by reconcile flips the item inactive → wakes (correct).
- The CEO run completing is a non-work-item run → unchanged.
- Board at WIP cap during `in-progress → in-review` → suppressed (the original
  symptom).

## Affected files (anticipated)

- `apps/kanban/src/core/core-lifecycle-stream.consumer.ts` (wiring)
- `apps/kanban/src/core/core-lifecycle-stream.helpers.ts` (pure decision, or a new
  sibling helper file)
- `apps/kanban/src/dispatch/project-dispatch-capacity.ts` (reuse predicate; no
  change expected)
- `apps/kanban/src/settings/kanban-settings.constants.ts` + kanban-contracts
  setting key union
- `apps/kanban/src/database/entities/kanban-project.entity.ts` + new migration
- project update DTO / service / controller
- corresponding `*.spec.ts` files
