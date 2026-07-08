# EPIC-087: Chat Session Multi-Agent Runtime Orchestration and Turn Governance

> Status: Proposed
> Priority: Critical
> Depends On: EPIC-064 (Decoupled Chat Sessions), EPIC-077 (Multi-Agent Chat Collaboration and Agent Invites), EPIC-054 (Peer-to-Peer Mesh), EPIC-068 (War Room Mesh)
> Related: EPIC-086 (Distributed Agent Mesh Coordination and Governance)
> Last Updated: 2026-04-12

---

## 1. Epic Summary

This epic closes the production-critical gap between participant lifecycle metadata and actual multi-agent runtime behavior in chat sessions.

Current implementation allows users and agents to invite participants, stores participant rows, and emits participant lifecycle events. However, invited participants do not receive execution context, do not execute turns, and do not contribute runtime responses in the same chat stream.

This epic delivers a complete, honest, and testable collaboration runtime for chat sessions with:

1. Explicit participant execution provisioning.
2. Deterministic turn orchestration.
3. Accurate participant lifecycle semantics.
4. Scope-safe persistence and policy enforcement.
5. UI state that reflects runtime truth, not inferred status.

---

## 2. Why This Epic Exists

### 2.1 User-visible failure mode

Users can configure multi-agent chat sessions and see multiple participants marked active, but only the session owner agent performs runtime work.

### 2.2 Business and product impact

1. Collaboration trust is degraded: UI communicates team behavior that runtime does not deliver.
2. Incident response and debugging become harder due to optimistic lifecycle events.
3. Future mesh-governance features are blocked by missing participant execution substrate.

### 2.3 Technical impact

1. Chat collaboration appears implemented at API/UI level but is incomplete in execution plane.
2. Scope contracts between chat sessions and run-scoped collaboration domains are not resolved.
3. Existing telemetry taxonomy cannot distinguish invite metadata from real participant execution readiness.

---

## 3. Evidence Baseline (2026-04-12 Investigation)

### 3.1 Investigated session

Session ID: `11b895fc-ce64-4792-b342-26f571ad7c7d`

### 3.2 Database evidence

Observed in `chat_sessions`:

1. `status = COMPLETED`
2. `agent_profile_name = orchestrator`
3. `workflow_run_id = NULL`
4. `source = ad-hoc`

Observed in `chat_session_participants`:

1. 6 rows exist.
2. Owner + participant + moderator roles are present.
3. All rows are `participation_status = active`.
4. `joined_at` is populated at session setup/invite time.

Observed in war-room and mesh domains for the same project and chat time window:

1. `agent_war_room_sessions` rows in chat window: 0
2. `agent_communication_threads` rows in chat window: 0

Observed schema constraints:

1. Decoupled chat allows nullable `workflow_run_id`.
2. War-room and mesh tables require non-null `workflow_run_id`.

### 3.3 Redis telemetry evidence (`stream:telemetry:<chatSessionId>`)

Observed counts:

1. `chat_participant_invited`: 5
2. `chat_participant_joined`: 5
3. `turn_end`: 18
4. `session_started`: 1
5. `session_completed`: 1
6. `war_room_*`: 0

Observed runtime attribution:

1. `agentProfileName` in runtime payloads: orchestrator only.
2. `stepId` in runtime payloads: chat only.

### 3.4 Source code evidence (current behavior)

1. Session creation starts one execution, then initializes participant metadata.
2. Chat execution provisions one container for one `agentProfileName`.
3. Participant service upserts invited participants as `active` and sets `joined_at` immediately.
4. Lifecycle event mapper emits both `chat_participant_invited` and `chat_participant_joined` in one operation.
5. Invite command handling calls collaboration service and emits lifecycle events, but does not provision participant runtime.
6. War-room command handling requires workflow run context.

### 3.5 Forensic query snapshot (used as baseline)

Chat session row:

1. `id = 11b895fc-ce64-4792-b342-26f571ad7c7d`
2. `status = COMPLETED`
3. `agent_profile_name = orchestrator`
4. `project_id = d4b8300b-3456-47cb-9107-a2651fd565f8`
5. `workflow_run_id = NULL`

Participant roster:

1. owner: orchestrator
2. moderator: ceo-agent
3. participants: architect-agent, product-manager, spec-generator, staff_engineer
4. all non-owner participants marked active with immediate join timestamps

Scope evidence:

1. war-room sessions in target chat time window for project: 0
2. mesh threads in target chat time window for project: 0
3. project has prior war-room data outside chat window (proves subsystem is not globally down)

### 3.6 Current implementation file map (high-signal)

Backend:

1. `apps/api/src/session/session.controller.ts`
2. `apps/api/src/session/chat-execution.service.ts`
3. `apps/api/src/session/chat-session-collaboration.service.ts`
4. `apps/api/src/session/chat-session-collaboration.mappers.ts`
5. `apps/api/src/session/session-chat-collaboration.controller.ts`
6. `apps/api/src/telemetry/telemetry-gateway-chat-collaboration.helpers.ts`
7. `apps/api/src/telemetry/telemetry-gateway-war-room.command-helpers.ts`
8. `apps/api/src/project/project-war-room.controller.ts`
9. `apps/api/src/database/migrations/20260408000000-create-chat-sessions.ts`
10. `apps/api/src/database/migrations/20260410213000-create-agent-war-room-domain.ts`
11. `apps/api/src/database/migrations/20260412150000-create-chat-session-participants.ts`
12. `apps/api/src/telemetry/telemetry.gateway.spec.ts`

Frontend:

1. `apps/web/src/components/sessions/NewSessionDialog.tsx`
2. `apps/web/src/pages/active-session/ActiveSessionWorkspaceChatCollaborationSection.tsx`
3. `apps/web/src/pages/active-session/active-session.chat-builder.ts`
4. `apps/web/src/components/orchestration/WarRoomSessionManagerPanel.tsx`

Operational docs:

1. `docs/epics/EPIC-064-decoupled-chat-sessions.md`
2. `docs/epics/EPIC-077-multi-agent-chat-collaboration-and-agent-invites.md`
3. `docs/epics/EPIC-068-inter-agent-communication-mesh-implementation.md`
4. `docs/operations/war-room-retrospective-runbook.md`

---

## 4. Intended Behavior vs Actual Behavior

### 4.1 Intended behavior (from prior epics)

EPIC-064 intentionally established decoupled single-agent chat as a baseline independent of workflow runs.

EPIC-077 intended to extend this baseline with participant collaboration including:

1. Invite/list/status lifecycle.
2. Participant execution context provisioning.
3. Participant responses routed into the same chat stream.

EPIC-068 intentionally kept War Room as workflow-run-governed collaboration and not a direct replacement for New Chat participant model.

### 4.2 Actual behavior

1. Participant persistence and invite events exist.
2. UI supports participant selection and invite controls.
3. Runtime remains single-agent owner execution.
4. Joined/active participant statuses can appear without runtime participation.

### 4.3 Conclusion

The original product direction is valid, but delivery was partial and crossed an architecture seam without completing execution-plane primitives.

---

## 5. Root Cause Analysis

### 5.1 Structural scope mismatch

1. Chat sessions can exist without workflow runs.
2. War-room and mesh persistence are run-scoped and require `workflow_run_id`.
3. No scope-bridging abstraction was fully implemented before participant collaboration UX shipped.

### 5.2 Missing execution manager for participants

1. No service provisions runtime context per invited participant.
2. No participant-level container/session lifecycle in chat path.
3. No participant execution registry keyed to chat session.

### 5.3 Missing turn arbitration engine

1. No deterministic speaker selection policy for multi-agent chat.
2. No participant turn queue/state machine.
3. No idle/timeout/retry policies per participant turn.

### 5.4 Optimistic lifecycle semantics

1. Invite and join are emitted together.
2. `active` status is assigned at invite/setup.
3. UI appears collaborative even when runtime has not provisioned invited participants.

### 5.5 Incomplete acceptance gating

1. API/UI slices were implemented before runtime parity.
2. No required E2E gate enforced true multi-participant execution behavior.

---

## 6. Epic Goals

### 6.1 Product goals

1. Users can create a chat team and receive real multi-agent responses.
2. Participant state transitions reflect actual runtime readiness and activity.
3. Collaboration controls remain simple for single-agent default users.

### 6.2 Technical goals

1. Introduce a first-class chat collaboration scope model.
2. Add participant execution context management for chat sessions.
3. Implement deterministic turn governance with moderation hooks.
4. Make lifecycle events truthful and auditable.
5. Maintain backward compatibility for existing single-agent chats and workflow-run war rooms.

### 6.3 Operational goals

1. Recover safely from API/container/reconnect failures.
2. Expose collaboration diagnostics and lag metrics.
3. Provide strong regression coverage at unit, integration, and deterministic E2E levels.

---

## 7. Non-Goals

1. Replacing the workflow-run War Room model.
2. Building fully autonomous swarm planning in v1 of this epic.
3. Enabling cross-project or cross-tenant chat participant exchange.
4. Rewriting all existing mesh persistence in one migration.
5. Introducing uncontrolled freeform team chat outside project/session scope.

---

## 8. Design Principles

1. Truthful state over optimistic UX.
2. Scope-safe by default (project + session boundaries enforced everywhere).
3. Single-agent behavior remains the default and must not regress.
4. Runtime decisions are deterministic and observable.
5. Policy failures are explicit, typed, and user-visible.
6. Keep orchestration War Room and session collaboration distinct but interoperable.

---

## 9. Target Architecture

### 9.1 Collaboration scope abstraction

Introduce explicit scope abstraction for collaboration records and operations:

1. `scope_kind`: `workflow_run` | `chat_session`
2. `scope_id`: UUID/string
3. `project_id`: required

This allows shared policy and telemetry components while preserving domain boundaries.

### 9.2 Participant lifecycle state machine

Replace optimistic lifecycle with execution-aware states:

1. `invited`
2. `accepted` (policy pass + participant acknowledged)
3. `provisioning`
4. `ready`
5. `active` (currently turn-eligible)
6. `idle`
7. `declined`
8. `failed`
9. `left`
10. `removed`

Transition rules:

1. `joined` event is emitted only when runtime handshake succeeds.
2. `active` means turn-eligible and runtime-connected.
3. `failed` captures provisioning/transport/runtime errors with reason code.

### 9.3 Participant execution context manager

New backend service responsibility:

1. Resolve AI/provider/profile settings for invited participant.
2. Provision container/session context.
3. Register participant runtime endpoint/socket bindings.
4. Manage heartbeat and readiness.
5. Tear down participant runtime on leave/remove/session close.

### 9.4 Turn coordinator

New deterministic component:

1. Scheduling policies: `moderator_first`, `round_robin`, `owner_driven`, `policy_weighted`.
2. Turn queue persistence.
3. Time budget and timeout handling.
4. Retry/skip logic with reason taxonomy.
5. Single-writer control over turn transitions.

### 9.5 Invite pipeline

`invite_agent_to_chat` flow:

1. Validate project/session scope.
2. Evaluate policy matrix and rate limits.
3. Persist invitation attempt.
4. Move participant through accepted/provisioning/ready states.
5. Emit lifecycle events at each step.

### 9.6 Telemetry and event model

Distinguish lifecycle from execution events:

1. Lifecycle: invited, accepted, denied, provisioning_started, joined, failed, left, removed.
2. Execution: turn_assigned, turn_started, turn_completed, turn_timed_out, turn_skipped.
3. Attribution: include `participant_id`, `agent_profile`, `execution_id`, `turn_id` where applicable.

### 9.7 API surface

Add/extend endpoints and contracts for:

1. Participant lifecycle state and diagnostics.
2. Turn state and policy configuration.
3. Manual moderation actions (skip, reprioritize, remove participant).
4. Chat session collaboration summary.

### 9.8 Web UX model

1. New Session remains simple, optional advanced participant setup.
2. Active Session roster shows truthful runtime states.
3. Turn panel shows current turn owner, queue, and recent outcomes.
4. Event timeline differentiates invite lifecycle vs execution outcomes.

### 9.9 Reliability model

1. Idempotent invite/provision operations.
2. Session resume and participant rebind on gateway/API restart.
3. Dead participant detection and automatic quarantine.
4. Deterministic cleanup on session completion/cancel.

### 9.10 War-room boundary contract

To prevent architecture drift, enforce these invariants:

1. Session collaboration does not auto-create war-room sessions.
2. War-room continues to require workflow-run context.
3. Any optional bridge from chat to war-room must be explicit, user-initiated, and auditable.
4. Event names must preserve domain boundary (`chat_*` vs `war_room_*`).

---

## 10. Data Model and Contract Changes

### 10.1 Existing table updates

`chat_session_participants`:

1. Add execution-aware status values.
2. Add `status_reason`, `last_error_code`, `last_error_message`.
3. Add `last_heartbeat_at`.

`chat_sessions`:

1. Add turn policy fields.
2. Add collaboration mode flag and feature version metadata.

### 10.2 New tables

`chat_participant_executions`:

1. Tracks provisioned runtime contexts per participant.
2. Includes endpoint/binding metadata and lifecycle timestamps.

`chat_turns`:

1. Turn queue records and status transitions.
2. Correlates to participant, execution, and event stream identifiers.

`chat_invitation_attempts`:

1. Stores policy decisions and denial reasons.
2. Supports audit and diagnostics.

`chat_turn_policy_overrides` (optional v1.1):

1. Session-level or moderator-level policy overrides.

### 10.3 Event payload versioning

Introduce versioned payload schema for chat collaboration events:

1. `schema_version`
2. `scope_kind`
3. `scope_id`
4. `project_id`

---

## 11. Workstreams

## 11.0 Workstream 0: Alignment, ADRs, and Scope Contracts

Objective:

1. Resolve architecture seam before additional feature coding.

Deliverables:

1. ADR for scope model and persistence strategy.
2. ADR for turn arbitration policy defaults.
3. ADR for participant runtime provisioning strategy.

Tasks:

- [ ] E087-0001: Author ADR for collaboration scope abstraction (`workflow_run` vs `chat_session`).
- [ ] E087-0002: Author ADR for participant execution model (container/session isolation strategy).
- [ ] E087-0003: Author ADR for deterministic turn scheduling policy and conflict resolution.
- [ ] E087-0004: Define compatibility matrix for EPIC-064, EPIC-068, EPIC-077 behaviors.
- [ ] E087-0005: Publish cross-team implementation RFC and finalize acceptance gates.

## 11.1 Workstream A: Persistence and Domain Modeling

Objective:

1. Establish truthful collaboration persistence with execution and turn records.

Deliverables:

1. Updated entities/migrations for participant lifecycle semantics.
2. New execution, invitation, and turn tables.
3. Repository methods with strict scope constraints.

Tasks:

- [ ] E087-0101: Extend participant status enum with execution-aware states.
- [ ] E087-0102: Add participant lifecycle diagnostic columns.
- [ ] E087-0103: Create `chat_participant_executions` entity + migration.
- [ ] E087-0104: Create `chat_turns` entity + migration.
- [ ] E087-0105: Create `chat_invitation_attempts` entity + migration.
- [ ] E087-0106: Add composite indexes for session + participant + status query paths.
- [ ] E087-0107: Add repository methods for pending/ready/active participant sets.
- [ ] E087-0108: Add repository methods for current and upcoming turns.
- [ ] E087-0109: Add repository methods for invitation audit and denial reason analytics.
- [ ] E087-0110: Add migration rollback tests for new tables.

## 11.2 Workstream B: Participant Runtime Provisioning

Objective:

1. Provision invited participant runtime contexts and maintain readiness state.

Deliverables:

1. `ChatParticipantExecutionService` (or equivalent).
2. Provisioning workflow with retry and timeout policies.
3. Runtime readiness handshake contract.

Tasks:

- [ ] E087-0201: Implement `ChatParticipantExecutionService` skeleton and interfaces.
- [ ] E087-0202: Add provisioning pipeline for invited participant profiles.
- [ ] E087-0203: Add runtime binding registration for participant sockets.
- [ ] E087-0204: Add readiness handshake endpoint/event contract.
- [ ] E087-0205: Persist execution context row on successful provision.
- [ ] E087-0206: Add heartbeat watcher and stale participant detection.
- [ ] E087-0207: Add participant teardown path on remove/leave/session close.
- [ ] E087-0208: Add bounded retries with exponential backoff and reason codes.
- [ ] E087-0209: Add provisioning timeout and fail-fast behavior with lifecycle event.
- [ ] E087-0210: Add idempotency keys for invite/provision repeated commands.

## 11.3 Workstream C: Turn Coordinator and Scheduling Policies

Objective:

1. Ensure deterministic multi-agent chat turns with explicit scheduling semantics.

Deliverables:

1. `ChatTurnCoordinator` service.
2. Turn queue persistence and transitions.
3. Moderator and system control actions.

Tasks:

- [ ] E087-0301: Create turn policy enum and defaults.
- [ ] E087-0302: Implement turn queue initialization at session start.
- [ ] E087-0303: Implement `assignNextTurn` deterministic selector.
- [ ] E087-0304: Implement turn start and completion transitions.
- [ ] E087-0305: Implement timeout and skip transitions.
- [ ] E087-0306: Implement retry-once policy for transient participant errors.
- [ ] E087-0307: Add moderator controls: skip participant, reorder queue, pause/resume.
- [ ] E087-0308: Persist turn diagnostics (`duration_ms`, `timeout`, `skip_reason`).
- [ ] E087-0309: Emit turn lifecycle telemetry events.
- [ ] E087-0310: Add safeguards against concurrent turn assignment races.

## 11.4 Workstream D: Collaboration API and Tooling Contracts

Objective:

1. Align REST, gateway, and tool contracts with execution-aware collaboration.

Deliverables:

1. Extended chat participant and turn APIs.
2. Updated `invite_agent_to_chat` result contracts.
3. New moderation and turn-state command surface.

Tasks:

- [ ] E087-0401: Extend session DTOs for turn policy and collaboration mode.
- [ ] E087-0402: Extend invite participant response with execution provisioning outcome fields.
- [ ] E087-0403: Add `GET /sessions/chat/:chatId/turns` endpoint.
- [ ] E087-0404: Add `POST /sessions/chat/:chatId/turns/:turnId/skip` endpoint.
- [ ] E087-0405: Add `POST /sessions/chat/:chatId/participants/:participantId/remove` endpoint.
- [ ] E087-0406: Add `POST /sessions/chat/:chatId/participants/:participantId/retry` endpoint.
- [ ] E087-0407: Add `GET /sessions/chat/:chatId/collaboration-diagnostics` endpoint.
- [ ] E087-0408: Update telemetry gateway payload types for participant execution events.
- [ ] E087-0409: Update runner capability contracts for invite and turn actions.
- [ ] E087-0410: Add versioned schema validators for new payloads.

## 11.5 Workstream E: Lifecycle Semantics and Event Integrity

Objective:

1. Make lifecycle events represent true runtime state transitions.

Deliverables:

1. Revised event mapper and publishing rules.
2. Strict event order guarantees for invite/provision/join.
3. Duplicate suppression and idempotent event writes.

Tasks:

- [ ] E087-0501: Remove immediate join emission from invite mapping.
- [ ] E087-0502: Emit `chat_participant_accepted` only after policy pass.
- [ ] E087-0503: Emit `chat_participant_provisioning_started` on runtime provisioning begin.
- [ ] E087-0504: Emit `chat_participant_joined` only after readiness handshake.
- [ ] E087-0505: Emit `chat_participant_failed` with typed error codes.
- [ ] E087-0506: Emit `chat_turn_assigned` and `chat_turn_completed` with attribution.
- [ ] E087-0507: Add event ordering keys and monotonic sequence checks.
- [ ] E087-0508: Add publisher retry and dead-letter path for failed event persistence.
- [ ] E087-0509: Add reconciliation job for missing lifecycle events.
- [ ] E087-0510: Add event contract tests for backward compatibility.

## 11.6 Workstream F: Web UX and Product Surface

Objective:

1. Align frontend state and controls with actual runtime collaboration.

Deliverables:

1. Accurate participant badges and transitions.
2. Turn status panel.
3. Moderation controls for chat owners/moderators.

Tasks:

- [ ] E087-0601: Add participant state badge mappings for accepted/provisioning/ready/failed.
- [ ] E087-0602: Replace active count semantics with runtime-aware counts.
- [ ] E087-0603: Add participant diagnostics tooltip/details panel.
- [ ] E087-0604: Add turn queue panel in active session workspace.
- [ ] E087-0605: Add current speaker and next-up visual indicators.
- [ ] E087-0606: Add moderation controls (skip/retry/remove) with role guards.
- [ ] E087-0607: Add timeline formatting for new participant and turn events.
- [ ] E087-0608: Add UI fallback copy for single-agent sessions.
- [ ] E087-0609: Add empty/error states for degraded collaboration mode.
- [ ] E087-0610: Add optimistic update rollback behavior for invite/mode actions.

## 11.7 Workstream G: Policy, Security, and Governance

Objective:

1. Enforce safe collaboration constraints and auditable policy outcomes.

Deliverables:

1. Policy engine updates for chat participant execution.
2. Rate limit/cap controls.
3. Explicit denial and block reason taxonomy.

Tasks:

- [ ] E087-0701: Add system settings for max participant executions per session.
- [ ] E087-0702: Add system settings for max concurrent active participants.
- [ ] E087-0703: Add invite policy matrix extensions by requester role and target profile.
- [ ] E087-0704: Add per-requester invite rate limiting.
- [ ] E087-0705: Add per-session provisioning budget guards.
- [ ] E087-0706: Add denial reason enums and API exposure.
- [ ] E087-0707: Add sensitive field scrubbing for logs and diagnostics.
- [ ] E087-0708: Add ownership/moderation authorization checks for turn controls.
- [ ] E087-0709: Add policy audit events to event ledger and telemetry stream.
- [ ] E087-0710: Add policy regression tests for cross-project invite denial.

## 11.8 Workstream H: Observability, Diagnostics, and Operations

Objective:

1. Make collaboration runtime diagnosable in production and local deterministic environments.

Deliverables:

1. Metrics and diagnostics endpoints.
2. Standardized error taxonomy.
3. Runbook updates and troubleshooting flow.

Tasks:

- [ ] E087-0801: Add counters for invite accepted/denied/failed provisioning.
- [ ] E087-0802: Add gauges for active participants and queued turns.
- [ ] E087-0803: Add histogram metrics for provisioning latency and turn duration.
- [ ] E087-0804: Add diagnostics endpoint section for collaboration health.
- [ ] E087-0805: Add trace correlation identifiers across invite -> execution -> turn pipeline.
- [ ] E087-0806: Add warning logs for stale participants and repeated turn timeouts.
- [ ] E087-0807: Update war-room and collaboration runbooks with scope distinctions.
- [ ] E087-0808: Add operational dashboard widgets for collaboration status.
- [ ] E087-0809: Add deterministic replay harness for participant event timeline debugging.
- [ ] E087-0810: Add chaos/failure injection tests for provisioning and gateway disconnects.

## 11.9 Workstream I: Backward Compatibility and Migration

Objective:

1. Introduce new collaboration runtime without breaking single-agent or run-scoped behaviors.

Deliverables:

1. Compatibility adapters and defaults.
2. Safe migrations and feature-flag rollout.

Tasks:

- [ ] E087-0901: Add feature flag for execution-aware collaboration lifecycle.
- [ ] E087-0902: Keep current single-agent chat path as default fallback.
- [ ] E087-0903: Add migration script for participant status normalization.
- [ ] E087-0904: Add compatibility event mapper for legacy UI consumers.
- [ ] E087-0905: Add fallback behavior when participant provisioning is disabled.
- [ ] E087-0906: Add progressive rollout config by environment/project.
- [ ] E087-0907: Add smoke checks for legacy chats created before migration.
- [ ] E087-0908: Add rollback playbook for feature flag disablement.
- [ ] E087-0909: Add data-integrity checks for orphaned participant execution rows.
- [ ] E087-0910: Add guardrails for mixed-version API/web deployments.

## 11.10 Workstream J: Test Strategy and Quality Gates

Objective:

1. Make true multi-agent runtime behavior a required release gate.

Deliverables:

1. Unit coverage for each domain service.
2. Integration tests for complete invite/provision/turn flows.
3. Deterministic E2E tests validating multi-participant runtime attribution.

Tasks:

- [ ] E087-1001: Add unit tests for participant lifecycle transitions.
- [ ] E087-1002: Add unit tests for provisioning success/failure/retry.
- [ ] E087-1003: Add unit tests for turn coordinator policy variants.
- [ ] E087-1004: Add unit tests for event emission order and idempotency.
- [ ] E087-1005: Add integration tests for invite -> ready -> active pipeline.
- [ ] E087-1006: Add integration tests for deny and failure reason coverage.
- [ ] E087-1007: Add integration tests for session restart and participant rebind.
- [ ] E087-1008: Add web tests for runtime-aware badges and turn queue panel.
- [ ] E087-1009: Add deterministic E2E for multi-agent chat with at least 3 runtime agents.
- [ ] E087-1010: Add deterministic E2E for fallback to single-agent mode.
- [ ] E087-1011: Add deterministic E2E for moderation skip/retry/remove actions.
- [ ] E087-1012: Add deterministic E2E for failure handling and degraded mode UX.

## 11.11 Workstream K: Delivery Sequencing and Release

Objective:

1. Sequence delivery to reduce risk and keep production stable.

Deliverables:

1. Phase-based release plan.
2. Promotion criteria for each phase.
3. Post-release validation checklist.

Tasks:

- [ ] E087-1101: Define phase cut lines and feature-flag strategy.
- [ ] E087-1102: Ship persistence and API scaffolding behind disabled runtime flags.
- [ ] E087-1103: Ship provisioning pipeline to internal environments.
- [ ] E087-1104: Ship turn coordinator in canary projects only.
- [ ] E087-1105: Enable runtime-aware UI only when backend flag is on.
- [ ] E087-1106: Run deterministic E2E gate before each promotion.
- [ ] E087-1107: Add post-promotion telemetry verification checklist.
- [ ] E087-1108: Document on-call response for collaboration incident types.

---

## 12. Milestones and Phasing

### Milestone M1: Architecture and Data Foundations

Includes:

1. Workstream 0 complete.
2. Workstream A complete.
3. Workstream D scaffolding complete.

Exit criteria:

1. ADRs approved.
2. Migrations merged and validated.
3. API contracts versioned and lint/type checks pass.

### Milestone M2: Provisioning and Truthful Lifecycle

Includes:

1. Workstream B complete.
2. Workstream E complete.
3. Workstream G baseline controls complete.

Exit criteria:

1. Invited participant reaches ready state through runtime handshake.
2. Join event emitted only after readiness.
3. Failure and denial paths are typed and user-visible.

### Milestone M3: Turn Governance and UX Parity

Includes:

1. Workstream C complete.
2. Workstream F complete.

Exit criteria:

1. Multi-agent turns execute with deterministic policy.
2. UI accurately reflects turn owner, queue, and participant runtime status.

### Milestone M4: Hardening, Rollout, and Acceptance

Includes:

1. Workstream H, I, J, K complete.

Exit criteria:

1. Deterministic E2E gates pass.
2. Regression suite for single-agent and war-room flows passes.
3. Feature flag rollout completed and monitored.

### 12.5 Critical path

1. Workstream 0 -> Workstream A -> Workstream B -> Workstream C -> Workstream J -> Workstream K
2. Workstream D and E can begin after Workstream A contracts are stable.
3. Workstream F should begin once Workstream D payloads are finalized.
4. Workstream H and I run in parallel after M2.

---

## 13. Acceptance Criteria

## 13.1 Functional acceptance

1. A session created with 1 owner + N invited participants can execute turns from multiple runtime agents in the same chat stream.
2. Participant `joined` is emitted only when execution context is provisioned and ready.
3. Participant `active` indicates turn-eligible runtime state, not invite status.
4. Turn coordinator deterministically assigns and completes turns according to configured policy.
5. Manual moderation controls (skip/retry/remove) work with role-based authorization.

## 13.2 Scope and policy acceptance

1. Cross-project participant invitation is denied with explicit reason.
2. Rate limits and participant caps are enforced and observable.
3. Policy matrix is centrally evaluated and consistent across API and gateway actions.

## 13.3 Observability acceptance

1. Invite lifecycle, provisioning, and turn events are attributable by participant and execution IDs.
2. Diagnostics expose provisioning latency, active participant counts, and turn timeout rates.
3. Event ordering is deterministic and validated in integration tests.

## 13.4 Compatibility acceptance

1. Single-agent chats continue functioning without behavior regression.
2. Workflow-run war-room behavior remains unchanged and passing existing tests.
3. Legacy consumers continue receiving backward-compatible event representations where required.

---

## 14. Definition of Done

This epic is complete only when all of the following are true:

1. Architecture ADRs are approved and linked from this epic.
2. Persistence model includes participant execution and turn records with migrations applied.
3. Participant runtime provisioning is implemented with retry/timeout/teardown paths.
4. Lifecycle events are truthful and execution-aware.
5. Turn coordinator runs in production path under feature flag and supports at least one deterministic policy.
6. Active session UI reflects runtime truth for participant and turn state.
7. Policy and authorization controls are enforced, logged, and tested.
8. Observability and diagnostics surfaces are implemented and documented.
9. Unit and integration tests for changed services pass.
10. Deterministic E2E proves real multi-agent runtime participation (attribution from at least 3 distinct agent profiles).
11. Backward compatibility tests for single-agent and war-room flows pass.
12. Release runbook and rollback plan are updated and validated.

---

## 15. Test Matrix

### 15.1 Backend unit tests

1. Participant lifecycle transition validator.
2. Invite policy evaluator and denial reason mapper.
3. Provisioning retry/timeout strategy.
4. Turn scheduler policies.
5. Event sequencing and dedup logic.

### 15.2 Backend integration tests

1. Session create with participants -> invite accepted -> participant ready.
2. Invite denied scenarios (policy/cap/rate limit/inactive profile).
3. Provisioning failure and recovery paths.
4. Turn orchestration end-to-end for multiple participants.
5. Restart/reconnect rebind behavior.

### 15.3 Frontend tests

1. New Session participant and moderation controls.
2. Participant roster runtime state rendering.
3. Turn queue panel behavior.
4. Invite/moderation action success and failure UX.
5. Timeline formatting for new lifecycle and turn events.

### 15.4 Deterministic E2E tests

1. True multi-agent runtime attribution scenario.
2. Single-agent fallback scenario.
3. Participant failure/degraded mode scenario.
4. Moderator skip/retry/remove scenario.
5. Backward compatibility scenario for war-room run-scoped actions.

---

## 16. Risks and Mitigations

1. Risk: Increased container pressure from participant fan-out.
   Mitigation: caps, provisioning budgets, policy gates, staged rollout.

2. Risk: Turn coordinator races causing duplicate assignments.
   Mitigation: single-writer coordination and transactional turn state transitions.

3. Risk: Event noise and ordering drift.
   Mitigation: schema versioning, sequence checks, integration assertions.

4. Risk: UI complexity regression for common single-agent flow.
   Mitigation: progressive disclosure and single-agent defaults.

5. Risk: Scope confusion between chat collaboration and war-room governance.
   Mitigation: explicit scope abstraction, separate APIs, clear docs/runbooks.

---

## 17. Open Decisions

1. Should participant provisioning use dedicated containers per participant or pooled execution workers?
2. Which turn policy should be the default for v1 (`round_robin` vs `owner_driven`)?
3. Should moderator role be required for sessions with participant count above threshold?
4. How much prior chat history is provided to late-joining invited participants by default?
5. Which lifecycle events should remain backward-compatible aliases for existing timeline consumers?

---

## 18. Out of Scope (This Epic)

1. Cross-session shared memory buses between unrelated chats.
2. Full autonomous swarm planning and recursive delegation loops.
3. Replacing project-run war-room workflows and consensus governance.
4. Plugin marketplace abstractions for external collaboration agents.

---

## 19. Implementation Readiness Checklist

- [ ] ADRs approved.
- [ ] Feature flags defined and documented.
- [ ] Migration plan reviewed.
- [ ] Metrics and diagnostics contracts approved.
- [ ] E2E deterministic harness updated for multi-agent attribution checks.
- [ ] Rollback runbook validated.

---

## 20. Traceability: Key Existing Files Impacted

Expected major touchpoints for implementation:

1. API session creation and collaboration controllers/services.
2. Chat execution service and queue consumer path.
3. Telemetry gateway collaboration and command helper contracts.
4. Collaboration entities, repositories, and migrations.
5. Active Session collaboration UI, timeline builder, and session dialog.
6. Deterministic E2E suites under `packages/e2e-tests`.

This list is intentionally non-exhaustive and will be expanded into a concrete PR-level file map per workstream.

---

## 21. Success Metrics and SLO Targets

Functional metrics:

1. Distinct runtime participant profiles per multi-agent session >= 3 for deterministic E2E scenario.
2. Invite acceptance to participant ready median latency <= 12s in local deterministic environment.
3. Turn assignment to turn completion success rate >= 95% for healthy participants.

Reliability metrics:

1. Participant provisioning failure rate < 5% outside injected failure tests.
2. Duplicate turn assignment incidents = 0 in deterministic test suites.
3. Lifecycle event ordering violations = 0 in integration tests.

Compatibility metrics:

1. Single-agent chat regression rate = 0 across target suites.
2. War-room regression rate = 0 across target suites.

Operational metrics:

1. Collaboration diagnostics endpoint available and returning non-empty payloads in enabled environments.
2. On-call triage to root-cause time reduced through standardized error code taxonomy.

---

## 22. Initial Implementation Sequence (first 3 sprints)

Sprint 1:

1. Complete Workstream 0 ADRs and Workstream A schema baseline.
2. Build Workstream D contract scaffolding and validators.
3. Implement Workstream E event truthfulness changes behind flag.

Sprint 2:

1. Implement Workstream B participant provisioning pipeline.
2. Add Workstream G core policy controls.
3. Add Workstream J unit/integration tests for invite/provision lifecycle.

Sprint 3:

1. Implement Workstream C turn coordinator.
2. Implement Workstream F runtime-aware UI and turn panel.
3. Execute Workstream J deterministic E2E and begin Workstream K phased rollout.
