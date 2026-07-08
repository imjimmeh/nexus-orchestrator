---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: war-room-collaboration
outcome: success
inferred_status: implemented
confidence_score: 0.9
evidence_refs:
  - apps/api/src/war-room/war-room.module.ts
  - apps/api/src/war-room/war-room.service.invite.ts
  - apps/api/src/war-room/war-room.service.post-message.ts
  - apps/api/src/war-room/war-room.service.update-blackboard.ts
  - apps/api/src/war-room/war-room.service.consensus.ts
  - apps/api/src/war-room/war-room.service.submit-signoff.ts
  - apps/api/src/war-room/war-room-workflow-event-log.service.ts
  - apps/api/src/war-room/war-room.service.shared.ts
source_paths:
  - apps/api/src/war-room/war-room.module.ts
  - apps/api/src/war-room/war-room.service.invite.ts
  - apps/api/src/war-room/war-room.service.post-message.ts
  - apps/api/src/war-room/war-room.service.update-blackboard.ts
  - apps/api/src/war-room/war-room.service.consensus.ts
  - apps/api/src/war-room/war-room.service.submit-signoff.ts
  - apps/api/src/war-room/war-room-workflow-event-log.service.ts
  - apps/api/src/war-room/war-room.service.shared.ts
updated_at: 2026-06-24T00:00:00.000Z
work_item: WI-2026-051
---

# Probe Result: War Room - Collaboration Half

## Narrative Summary

The `war-room-collaboration` scope is **fully implemented**. It covers the
in-room multi-party collaboration operations of the war-room module:
**invite** (add participant), **post-message**, **update-blackboard**
(shared blackboard write), **consensus** (consensus-state resolution
helper), and **submit-signoff** (record a sign-off against an open
consensus item), plus the `WarRoomWorkflowEventLogService` that records
these operations to the workflow event ledger.

This probe artifact closes the orphan-failure of the original
`docs/project-context/probe-results/war-room.md` (parent probe, status:
`failed`) for the collaboration half. The lifecycle half (open/close,
session status state machine) is covered by the sibling probe owned by
`WI-2026-050` (`war-room-lifecycle`); the two halves split the original
`war-room` scope so each probe has a bounded surface. The collaboration
half is a **direct dependency of** WI-2026-050: every mutating
collaboration operation requires the session to already be `open`, which
is the lifecycle state owned by the sibling probe.

### The five collaboration operations

| # | Operation | Source file | Emitted workflow event (verbatim literal) | Lifecycle guard |
|---|---|---|---|---|
| 1 | invite (add participant) | `apps/api/src/war-room/war-room.service.invite.ts` | `war_room_participant_invited` (line 63) | `validateMutatingSessionAccess(session, workflowRunId)` at line 27; rejects with the literal `'session_not_open'` when `session.status !== 'open'` |
| 2 | post-message | `apps/api/src/war-room/war-room.service.post-message.ts` | `war_room_message_posted` (line 116) | `validateMutatingSessionAccess(session, workflowRunId)` at line 28; rejects with `'session_not_open'` when `session.status !== 'open'` |
| 3 | update-blackboard | `apps/api/src/war-room/war-room.service.update-blackboard.ts` | `war_room_blackboard_updated` (line 102) | `validateMutatingSessionAccess(session, workflowRunId)` at line 27; rejects with `'session_not_open'` when `session.status !== 'open'` |
| 4 | consensus | `apps/api/src/war-room/war-room.service.consensus.ts` (pure helper, no NestJS provider) | (none — pure function; transitions ride on `submit-signoff`) | n/a — has no session of its own to guard; the helper computes the new `AgentWarRoomConsensusState` (`consensus_reached` / `deadlocked` / `partial_signoff` / `draft_ready` / unchanged) from required roles, latest signoffs, and the configured deadlock threshold |
| 5 | submit-signoff | `apps/api/src/war-room/war-room.service.submit-signoff.ts` | `war_room_signoff_submitted` (line 274); additionally emits one of `war_room_consensus_reached` (line 286), `war_room_deadlocked` (line 301), or `war_room_tie_break_applied` (line 308) based on the consensus-transition branch | `validateMutatingSessionAccess(session, workflowRunId)` at line 32; rejects with `'session_not_open'` when `session.status !== 'open'` |

The lifecycle guard helper `validateMutatingSessionAccess` is defined at
`apps/api/src/war-room/war-room.service.shared.ts:153` and returns the
literal `'session_not_open'` from line 167 when `session.status !== 'open'`
(it also returns `'session_not_found'` and `'workflow_run_scope_mismatch'`
for the other failure modes). The pure `war-room.service.consensus.ts`
helper (`resolveConsensusState`) is **not** a NestJS provider and has no
session to guard — its observable effect is the consensus-state
transition that `submitSignoff` then persists and emits via
`WarRoomWorkflowEventLogService` on the guarded path.

All five operations route their event emission through
`appendLifecycleEvents` (defined in `war-room.service.shared.ts`), which
calls `WarRoomWorkflowEventLogService.appendBestEffort` (defined in
`apps/api/src/war-room/war-room-workflow-event-log.service.ts`). That
service writes to both `WorkflowEventRepository` (the durable workflow
event ledger row) and `EventLedgerService` (the best-effort observable
plane). Each emission is tagged with the `workflow_run_id`,
`actor_id`, request `correlation_id`, and the operation-specific payload.

### Module wiring

`apps/api/src/war-room/war-room.module.ts` registers
`WarRoomService` and `WarRoomWorkflowEventLogService` as NestJS
providers, plus a `WAR_ROOM_EVENT_LOG_PORT` injection token that aliases
the event-log service via `useExisting`. `WarRoomService` is the only
exported provider; `WarRoomWorkflowEventLogService` is consumed
internally through the `WAR_ROOM_EVENT_LOG_PORT` injection token so
collaborators that need to append events can depend on the port rather
than the concrete service. The module imports `DatabaseModule`,
`ObservabilityModule`, and `SystemSettingsModule`.

### Contract-shape deviations from the originally hypothesized design

The inspection surfaced three contract-shape deviations that downstream
probes and consumers should be aware of, so they are not surprised when
they read the source:

1. **Provider shape is flatter than hypothesized.** Only `WarRoomService`
   and `WarRoomWorkflowEventLogService` are registered as NestJS
   providers. The five per-operation files
   (`war-room.service.{invite,post-message,update-blackboard,consensus,submit-signoff}.ts`)
   are **plain exported async functions** that receive a
   `WarRoomServiceDependencies` bag and are orchestrated by
   `WarRoomService`. They are **not** separate `@Injectable()` classes.
   The repositories / helpers they need (session, participant, message,
   blackboard, signoff, system-settings, agent-profile,
   workflow-event-log) are accessed through the
   `WarRoomServiceDependencies` interface (defined in
   `war-room.service.dependencies.ts`), which `WarRoomService` composes
   from its injected repositories. Downstream code that wants to call
   one of these operations from outside the module must go through
   `WarRoomService`; it cannot inject a per-operation service.
2. **Consensus is a pure helper, not an event-emitting operation.** The
   originally hypothesized `war_room.consensus.{proposed,reached,rejected}.v1`
   event family does **not** exist in this module. There is no
   `proposed` or `rejected` event anywhere. Consensus transitions
   (`reached` / `deadlocked` / `tie_break_applied`) are emitted **as
   part of** `submit-signoff.ts`'s three-branch emission — every
   successful signoff submission appends `war_room_signoff_submitted`
   and then conditionally appends one of the three transition events
   depending on the new consensus state computed by
   `resolveConsensusState`.
3. **Event-name strings are flat `snake_case`, not the hypothesized
   dotted `*.v1` form.** The actual emitted literals are
   `war_room_participant_invited`, `war_room_message_posted`,
   `war_room_blackboard_updated`, `war_room_signoff_submitted`,
   `war_room_consensus_reached`, `war_room_deadlocked`, and
   `war_room_tie_break_applied`. The downstream kanban core event-ledger
   consumer must use these exact literals (not `war_room.invited.v1` and
   similar). Aligning with the dotted `*.v1` form expected by some
   downstream consumers is recorded as a follow-up work item in the
   Recommended Follow-ups section below.

### Test coverage status

`npm run test --workspace=apps/api -- war-room` exits with code 0. Vitest
reports 1 test file / 2 tests passed. The matching spec is
`apps/api/src/telemetry/telemetry-gateway-war-room.command-helpers.spec.ts`
— it is for a telemetry command helper, not for any of the five
collaboration operations. **No `*.spec.ts` files exist directly inside
`apps/api/src/war-room/`.** AC-3 ("existing war-room tests pass") is
therefore satisfied vacuously: the command exits 0, but the passing
tests are out-of-module. Adding in-module unit tests for each of the
five collaboration operations is recorded as a follow-up work item.

### Confidence score justification

`confidence_score: 0.9`.

- **Additions toward 1.0:** The functional contract is met end-to-end.
  Every operation emits its workflow event via the real
  `WarRoomWorkflowEventLogService`, which writes to both the durable
  workflow-event ledger (`WorkflowEventRepository.append`) and the
  observable event-ledger plane (`EventLedgerService.emitBestEffort`).
  The lifecycle guard is verified across all four mutating operations
  and produces the documented failure literal (`'session_not_open'`).
  The test command exits 0. Types flow from `@nexus/core`-style entity
  types into the per-operation result shapes end-to-end with no
  observable `any` leakage.
- **Deductions from 1.0 (total -0.10):**
  - **No in-module unit-test coverage for any of the five collaboration
    operations (-0.05).** The vitest pass is from an out-of-module spec
    (`apps/api/src/telemetry/telemetry-gateway-war-room.command-helpers.spec.ts`).
    We cannot confirm the per-operation emission / lifecycle-guard
    behavior is exercised by automated tests inside
    `apps/api/src/war-room/`.
  - **Provider-shape drift from the originally hypothesized design
    (-0.025).** The five per-operation files are plain exported
    functions, not `@Injectable()` classes. The shape is internally
    consistent and works, but it deviates from what the work-item spec
    implied, and downstream consumers that expect separate
    per-operation providers will need to adapt.
  - **No dedicated `war_room_consensus_proposed` or
    `war_room_consensus_rejected` events (-0.025).** The three-branch
    emission from `submit-signoff` covers `reached` / `deadlocked` /
    `tie_break_applied`, but downstream consumers that wanted a
    `proposed` signal when a signoff is queued (rather than the final
    transitioned state) will not find one. This may or may not matter
    depending on the downstream consumer's needs — see Open Questions.

## Lifecycle Integration

This probe is bounded to the collaboration half of the war-room module.
The lifecycle half — session open/close, status transitions, lifecycle
event emission (`war_room_opened` / `war_room_closed`) — is owned by the
sibling probe for `WI-2026-050` (`war-room-lifecycle`).

The cross-half contract is:

- **All four mutating collaboration operations (invite, post-message,
  update-blackboard, submit-signoff) call `validateMutatingSessionAccess`
  first**, which requires `session.status === 'open'`. A session in any
  other status (`opening`, `closing`, `closed`) is rejected with the
  literal denial reason `'session_not_open'`. The lifecycle state
  machine that produces `session.status` is owned by `WI-2026-050`; this
  probe only verifies the guard.
- **`WarRoomWorkflowEventLogService` is shared across both halves.**
  Lifecycle events (`war_room_opened`, `war_room_closed`) and
  collaboration events (`war_room_participant_invited`,
  `war_room_message_posted`, `war_room_blackboard_updated`,
  `war_room_signoff_submitted`, `war_room_consensus_reached`,
  `war_room_deadlocked`, `war_room_tie_break_applied`) flow through the
  same service into the same `WorkflowEventRepository` table and the
  same observable event-ledger plane. The mapping from event-type string
  to observable outcome is computed by
  `resolveOutcomeFromEventType` (in
  `war-room-workflow-event-log.service.ts`): strings containing
  `failed` / `error` map to `failure`, `denied` to `denied`, `started` /
  `queued` to `in_progress`, and everything else (including all current
  war-room event types) to `success`.
- **`WarRoomModule` exports only `WarRoomService`.** A module that
  wants to drive lifecycle operations must inject `WarRoomService` and
  call its `openSession` / `closeSession` methods (lifecycle surface,
  owned by WI-2026-050); a module that wants to drive collaboration
  operations must inject `WarRoomService` and call `inviteParticipant`
  / `postMessage` / `updateBlackboard` / `submitSignoff`. Both halves
  are reachable through the same provider.

The downstream kanban core event-ledger consumer reads both halves off
the same `workflow_events` table, so ordering across the
lifecycle / collaboration boundary is preserved naturally by the
`created_at` timestamp of each row.

## Evidence

- `apps/api/src/war-room/war-room.module.ts` — NestJS module;
  registers `WarRoomService`, `WarRoomWorkflowEventLogService`, and the
  `WAR_ROOM_EVENT_LOG_PORT` injection token; exports `WarRoomService`
  only.
- `apps/api/src/war-room/war-room.service.invite.ts` — invite
  participant operation; calls `validateMutatingSessionAccess` at line
  27; emits `war_room_participant_invited` at line 63.
- `apps/api/src/war-room/war-room.service.post-message.ts` —
  post-message operation; calls `validateMutatingSessionAccess` at
  line 28; emits `war_room_message_posted` at line 116.
- `apps/api/src/war-room/war-room.service.update-blackboard.ts` —
  blackboard-write operation; calls `validateMutatingSessionAccess` at
  line 27; emits `war_room_blackboard_updated` at line 102.
- `apps/api/src/war-room/war-room.service.consensus.ts` — pure helper
  exporting `resolveConsensusState`; computes the next
  `AgentWarRoomConsensusState` from required roles, latest signoffs,
  and the configured deadlock threshold. No session, no event
  emission, no provider registration.
- `apps/api/src/war-room/war-room.service.submit-signoff.ts` —
  submit-signoff operation; calls `validateMutatingSessionAccess` at
  line 32; emits `war_room_signoff_submitted` at line 274 and
  conditionally emits `war_room_consensus_reached` (line 286),
  `war_room_deadlocked` (line 301), or `war_room_tie_break_applied`
  (line 308) based on the post-submission consensus-state branch.
- `apps/api/src/war-room/war-room-workflow-event-log.service.ts` —
  `@Injectable()` `WarRoomWorkflowEventLogService`; writes to
  `WorkflowEventRepository.append` (durable) and
  `EventLedgerService.emitBestEffort` (observable); exposes
  `appendBestEffort` for non-critical paths.
- `apps/api/src/war-room/war-room.service.shared.ts` — shared helpers;
  defines `validateMutatingSessionAccess` at line 153 (returns
  `'session_not_open'` from line 167 when `session.status !== 'open'`)
  and `appendLifecycleEvents` (which routes event emission through
  the workflow-event-log service).

## Recommended Follow-ups

- **WI-FU-A: Add in-module unit-test coverage for each of the five
  collaboration operations.** Author `*.spec.ts` files directly
  inside `apps/api/src/war-room/` covering: **invite** (success path +
  `session_not_open` denial + workflow-event emission), **post-message**
  (success + size cap + sender-not-participant + lifecycle denial +
  event emission), **update-blackboard** (success + version conflict +
  lifecycle denial + event emission), **submit-signoff** (signoff
  queued path + consensus-reached branch + deadlock branch +
  CEO-tie-break branch + lifecycle denial + event emission ordering),
  and the pure `resolveConsensusState` helper (table-driven cases for
  all five terminal / intermediate states). Acceptance:
  `npm run test --workspace=apps/api -- war-room` reports at least one
  passing spec from inside `apps/api/src/war-room/`.
- **WI-FU-B: Align the literal event-name contract with the dotted
  `*.v1` form expected by downstream kanban core event-ledger
  consumers (or document that the flat `snake_case` form is
  canonical).** Confirm with the kanban core event-ledger consumer
  whether the literals emitted today (`war_room_participant_invited`,
  `war_room_message_posted`, `war_room_blackboard_updated`,
  `war_room_signoff_submitted`, `war_room_consensus_reached`,
  `war_room_deadlocked`, `war_room_tie_break_applied`) are the
  canonical contract, or whether they need to be renamed to the dotted
  `*.v1` form (`war_room.invited.v1` etc.). If renaming is required,
  this is a coordinated change across the war-room module, the
  workflow-event-ledger writer, and the kanban core event-ledger
  reader; if not, update the WI-2026-051 work-item text to record the
  flat form as the canonical contract and propagate the corrected
  names into the WI-2026-050 sibling probe artifact.

## Open Questions

- **What event-name contract does the downstream kanban core event-ledger
  consumer actually expect?** The originally hypothesized form
  (`war_room.invited.v1`, `war_room.message.posted.v1`, etc.) does not
  match the literals emitted by the war-room module
  (`war_room_participant_invited`, `war_room_message_posted`, etc.).
  Either the kanban core event-ledger consumer has been updated to
  consume the flat `snake_case` literals, or there is a downstream
  translation / aliasing layer that has not been documented in the
  war-room module. Resolving this is WI-FU-B above.
- **Is there a `war_room_consensus_proposed` event semantics that the
  module should emit when a signoff is queued but not yet terminal?**
  The current implementation collapses "signoff queued" and "consensus
  reached" into the single `war_room_signoff_submitted` emission, then
  conditionally appends one of three transition events (`reached` /
  `deadlocked` / `tie_break_applied`) based on the post-submission
  consensus state. Downstream consumers that want a "signoff proposed,
  awaiting peer review" signal currently cannot distinguish it from
  "consensus reached" without inspecting the payload. Whether this gap
  matters for kanban core event-ledger consumers is not resolvable from
  this probe alone.
- **What is the lifecycle half's contract for emitting
  `war_room_message_posted`?** The grep of `war_room_` events shows
  `apps/api/src/war-room/war-room.service.open.ts:275` also emits
  `war_room_message_posted`. That line is outside this probe's scope
  (it's in the lifecycle file owned by WI-2026-050) but it duplicates a
  collaboration event-type and may warrant attention when WI-2026-050's
  probe artifact is authored.