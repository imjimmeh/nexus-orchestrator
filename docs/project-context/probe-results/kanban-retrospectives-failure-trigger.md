---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: kanban-retrospectives-failure-trigger
outcome: success
inferred_status: missing
confidence_score: 0.97
evidence_refs:
  - apps/kanban/src/retrospectives/kanban-retrospective.service.ts
  - apps/kanban/src/retrospectives/retrospectives.controller.ts
  - apps/kanban/src/retrospectives/retrospectives.module.ts
  - apps/kanban/src/retrospectives/retrospective.types.ts
  - apps/kanban/src/retrospectives/events/cycle-decision-event.handler.ts
  - apps/kanban/src/retrospectives/events/index.ts
  - apps/kanban/src/retrospectives/kanban-retrospective.service.spec.ts
  - apps/kanban/src/retrospectives/retrospectives.controller.spec.ts
  - apps/kanban/src/orchestration/orchestration-cycle-decision.service.ts
  - apps/kanban/src/orchestration/orchestration.service.ts
  - apps/kanban/src/orchestration/control-plane/orchestration-repair-lane.service.ts
  - apps/kanban/src/events/kanban-event-emitter.ts
  - apps/kanban/src/settings/kanban-settings.constants.ts
  - apps/kanban/src/settings/kanban-settings.service.ts
  - packages/kanban-contracts/src/settings.schema.ts
  - docs/work-items/2b8d0c51-ad27-4f10-9448-38502c8bbf35.md
  - docs/epics/EPIC-202-close-ai-self-improvement-loop.md
  - docs/project-context/CODEBASE_HEALTH.md
source_paths:
  - apps/kanban/src/retrospectives/
  - apps/kanban/src/orchestration/
  - apps/kanban/src/core/core-lifecycle-stream.consumer.ts
  - apps/kanban/src/settings/
  - apps/kanban/src/events/
  - packages/kanban-contracts/src/settings.schema.ts
  - docs/work-items/2b8d0c51-ad27-4f10-9448-38502c8bbf35.md
  - docs/epics/EPIC-202-close-ai-self-improvement-loop.md
updated_at: 2026-06-15T19:05:00.000Z
---

# Probe Result: Kanban Retrospectives - Failure Threshold Trigger

## Re-investigation Summary (REFRESH scope)

A REFRESH probe was run after the prior run (`updated_at:
2026-06-15T18:19:21.000Z`) to determine whether todo
`2b8d0c51-ad27-4f10-9448-38502c8bbf35` ("Wire failure_threshold
retrospective trigger in Kanban orchestration") has been addressed. The
current code state is **byte-for-byte equivalent to the prior probe's
findings** for the failure-threshold area: the trigger type literal is
still declared in the union, but no producer, listener, settings key,
controller endpoint, or test references it. The conclusion is unchanged
from the prior run — the wiring gap remains open.

The exhaustive grep result corroborates this: across the entire
repository, `failure_threshold` / `FailureThreshold` / `failure-threshold`
appears in code at exactly one location
(`apps/kanban/src/retrospectives/retrospective.types.ts:20` — the union
literal). `checkFailureThreshold`, `runForFailureThreshold`,
`retrospective_failure_*` and `RetrospectiveFailure` appear nowhere.

The EPIC-202 epic tracker still marks the work as ❌ Open
(`docs/epics/EPIC-202-close-ai-self-improvement-loop.md:29, 59, 100,
157, 235`) and the work item file
`docs/work-items/2b8d0c51-ad27-4f10-9448-38502c8bbf35.md` (title "Wire
failure_threshold retrospective trigger in Kanban orchestration") is
unchanged. The `docs/project-context/CODEBASE_HEALTH.md:36` line still
identifies the failure-threshold trigger as a known open todo.

## Narrative Summary

The failure-threshold trigger path for the Kanban Retrospectives feature
is **not implemented**. The trigger type `"failure_threshold"` is declared
in the `KANBAN_RETROSPECTIVE_TRIGGER_TYPES` union
(`apps/kanban/src/retrospectives/retrospective.types.ts:20`), but the
entire wiring around it is absent: there is no service entry point, no
controller endpoint, no settings key, no event listener, and no event
handler integration. The only two active trigger sources remain the
completion-event path (driven by
`OrchestrationCycleDecisionService.runCompletionRetrospective` on a
`complete` cycle decision) and the manual replay path (driven by
`RetrospectivesController.POST /retrospectives/run`).
`KanbanRetrospectiveService.executeRun` already accepts a
`triggerType` discriminator and builds an idempotency key per call, so
the runtime would naturally support a third trigger source — only the
trigger producers, settings surface, and tests are missing.

## Capability Updates

- **Trigger surface inventory (active sources only)** —
  `KanbanRetrospectiveService` exposes two public methods:
  1. `runForCompletion(trigger: KanbanRetrospectiveCompletionTrigger)` —
     hard-codes `triggerType: "completion_event"`, builds idempotency
     key
     `kanban-retrospective:completion_event:{project_id}:{trigger_revision_marker}`.
     Invoked from `OrchestrationService` via a closure passed to
     `OrchestrationCycleDecisionService` (constructed at
     `apps/kanban/src/orchestration/orchestration.service.ts:100-102`),
     which fires it from `runCompletionRetrospective`
     (`apps/kanban/src/orchestration/orchestration-cycle-decision.service.ts:475-498`)
     after persisting a `complete` cycle decision.
  2. `runManualReplay(dto: RunRetrospectiveDto)` —
     hard-codes `triggerType: "manual_replay"`, builds idempotency key
     `kanban-retrospective:manual_replay:{project_id}:{trigger_revision_marker}`.
     Served by `RetrospectivesController.@Post("run")` after Zod
     validation of the request body via `runRetrospectiveSchema`
     (which accepts `project_id`, `orchestration_id`,
     `trigger_revision_marker`, `replay_of_run_id`, and
     `manual_override`).
- **No third public trigger method has been added** — Searching for
  `runForFailureThreshold` / `checkFailureThreshold` returns zero
  matches. The class has not gained any new public method since the
  prior probe; the latest service-side change is the 2026-05-16 churn
  of the cycle-decision evidence merging logic, not a failure path.
- **Orphan trigger type** — `"failure_threshold"` is a literal member of
  `KANBAN_RETROSPECTIVE_TRIGGER_TYPES`
  (`retrospective.types.ts:18-22`) but is **not** referenced anywhere
  else in the kanban codebase. The `kanban_retrospective_runs.trigger_type`
  column (`character varying(64)` per migration
  `20260516150000-create-kanban-retrospective-runs.ts:13`) and the
  `KanbanRetrospectiveTriggerType` TypeScript union
  (`retrospective.types.ts:130-131`) would both accept the value if
  written, but nothing writes it.
- **No event listener observes workflow-run failure events for
  retrospective dispatch** — The only failure-tracking surface is the
  repair lane:
  `OrchestrationRepairLaneService.recordFailedWorkItemRun`
  (`apps/kanban/src/orchestration/control-plane/orchestration-repair-lane.service.ts:43-72`)
  publishes a `work_item_workflow_run_failed` fact via
  `OrchestrationControlPlaneSchedulerService.publishFact` and creates a
  `repair:failed-work-item-run:*` repair intent. It has no integration
  with `KanbanRetrospectiveService`. The Core lifecycle stream consumer
  (`apps/kanban/src/core/core-lifecycle-stream.consumer.ts:415-423`) is
  the sole caller of `recordFailedWorkItemRun` and likewise never
  invokes the retrospective service. The kanban `EventEmitter2`
  singleton (`apps/kanban/src/events/kanban-event-emitter.ts:25-46`) is
  used only for the
  `kanban.retrospective_cycle_decision_recorded` event — there is no
  listener for any `kanban.*workflow_run_failed*` event on this bus.
- **Settings surface** — `KanbanSettingKeySchema`
  (`packages/kanban-contracts/src/settings.schema.ts:3-14`) enumerates
  twelve keys grouped as `dispatch` and `auto-restart`
  (`apps/kanban/src/settings/kanban-settings.constants.ts:39-127`). No
  `retrospective_failure_threshold_*`, no `retrospectives` group, and no
  threshold or window constant related to workflow-run failure counts
  exists. The closest adjacent capability
  (`orchestration_auto_restart_max_attempts`,
  `orchestration_auto_restart_cooldown_seconds`) governs the repair-lane
  auto-restart behaviour, not retrospective dispatch.
- **Idempotency / cooldown behaviour is already trigger-agnostic** —
  `executeRun` (`kanban-retrospective.service.ts:121-237`) is shared by
  every trigger source: it dedupes on `idempotency_key`
  (`runs.findByIdempotencyKey`), enforces a 15-minute
  `RETROSPECTIVE_COOLDOWN_MS` cooldown (bypassed only by
  `manual_override`), and applies the `no_delta` short-circuit by
  comparing stable-JSON snapshots. The
  `KanbanRetrospectiveCompletionTrigger` shape
  (`retrospective.types.ts:175-182`) — `{ project_id,
  orchestration_id?, trigger_revision_marker, cycle_decision?,
  trigger_details?, manual_override? }` — is the natural envelope for a
  new `runForFailureThreshold(trigger)` entry point.
- **Schema / contract consumers** — The `failure_threshold` literal
  would be safe to add at the runtime layer (column width 64, union
  type narrow), but it cannot be surfaced today because (a) no producer
  exists, (b) no setting gates the threshold or window, and (c) the
  `runRetrospectiveDto` Zod schema does not accept a
  `trigger_revision_marker` shape suitable for a failure window
  (it is a free-form string but is not derived from a failure-event
  payload).
- **Module / DI wiring is unchanged** —
  `apps/kanban/src/retrospectives/retrospectives.module.ts:18-22` still
  registers exactly three providers
  (`KanbanRetrospectiveService`,
  `KanbanRetrospectiveEvidenceService`, `CycleDecisionEventHandler`).
  No `FailureThresholdEventHandler` provider has been added. The
  `onModuleInit` hook still only registers the cycle-decision handler
  via `KanbanRetrospectiveService.onModuleInit()`
  (`kanban-retrospective.service.ts:43-45`).

## Health Findings

- **No tests for the failure-threshold path** —
  `apps/kanban/src/retrospectives/kanban-retrospective.service.spec.ts`
  contains 12 scenarios (lines 93-528) exercising only
  `runForCompletion` and `runManualReplay`. There is no test for a
  `runForFailureThreshold` (or `checkFailureThreshold`) method because
  the method does not exist, no `failure_threshold` trigger type
  assertion, and no spec for a failure-driven event handler. The
  controller spec (`retrospectives.controller.spec.ts`) likewise has no
  failure-threshold coverage — every test still only exercises the
  `run`/`listRuns`/`getProjectStatus` paths.
- **No new files have been added under `apps/kanban/src/retrospectives/`**
  since the prior probe. The directory tree is identical: the
  `events/` folder still contains only
  `cycle-decision-event.handler.ts`,
  `cycle-decision-event.types.ts`,
  `cycle-decision.recorded.event.ts`,
  `cycle-decision.recorded.event.types.ts`, and `index.ts`. There is
  no `failure-threshold-event.handler.ts`,
  `failure-threshold.types.ts`, or analogous producer file.
- **The 2026-05-16 churn of the retrospectives module has not been
  extended** — The trigger types list, evidence service, controller,
  and module wiring were all last touched around 2026-05-16 /
  2026-05-19. The REFRESH probe (2026-06-15) finds no new files or
  modifications that close the failure-threshold gap; the open question
  raised in the prior probe
  (`docs/project-context/probe-results/kanban-retrospectives.md`,
  "Open Questions" section) confirming whether `failure_threshold` is
  reserved for a future scheduler integration remains open and is
  answered here as "still reserved, still not wired."
- **No duplicate type definitions introduced for the missing trigger** —
  The `failure_threshold` literal exists in exactly one place
  (`retrospective.types.ts:20`) and is unused everywhere else.
- **Idempotency / cooldown constants remain hard-coded** — As noted in
  the prior probe, `RETROSPECTIVE_COOLDOWN_MS = 15 * 60 * 1000`
  (`kanban-retrospective.service.ts:39`) is a module-level constant.
  Adding the failure-threshold path will either inherit this cooldown
  (likely appropriate: prevent a storm of failure-triggered retros
  after a single bad run) or require a new `manual_override`-equivalent
  setting; either decision must be reflected in `kanban-settings`.
- **Cross-reference to docs confirms scope** — The epic tracker
  `docs/epics/EPIC-202-close-ai-self-improvement-loop.md:29, 59, 100,
  157, 235` still marks "Wire `failure_threshold` trigger" as ❌ Open
  with the note "Defined in `retrospective.types.ts` but never
  constructed" and the EPIC-202 acceptance criteria still call for a
  `checkFailureThreshold(projectId)` method on
  `KanbanRetrospectiveService` invoked by
  `OrchestrationCycleDecisionService` when consecutive failure events
  exceed a configurable count (default 3). The work item file
  `docs/work-items/2b8d0c51-ad27-4f10-9448-38502c8bbf35.md` reproduces
  the same acceptance criteria verbatim and has not been marked
  completed. The CODEBASE_HEALTH.md also lists this as an open todo.

## Open Questions

- **What constitutes a "failure" for threshold counting?** The codebase
  has at least three failure surfaces with different granularities: a
  work-item workflow run (`work_item_workflow_run_failed` fact, payload
  `{ projectId, workflowRunId, workItemId, status: "FAILED" | "CANCELLED" }`),
  an orchestration run (status transitions to `failed` via
  `OrchestrationStateLifecycleService`), and Core event delivery
  failures (`event_delivery_failed` fact). The threshold semantics (N
  failures in M minutes per project, per workflow run, or per work
  item) need a product-side decision and are not deducible from code
  alone.
- **Should the failure-threshold trigger bypass the 15-minute cooldown
  or respect it?** The current `executeRun` short-circuits on
  `cooldown_active` unless `manual_override === true`. If a project
  produces 10 failures in 5 minutes, the first trigger emits and the
  next nine become `skipped: cooldown_active`. A second setting
  (`retrospective_failure_threshold_bypass_cooldown`?) or a dedicated
  idempotency-key scheme would be needed to allow repeated failure
  emission within a short window.
- **Which event bus should the failure listener subscribe to?** The
  kanban `EventEmitter2` singleton currently carries only the
  retrospective cycle decision event. Failure facts are persisted to
  the control plane (`work_item_workflow_run_failed`,
  `event_delivery_failed`) via `publishFact`, not emitted on the
  in-process bus. The wiring could either (a) extend the `EventEmitter2`
  to emit a new `kanban.workflow_run_failed` /
  `kanban.failure_threshold_crossed` event, or (b) have the
  `OrchestrationRepairLaneService` (or a new sibling) call
  `KanbanRetrospectiveService.runForFailureThreshold` directly, or
  (c) add a polling / cron-driven threshold evaluator. Each choice
  has different latency and reliability characteristics.
- **What settings are required?** At minimum, a count threshold and a
  time window. Possible keys:
  `retrospective_failure_threshold_enabled` (boolean),
  `retrospective_failure_threshold_count` (number, min 1, e.g. default
  3), `retrospective_failure_threshold_window_seconds` (number, e.g.
  default 600). These are not in the contracts schema today and would
  need to be added to both
  `packages/kanban-contracts/src/settings.schema.ts` and
  `apps/kanban/src/settings/kanban-settings.constants.ts`.
- **Is the `trigger_revision_marker` for a failure event deterministic
  across retried emissions?** The cycle-completion path uses
  `cycle-2024-01-15-001` style keys. The failure path needs a
  deterministic, dedupe-friendly key (e.g.
  `failure-threshold:{project_id}:{window_start_epoch}`) so that a
  burst of failure events within the same window collapses to one
  retrospective run.
- **Where should the threshold counter be persisted?** The repair
  lane's `publishFact` produces a fact row with an `expiresAt` of 30
  minutes — suitable for a per-window counter query. A
  `failure_count` aggregate per project could be sourced from a SQL
  query over `control_plane_facts` filtered by `fact_type =
  'work_item_workflow_run_failed'` and a `published_at` window, or
  from an in-process map mirroring the cycle-decision handler pattern.
  The cycle-decision handler uses an in-process map (per
  `cycle-decision-event.handler.ts:51-52`) which would not survive a
  restart; a SQL-backed counter is more durable.
- **Is the prior probe's note that `BoardStateSnapshotService` is
  unused in the active flow relevant to the failure trigger?** Likely
  no — failure evidence is sourced from the same project
  delta-snapshot machinery
  (`KanbanRetrospectiveEvidenceService.collectProjectEvidence`),
  which is already triggered-agnostic.

## Wiring Gap To Close `failure_threshold`

To implement the failure-threshold trigger, the following files would
need to be touched (informational, not committed by this probe):

1. **Contracts** — `packages/kanban-contracts/src/settings.schema.ts`:
   add the new threshold setting keys to `KanbanSettingKeySchema`.
2. **Settings defaults** —
   `apps/kanban/src/settings/kanban-settings.constants.ts`: add
   matching entries to `KANBAN_SETTING_DEFAULTS` (new `retrospectives`
   group).
3. **Service surface** —
   `apps/kanban/src/retrospectives/kanban-retrospective.service.ts`:
   add `runForFailureThreshold(trigger: KanbanRetrospectiveCompletionTrigger)`
   (or `checkFailureThreshold(projectId)` per the EPIC-202
   acceptance criteria) that calls `executeRun` with
   `triggerType: "failure_threshold"` and a deterministic
   idempotency key.
4. **Event listener / dispatcher** — New file under
   `apps/kanban/src/retrospectives/events/failure-threshold-event.handler.ts`
   (or extend `cycle-decision-event.handler.ts`) that observes failure
   facts, counts them per project within the configured window, and
   invokes `runForFailureThreshold` when the threshold is crossed.
5. **Module wiring** —
   `apps/kanban/src/retrospectives/retrospectives.module.ts`: register
   the new handler in `providers`, call its `register()` method from
   `KanbanRetrospectiveService.onModuleInit` (or a dedicated module
   `onModuleInit`).
6. **Failure source integration** — Touch
   `apps/kanban/src/orchestration/control-plane/orchestration-repair-lane.service.ts`
   (or `apps/kanban/src/core/core-lifecycle-stream.consumer.ts`) to
   notify the new handler when a failure fact is published.
7. **Tests** — Add scenarios to
   `apps/kanban/src/retrospectives/kanban-retrospective.service.spec.ts`
   (one per state: emits, dedup, cooldown-bypass, insufficient
   evidence), add a new `failure-threshold-event.handler.spec.ts`,
   and update `retrospectives.controller.spec.ts` if a new endpoint
   is exposed (none appears strictly necessary — the trigger should
   remain an internal producer).
