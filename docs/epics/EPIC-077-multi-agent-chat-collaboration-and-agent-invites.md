# EPIC-077: Multi-Agent Chat Collaboration and Agent-Driven Invites

> Status: Proposed
> Priority: High
> Depends On: EPIC-064 (Decoupled Chat Sessions), EPIC-054 (Agent Mesh), EPIC-068 (War Room Mesh)
> Last Updated: 2026-04-12

---

## 1. Epic Summary

EPIC-064 introduced decoupled single-agent chat sessions. This epic extends that model into a collaborative chat workspace where:

1. Users can start a chat with multiple agents from the frontend.
2. Agents already in the chat can invite other agents when additional expertise is needed.
3. Invite and discussion activity is captured as first-class, scoped collaboration telemetry.

The target outcome is a practical, project-scoped multi-agent chat experience that reuses existing mesh and telemetry foundations without coupling New Chat to workflow-run orchestration.

---

## 2. Problem Statement

Current behavior is intentionally limited:

1. New Chat supports one selected agent profile at creation time.
2. Chat execution is effectively single-agent and one-shot.
3. Mesh mention flows are keyed to `workflow_run_id`, not `chat_session_id`.
4. War Room collaboration is run-scoped under orchestration and cannot be used as the New Chat participant model.

Consequences:

1. Users cannot assemble a small agent team in one chat.
2. Agent collaboration inside ad-hoc chat requires external orchestration or manual context handoff.
3. Peer escalation patterns available in workflow runs are not available in chat sessions.

---

## 3. Goals

1. Add frontend support for creating a multi-agent chat session.
2. Add participant lifecycle APIs for chat sessions (invite, list, status, role).
3. Allow an agent in a chat session to invite another agent through an explicit tool action.
4. Persist invite/discussion artifacts with strict project/session scope.
5. Show participant and invite activity in Active Session UI and telemetry timeline.
6. Keep compatibility with existing single-agent chat and workflow mesh behavior.

---

## 4. Non-Goals

1. Creating a global cross-project freeform chat fabric.
2. Replacing orchestration War Room with New Chat collaboration.
3. Full autonomous swarm planning and task distribution in v1.
4. Cross-tenant communication or shared rooms across unrelated sessions.
5. Rewriting existing workflow-run mesh storage from scratch.

---

## 5. Current Reusable Foundation

1. Decoupled chat sessions and telemetry auth flow already exist (EPIC-064).
2. Active session UI already renders mesh and war-room lifecycle events in timeline formatters.
3. Mesh service already provides mention/check/resolve primitives with policy controls.
4. Capability/tool plumbing already supports adding new callback actions safely.

This epic should extend these surfaces rather than introducing a parallel collaboration subsystem.

---

## 6. Proposed Architecture

### 6.1 Collaboration Scope Generalization

Introduce a shared scope concept for communication records:

1. `scope_kind`: `workflow_run` | `chat_session`
2. `scope_id`: UUID/string identifier of the owning run or session
3. `project_id`: required for all collaboration records

This preserves workflow mesh behavior while allowing the same patterns in chat sessions.

### 6.2 Chat Participant Model

Add chat participant persistence:

1. `chat_session_participants`
   - `id`
   - `chat_session_id`
   - `agent_profile`
   - `role` (`owner`, `participant`, `moderator`)
   - `participation_status` (`invited`, `active`, `declined`, `left`, `removed`)
   - `invited_by`
   - `joined_at`, `left_at`
   - `metadata`

This becomes the source of truth for roster state shown in frontend and used for invite policy checks.

### 6.3 Agent Invite Tooling

Add a new runner action:

1. `invite_agent_to_chat`

Payload:

1. `chat_session_id`
2. `target_agent_profile`
3. `reason`
4. optional `context_files`
5. optional `urgency`

Result:

1. `status`: `accepted` | `denied`
2. `participant_status`
3. `denial_reason` when denied
4. lifecycle events emitted to chat stream

### 6.4 Chat Runtime Behavior

For invited participants:

1. Validate session scope, project scope, and policy matrix.
2. Create or activate participant entry.
3. Provision participant execution context.
4. Emit lifecycle events:
   - `chat_participant_invited`
   - `chat_participant_joined`
   - `chat_participant_invite_denied`
   - `chat_participant_left`
5. Route participant responses back to the same chat session stream.

### 6.5 Frontend UX Surface

New Chat dialog:

1. Multi-select participant agent profiles.
2. Optional moderator profile.
3. Starter message and project scope retained.

Active Session Workspace:

1. Participant roster card with status badges.
2. Manual Invite Agent control for users.
3. Timeline entries for invite/join/leave events.
4. Message attribution by profile and participant role.

---

## 7. API and Contract Additions

### 7.1 Session Creation

Extend `POST /sessions/chat` request:

1. `agentProfileName` (existing primary agent)
2. `participants` (new optional list)
3. `moderatorProfile` (new optional)

### 7.2 Participant Lifecycle

Add endpoints:

1. `GET /sessions/chat/:chatId/participants`
2. `POST /sessions/chat/:chatId/participants/invite`
3. `POST /sessions/chat/:chatId/participants/:participantId/remove` (optional v1.1)

### 7.3 State and Timeline

Add:

1. `GET /sessions/chat/:chatId/state`
   - session summary, participant roster, collaboration counters

Retain:

1. `GET /sessions/chat/:chatId/events`
2. `GET /sessions/chat/:chatId/telemetry-auth`

---

## 8. Policy, Security, and Governance

1. Enforce project-scoped collaboration only.
2. Add invite allow/deny matrix by requester profile -> target profile.
3. Add per-session and per-agent invite rate limits.
4. Enforce max participant count per session.
5. Return explicit denial reasons for policy failures.
6. Avoid logging sensitive prompt content in policy or error logs.

---

## 9. Delivery Workstreams

### Workstream A: Contracts and Schema

1. Extend chat DTOs/types for participant-aware session creation.
2. Add participant entity, repository, migration.
3. Add API response contracts for participant state.

### Workstream B: Runtime and Tooling

1. Add `invite_agent_to_chat` action schema and runtime handler.
2. Add chat-scope collaboration service methods.
3. Emit chat participant lifecycle events through existing telemetry pipeline.

### Workstream C: Frontend Experience

1. Upgrade New Session dialog to support multi-agent setup.
2. Add participant roster and invite controls to Active Session.
3. Add event mappers and filters for chat participant lifecycle events.

### Workstream D: Policies and Reliability

1. Implement invite policy matrix and limits.
2. Add timeout and cleanup for inactive invited participants.
3. Add diagnostics for invite success/denial/join latency.

### Workstream E: Testing and Hardening

1. Backend unit tests for policy, scope checks, and participant lifecycle transitions.
2. Frontend tests for New Session multi-agent form and roster rendering.
3. E2E tests for user-created multi-agent chat and agent-triggered invite path.

---

## 10. Detailed Actionable Backlog

- [ ] E077-001: Extend chat session DTOs and web API types with participant create payload.
- [ ] E077-002: Create `chat_session_participants` entity, repository, and migration.
- [ ] E077-003: Implement participant lifecycle endpoints (list/invite).
- [ ] E077-004: Add `invite_agent_to_chat` capability enum, validation, and runner bridge handling.
- [ ] E077-005: Generalize collaboration scope handling to support `chat_session` in mesh service paths.
- [ ] E077-006: Emit and persist chat participant lifecycle telemetry events.
- [ ] E077-007: Update New Session dialog for participant multi-select and moderator option.
- [ ] E077-008: Add Active Session participant roster and manual invite UI.
- [ ] E077-009: Add frontend event formatting for chat participant invite/join/deny/leave events.
- [ ] E077-010: Add policy keys for invite limits and requester-target matrix.
- [ ] E077-011: Add API unit/integration tests for invite acceptance and denial reasons.
- [ ] E077-012: Add web tests for form and roster behaviors.
- [ ] E077-013: Add E2E scenario in `packages/e2e-tests` for multi-agent chat collaboration.

---

## 11. Acceptance Criteria

### 11.1 User-Created Multi-Agent Chat

1. User can create a chat session with multiple agents from frontend.
2. Session state reflects all configured participants with correct statuses.
3. Existing single-agent chat creation remains functional.

### 11.2 Agent-Initiated Invites

1. Agent can request invitation of another agent via tool action.
2. Policy and scope checks are enforced with explicit denial reasons.
3. Accepted invites produce observable join lifecycle in session events.

### 11.3 UI and Observability

1. Active Session shows participant roster and invite status transitions.
2. Timeline includes participant lifecycle events in readable form.
3. Diagnostics expose invite outcome counters and participant counts.

### 11.4 Safety and Scope

1. No cross-project participant invitation is possible.
2. Rate limits and participant caps are enforced and tested.
3. Existing workflow-run mesh and War Room behavior remains backward compatible.

---

## 12. Definition of Done

1. Participant-aware chat contracts are merged in API and web types.
2. Participant persistence and invite APIs are deployed with tests.
3. `invite_agent_to_chat` action works end-to-end through runtime bridge.
4. Frontend can create and operate multi-agent chat sessions.
5. Agent-triggered invites are visible and auditable in telemetry history.
6. Relevant unit, integration, and E2E suites pass for changed areas.

---

## 13. Risks and Mitigations

1. Risk: Chat sessions become orchestration duplicates.
   Mitigation: keep chat collaboration lightweight and session-scoped; retain War Room for structured run governance.

2. Risk: Policy drift between workflow and chat scopes.
   Mitigation: centralize scope + policy evaluation in shared collaboration service utilities.

3. Risk: Participant fan-out causes resource pressure.
   Mitigation: per-session participant cap and invite rate limits with configurable defaults.

4. Risk: UI complexity regresses simple chat UX.
   Mitigation: preserve single-agent defaults and progressive disclosure for advanced controls.

---

## 14. Open Questions

1. Should invited agents always receive full prior chat history, or a curated context window?
2. Should manual user invites and agent-driven invites share identical policy matrices?
3. Should participant role defaults be profile-derived or user-selected at invite time?
4. Do we need explicit moderation controls in v1, or defer moderator actions to v1.1?
