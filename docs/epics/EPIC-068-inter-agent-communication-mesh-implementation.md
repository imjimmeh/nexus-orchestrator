# EPIC-068: Inter-Agent War Room Mesh (Planning and Revision Alignment)

> Status: Proposed
> Priority: High
> Depends On: EPIC-054 (mesh v1), EPIC-053 (pre-flight), EPIC-049 (mutating action governance)
> Last Updated: 2026-04-10

---

## 1. Epic Summary

EPIC-054 delivered a working peer-to-peer mention mesh (`mention_agent`, `check_agent_mentions`, `resolve_agent_thread`) with persisted thread/message records and UI visibility. EPIC-068 extends that baseline into a multi-party "War Room" model for early alignment during planning and revision.

The target outcome is a moderated collaboration surface where Architect, Dev, QA (and optionally PM) can align on a shared strategy before implementation, with explicit sign-off semantics and deterministic tie-breaking by CEO when consensus stalls.

---

## 2. Codebase Analysis Snapshot (2026-04-10)

### 2.1 What Already Exists (Reusable Foundation)

1. Mesh actions are already wired end-to-end in runner and telemetry gateway:
   - `mention_agent`
   - `check_agent_mentions`
   - `resolve_agent_thread`
2. Mesh persistence already exists:
   - `agent_communication_threads`
   - `agent_communication_messages`
3. Mesh policy and limits already exist via system settings keys:
   - `agent_mesh_max_message_chars`
   - `agent_mesh_max_mentions_per_run`
   - `agent_mesh_policy_matrix`
   - `agent_mesh_max_messages_per_thread`
4. UI has read-only mesh observability:
   - active-session timeline message formatting
   - orchestration notification feed category (`agent_mesh`)
   - thread summary panel (event-derived)
5. Existing workflow entry points for left-shift alignment already exist:
   - revision workflow: `project-spec-revision-ceo.workflow.yaml`
   - refinement workflow: `work-item-refinement-default.workflow.yaml`
   - planning step in in-progress workflow: `work-item-in-progress-default.workflow.yaml`
6. Existing governance flow for controlled decisions already exists:
   - mutating actions + pending approvals (`project_orchestration_action_requests`)

### 2.2 Gaps Relative to "War Room"

1. No first-class multi-party room/session concept (current model is requester -> single target thread).
2. No participant roster/roles per collaboration session.
3. No shared blackboard artifact with versioned updates and conflict handling.
4. No consensus state model (proposed, signed, rejected, tie-break required).
5. No auto-trigger policy for "start war room in revision/planning when ambiguity risk is high".
6. No explicit CEO moderation/tie-break workflow hook.
7. No dedicated API/DTO surface for war room lifecycle and state retrieval.
8. Event taxonomy includes `agent_mention_responded` / `agent_mention_timeout` in UI mapping, but current backend lifecycle generation centers on request/received/denied/resolved.

---

## 3. Problem Statement

Current mesh collaboration is useful for ad-hoc peer asks but insufficient for multi-role pre-execution alignment.

Consequences today:

1. High-ambiguity work starts without shared technical agreement.
2. Review/rejection loops increase due to assumption drift.
3. Cross-role reasoning is fragmented across separate threads/events.
4. No durable, explicit consensus artifact for "what we agreed to build and why".

---

## 4. Goals

1. Introduce a War Room collaboration mode that supports multi-agent synchronous coordination.
2. Add a shared blackboard context for joint strategy drafting and revisions.
3. Add explicit consensus/sign-off semantics per role (Architect/Dev/QA, optional PM).
4. Route unresolved disagreements to CEO moderation with auditable tie-break decisions.
5. Integrate War Room invocation into revision and planning workflows.
6. Preserve EPIC-054 backward compatibility for simple mention-thread use cases.

---

## 5. Non-Goals

1. Replacing all existing subagent orchestration paths.
2. Creating global cross-project chat rooms.
3. Building unrestricted freeform team chat disconnected from workflow/run context.
4. Real-time collaborative text editing in this phase (v1 blackboard can be patch-based).

---

## 6. Proposed Architecture (Mesh v2)

### 6.1 Domain Model Additions

Add a War Room domain adjacent to existing thread/message tables:

1. `agent_war_room_sessions`
   - Scope: `project_id`, `workflow_run_id`, optional `work_item_id`
   - Fields: `session_id`, `status`, `created_by_execution_id`, `moderator_profile`, `opened_at`, `closed_at`, `resolution_type`
2. `agent_war_room_participants`
   - `session_id`, `agent_profile`, optional `execution_id`, `role` (`architect`, `dev`, `qa`, `pm`, `moderator`), `participation_status`
3. `agent_war_room_messages`
   - normalized room timeline entries (`proposal`, `question`, `response`, `system`)
4. `agent_war_room_blackboard`
   - versioned shared context document (`strategy_summary`, `risks`, `decision_log`, `implementation_plan_ref`)
5. `agent_war_room_signoffs`
   - one row per role/profile sign-off decision (`approved`, `changes_requested`, `blocked`) with rationale

Notes:

1. Keep EPIC-054 thread tables for direct peer mention interactions.
2. Optionally link war-room sessions to mesh thread IDs for traceability.

### 6.2 Service Layer

Create `WarRoomService` responsibilities:

1. Create/open/close session.
2. Invite participants and validate profile policy.
3. Append room messages and update blackboard versions.
4. Evaluate consensus state.
5. Trigger CEO moderation when deadlock criteria are met.
6. Publish lifecycle events + workflow event log entries.

### 6.3 Tool and Gateway Contract

Extend `nexus_orchestrator` action surface with war-room actions:

1. `open_war_room`
2. `invite_war_room_participant`
3. `post_war_room_message`
4. `update_war_room_blackboard`
5. `submit_war_room_signoff`
6. `get_war_room_state`
7. `close_war_room`

### 6.4 Consensus Model

Consensus states:

1. `collecting_input`
2. `draft_ready`
3. `partial_signoff`
4. `consensus_reached`
5. `deadlocked`
6. `ceo_tie_break_applied`

Tie-break policy:

1. Trigger when required sign-offs are conflicting after configurable threshold.
2. CEO records final decision via existing `submit_orchestration_decision` path.
3. Final outcome is written to blackboard and emitted as lifecycle event.

### 6.5 Workflow Integration Points

1. `project-spec-revision-ceo.workflow.yaml`
   - Open war room when revision impacts both PRD and SDD domains.
2. `work-item-refinement-default.workflow.yaml`
   - Optional war room between PM and Architect for large/high-risk items.
3. `work-item-in-progress-default.workflow.yaml`
   - Planning stage can open war room for large scope with missing implementation plan clarity.

---

## 7. Delivery Workstreams

### Workstream A: Contract and Capability Wiring

1. Add war-room actions to runner action enums and schema validation.
2. Add capability manifest entries and parity tests.
3. Update telemetry gateway payload DTOs and handlers.

### Workstream B: Backend Domain and Persistence

1. Add war-room entities, repositories, and migrations.
2. Implement lifecycle transitions and optimistic versioning for blackboard updates.
3. Add query methods for room state and participant sign-off summaries.

### Workstream C: Moderation and Consensus Engine

1. Implement consensus evaluation service.
2. Define deadlock detection rules and thresholds.
3. Wire CEO tie-break integration through orchestration decision log + event stream.

### Workstream D: Workflow Triggering and Policy

1. Add rule-based war-room invocation hooks to revision/refinement/planning workflows.
2. Add system settings for auto-open and required sign-off profiles by context.
3. Ensure workflow-driven behavior over hardcoded branching.

### Workstream E: UI and API Surfaces

1. Add War Room panel in project workspace with participant roster and consensus status.
2. Add blackboard view with version history and latest strategy snapshot.
3. Add clear distinction between simple mesh thread events and war-room session lifecycle.

### Workstream F: Observability and Reliability

1. Add war-room lifecycle events to telemetry taxonomy.
2. Add diagnostics counters: active sessions, deadlocks, tie-break count, time-to-consensus.
3. Ensure deterministic session closure and recovery on restart.

### Workstream G: Testing and Release Hardening

1. Unit tests for services/validators/policy.
2. Integration tests for end-to-end room lifecycle + sign-off + tie-break.
3. E2E scenario from revision/planning trigger through consensus and downstream execution.

---

## 8. Detailed Actionable Task Backlog

- [ ] A1. Extend action enums/types in `apps/api/src/tool/capability-catalog.ts`, `packages/pi-runner/src/nexus-bridge-tools.types.ts`.
- [ ] A2. Add runner parameter schema and validation for war-room actions in `packages/pi-runner/src/nexus-bridge-tools.validation.ts` and handler modules.
- [ ] A3. Add telemetry gateway handlers and typed payloads in `apps/api/src/telemetry/types.ts`, `apps/api/src/telemetry/telemetry.gateway.ts`.
- [ ] B1. Create new TypeORM entities for war-room sessions/participants/messages/blackboard/signoffs.
- [ ] B2. Add repositories with scoped query methods (`by project`, `by run`, `by work item`, `active only`).
- [ ] B3. Add DB migrations and project-delete cleanup integration.
- [ ] C1. Implement `WarRoomService.openSession()` with policy guardrails and participant bootstrap.
- [ ] C2. Implement `WarRoomService.updateBlackboard()` with monotonic version checks.
- [ ] C3. Implement `WarRoomService.submitSignoff()` and consensus state transitions.
- [ ] C4. Implement deadlock detection + CEO tie-break routing using existing orchestration decision logging.
- [ ] D1. Update `seed/workflows/project-spec-revision-ceo.workflow.yaml` to conditionally invoke war room.
- [ ] D2. Update `seed/workflows/work-item-refinement-default.workflow.yaml` for high-risk preflight alignment path.
- [ ] D3. Update `seed/workflows/work-item-in-progress-default.workflow.yaml` planning step to call war room when ambiguity policy is met.
- [ ] E1. Add web API types/client methods for war-room state retrieval and updates.
- [ ] E2. Build `WarRoomSessionPanel` UI and integrate into orchestration details page.
- [ ] E3. Add filters and badges in notification feed for war-room-specific events.
- [ ] F1. Add new event types and event-message mappers for war-room lifecycle.
- [ ] F2. Add diagnostics metrics endpoint extensions for war-room health.
- [ ] G1. Add API unit tests for service validation and policy denials.
- [ ] G2. Add telemetry gateway and runner contract tests for new actions.
- [ ] G3. Add E2E test case in `packages/e2e-tests` for revision/planning war-room flow.

---

## 9. Acceptance Criteria

### 9.1 Capability and Contract

1. War-room actions are callable through `nexus_orchestrator` and validated end-to-end.
2. Capability manifests, runner handlers, and gateway subscribers remain parity-checked.

### 9.2 Session and Collaboration Semantics

1. A session can be opened with multiple participants under the same project/run scope.
2. Participants can post messages and update a shared blackboard with version history.
3. Session state is queryable via API/tooling and recoverable after reconnect/restart.

### 9.3 Consensus and Moderation

1. Required participants can submit sign-offs with rationale.
2. Consensus status transitions are deterministic and auditable.
3. Deadlocked sessions escalate to CEO tie-break and persist final outcome.

### 9.4 Workflow Integration

1. Revision and planning flows can invoke war room via workflow logic, not hardcoded imperative branching.
2. War-room outcome is linked to downstream strategy/implementation plan context.

### 9.5 Observability and UX

1. War-room lifecycle events appear in workflow timeline and project notifications.
2. UI clearly distinguishes direct mesh thread activity from war-room sessions.
3. Session details (participants, blackboard, sign-offs, final decision) are visible in project workspace.

### 9.6 Reliability and Security

1. Policy matrix and scope guardrails prevent cross-project/session leakage.
2. Rate limits and payload limits are enforced and tested.
3. Failure paths (timeout/denial/deadlock) are non-blocking and explicitly surfaced.

---

## 10. Definition of Done

1. All planned war-room actions are implemented and contract-tested in API + runner.
2. Persistence model and migrations are merged, with cleanup paths covered.
3. Workflow seed updates invoke war-room behavior in intended revision/planning scenarios.
4. CEO moderation/tie-break path is implemented with auditable decision entries.
5. Web UI exposes war-room session state and lifecycle clearly.
6. Targeted unit/integration/E2E tests pass for new functionality and critical regressions.
7. Architecture docs are updated to reflect mesh v2 and war-room domain.

---

## 11. Risks and Mitigations

1. Risk: Scope creep turns war room into generic chat platform.
   Mitigation: enforce workflow/run-scoped sessions and non-goals.

2. Risk: Contract drift across capability manifest, runner actions, and gateway events.
   Mitigation: parity tests and shared typed action enums.

3. Risk: Blackboard update conflicts or lost writes.
   Mitigation: optimistic concurrency with version checks and conflict errors.

4. Risk: Excessive deadlocks requiring constant CEO intervention.
   Mitigation: explicit sign-off policies, timeout defaults, and escalation thresholds.

5. Risk: UI confusion between EPIC-054 thread flow and EPIC-068 war-room flow.
   Mitigation: separate labels, visual grouping, and event taxonomy.

---

## 12. Dependencies

1. EPIC-054 mesh v1 implementation and stability.
2. Existing orchestration decision log and mutating action governance flows.
3. Workflow seed lifecycle from pre-flight refinement and in-progress planning.

---

## 13. Suggested Phase Plan

1. Phase 1: Contract + persistence vertical slice (open room, invite, post, read state).
2. Phase 2: Blackboard + sign-off + consensus engine.
3. Phase 3: Workflow-triggered invocation in revision/refinement/planning.
4. Phase 4: CEO tie-break, UX hardening, and E2E coverage.

---

## 14. Open Questions (Resolve Before Build Start)

1. Which roles are mandatory signers per context (revision vs planning vs implementation)?
2. Should war-room blackboard persist into work-item `executionConfig` directly or remain separate with references?
3. In supervised mode, does CEO tie-break require user approval as a mutating action?
4. What is the timeout/escalation SLA for deadlock before tie-break?
