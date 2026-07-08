# EPIC-054: Peer-to-Peer Agent Communication Mesh (Dev Team Chat)

> Status: Implemented (v1 shipped)
> Priority: High
> Estimate: 4-7 weeks
> Created: 2026-04-05
> Last Updated: 2026-04-06
> Owner: TBD

> **Note (2026-06-25):** The thin `SubagentOrchestratorService` facade was restored at `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.service.ts`. See [ADR-0003](../architecture/adr/ADR-0003-restore-subagent-orchestrator-facade.md).

---

## 1. Epic Summary

Enable first-class peer communication between agents working within the same work item execution context.

Today, collaboration is strictly hierarchical (parent -> subagent -> parent result handoff). This epic introduces an agent communication mesh so an implementing agent can explicitly request focused help from another specialist agent (for example, junior dev -> architect) using @mention-style semantics with traceable responses.

The mesh will be:

1. Work-item scoped.
2. Policy-governed and auditable.
3. Observable in runtime telemetry and orchestration UI.
4. Compatible with existing subagent execution primitives.

### 1.1 Implementation Snapshot (2026-04-06)

Implemented in current codebase:

1. Mesh domain entities and repositories for communication threads/messages.
2. `AgentCommunicationMeshService` with policy and validation helpers.
3. Runner/gateway action path for:
   - `mention_agent`
   - `check_agent_mentions`
   - `resolve_agent_thread`
4. Telemetry Gateway handlers and lifecycle events:
   - `agent_mention_requested`
   - `agent_mention_received`
   - `agent_mention_responded`
   - `agent_mention_timeout`
   - `agent_thread_resolved`
   - `agent_mention_denied`
5. Capability manifest/catalog updates so mesh actions are available through orchestration tool surfaces.
6. Web UX updates for mesh visibility in active session chat, orchestration notifications, and thread panel views.
7. Unit/integration coverage in workflow, gateway, and web notification/thread components.

---

## 2. Codebase and App Review Findings

### 2.1 Current Strengths (Reusable Foundations)

1. Subagent lifecycle exists and is production-wired:
   - `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.service.ts` (facade; restored per ADR-0003 at `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.service.ts`)
   - `apps/api/src/workflow/workflow-runtime-subagent-tools.service.ts`
   - `apps/api/src/workflow/workflow-runtime-tools.controller.ts`
2. Runner bridge action surface is centralized in:
   - `packages/pi-runner/src/nexus-bridge-tools.ts`
3. Capability contract is centrally modeled in:
   - `apps/api/src/tool/capability-manifest.execution.entries.ts`
4. Real-time event channel and persistence already exist:
   - `apps/api/src/telemetry/telemetry.gateway.ts`
   - `apps/api/src/workflow/workflow-event-log.service.ts`
   - `apps/api/src/database/entities/workflow-event.entity.ts`
5. Web surfaces already render orchestration activity and subagent telemetry:
   - `apps/web/src/components/orchestration/SubagentExecutionPanel.tsx`
   - `apps/web/src/components/notifications/OrchestrationNotificationFeed.tsx`
   - `apps/web/src/pages/active-session/active-session.chat-builder.ts`

### 2.2 Current Gaps (Why This Epic Is Needed)

1. No peer message primitive:
   - No tool action or API route for agent-to-agent mentions/messages.
2. No communication domain model:
   - `subagent_executions` tracks lifecycle but not conversational exchanges.
3. No policy model for cross-agent contact:
   - IAM profiles define allowed tools, but no mention matrix, rate limits, or allowed target roles.
4. No structured UI for agent help threads:
   - Existing feed shows lifecycle signals, not explicit ask/answer exchanges.

### 2.3 Regression Lessons to Bake In (from repo memory)

1. Avoid declared-vs-callable drift for any new tool action path.
2. Preserve step/workflow identity consistency in JWT/socket routing.
3. Ensure completion and acknowledgment signals are written to all required channels for deterministic resume behavior.

---

## 3. Problem Statement

When a specialist agent gets blocked, the only reliable option is parent-directed delegation or fallback to broad subagent spawning. There is no explicit, structured way to ask a peer for narrow guidance within the same work item context.

Consequences:

1. Over-delegation and larger context switches than needed.
2. Slower resolution for targeted design/code questions.
3. Reduced quality in multi-role execution because tacit collaboration is missing.
4. Poor visibility of why/when expert assistance was requested.

---

## 4. Goals

1. Add @mention-style agent communication scoped to project/work item/workflow run context.
2. Allow a requesting agent to receive structured peer responses without breaking current execution semantics.
3. Enforce policy guardrails (who can mention whom, frequency limits, payload limits).
4. Persist communication timeline for auditability and UI display.
5. Integrate communication events into telemetry and orchestration diagnostics.
6. Keep compatibility with current subagent orchestration and mode policies.

---

## 5. Non-Goals

1. Building an unrestricted global multi-agent chat room across projects.
2. Replacing existing subagent spawn/wait/status behavior.
3. Implementing full autonomous swarm planning in this epic.
4. Implementing cross-tenant or cross-project communication channels.

---

## 6. Proposed Architecture

### 6.1 New Mesh Domain

Introduce communication records decoupled from `subagent_executions`:

1. `agent_communication_threads`
   - Scope: `project_id`, `work_item_id`, `workflow_run_id`
   - Fields: `status`, `created_by_execution_id`, `target_profile`, `correlation_id`, timestamps
2. `agent_communication_messages`
   - Fields: `thread_id`, `sender_execution_id`, `recipient_profile`, `message_kind` (`request`, `response`, `system`), `body`, `metadata`, timestamps

Rationale:

1. Preserves existing execution model.
2. Enables independent querying and UI rendering.
3. Supports future expansion (multi-recipient, SLA, escalation) without reshaping subagent execution tables.

### 6.2 Service Layer

Add `AgentCommunicationMeshService` responsibilities:

1. Validate mention payload and scope.
2. Enforce policy and rate limits.
3. Resolve recipient strategy:
   - Direct route to active matching agent session, when available.
   - Fallback advisory spawn (target profile) when direct target is not active.
4. Persist thread and message artifacts.
5. Emit workflow telemetry + event ledger signals.

### 6.3 Tool/Bridge Contract

Extend `nexus_orchestrator` action enum with mesh actions:

1. `mention_agent`
2. `check_agent_mentions`
3. `resolve_agent_thread`

Payload sketch:

1. `mention_agent`
   - `target_agent_profile`
   - `message`
   - `work_item_id` (optional; default inferred)
   - `context_files` (optional)
   - `urgency` (`normal` | `high`)
2. `check_agent_mentions`
   - optional `thread_id`
3. `resolve_agent_thread`
   - `thread_id`
   - optional `resolution_note`

### 6.4 Gateway and Runtime Flow

1. Runner emits mesh events via existing websocket bridge.
2. `TelemetryGateway` handles and routes to mesh service.
3. Mesh service writes workflow events with dedicated event types:
   - `agent_mention_requested`
   - `agent_mention_received`
   - `agent_mention_responded`
   - `agent_mention_timeout`
   - `agent_thread_resolved`
4. Responses are retrievable both as immediate tool results (if available) and through polling (`check_agent_mentions`).

### 6.5 UI Surfaces

1. Active Session chat timeline:
   - Render mention request/response system events.
2. Orchestration activity feed:
   - Add `agent_mesh` notification category.
3. Subagent observability panel extension:
   - Link subagent executions spawned as advisory responses to thread IDs.

### 6.6 Governance and Security

1. Add policy matrix in settings (or policy service):
   - allowed requester profiles -> target profiles.
2. Add per-run and per-thread rate limits.
3. Add payload size limits and sanitization.
4. Keep communication confined to same project/work-item scope.
5. Include explicit denial reasons for policy failures.

---

## 7. Workstreams

### Workstream A: Contract and Capability Wiring

1. Extend `nexus_orchestrator` action schema and validator.
2. Update capability manifest execution entries and parity tests.
3. Update seeded profile/workflow references where mention actions are expected.

### Workstream B: Backend Mesh Domain and Services

1. Add DB entities + migrations for communication threads/messages.
2. Add repositories and mesh service.
3. Add policy/rate-limit enforcement primitives.

### Workstream C: Gateway and Runtime Integration

1. Add websocket handlers for mesh events in telemetry gateway.
2. Implement recipient resolution (direct vs advisory spawn fallback).
3. Add workflow event-log and event-ledger integration.

### Workstream D: Runner Bridge Integration

1. Extend bridge action handlers/validation in pi-runner.
2. Ensure action outputs contain deterministic IDs (`thread_id`, `correlation_id`).
3. Add runner unit tests for new actions.

### Workstream E: UI and UX

1. Render mesh events in active session chat builder.
2. Extend orchestration notification feed categories and filters.
3. Add thread summary card in orchestration details (initially read-only).

### Workstream F: Testing and Reliability

1. API/service/gateway unit tests.
2. Integration test for mention->response flow.
3. E2E scenario: junior dev requests architect help, receives response, continues and completes step.

---

## 8. Delivery Plan

### Phase 1 (Week 1): Minimal Vertical Slice

1. Add `mention_agent` action contract in runner + gateway.
2. Persist mention request as workflow event.
3. Return synchronous advisory response via controlled fallback spawn.
4. Basic unit coverage.

### Phase 2 (Weeks 2-3): Durable Mesh Model

1. Add communication thread/message tables and service.
2. Add `check_agent_mentions` polling action.
3. Add policy matrix and rate limiting.
4. Add integration tests.

### Phase 3 (Weeks 4-5): UX and Observability

1. Add UI timeline/feed rendering for mesh events.
2. Add diagnostics fields for mention backlog/timeouts.
3. Add event-ledger correlation and dashboards.

### Phase 4 (Weeks 6-7, Hardening)

1. Add `resolve_agent_thread` and lifecycle states.
2. Add timeout/escalation behavior.
3. Add E2E regression suite in `packages/e2e-tests`.

---

## 9. Backend Scope

### Expected Files to Modify

1. `apps/api/src/telemetry/telemetry.gateway.ts`
2. `apps/api/src/telemetry/telemetry.gateway.spec.ts`
3. `apps/api/src/workflow/workflow-runtime-tools.controller.ts`
4. `apps/api/src/workflow/workflow-runtime-subagent-tools.service.ts`
5. `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.service.ts` (facade; delegates to `SubagentProvisioningService` / `SubagentCoordinationService`)
6. `apps/api/src/tool/capability-manifest.execution.entries.ts`
7. `apps/api/src/security/iam-policy.service.ts`
8. `apps/api/src/database/seeds/agent-profiles/profiles/*.profile.ts`
9. `apps/api/src/database/seeds/work-item-in-progress-default.workflow.yaml`

### Expected Files to Create

1. `apps/api/src/database/entities/agent-communication-thread.entity.ts`
2. `apps/api/src/database/entities/agent-communication-message.entity.ts`
3. `apps/api/src/database/repositories/agent-communication-thread.repository.ts`
4. `apps/api/src/database/repositories/agent-communication-message.repository.ts`
5. `apps/api/src/workflow/agent-communication-mesh.service.ts`
6. `apps/api/src/workflow/agent-communication-mesh.service.spec.ts`
7. DB migration files for new tables/indexes

---

## 10. Runner Scope

### Expected Files to Modify

1. `packages/pi-runner/src/nexus-bridge-tools.ts`
2. `packages/pi-runner/src/nexus-bridge-tools.spec.ts`
3. `packages/pi-runner/src/session-factory.ts` (if additional runtime callback handling is required)

---

## 11. Frontend Scope

### Expected Files to Modify

1. `apps/web/src/pages/active-session/active-session.chat-builder.ts`
2. `apps/web/src/pages/active-session/active-session.utils.ts`
3. `apps/web/src/components/notifications/OrchestrationNotificationFeed.tsx`
4. `apps/web/src/pages/project-workspace/OrchestrationTab.notifications.ts`
5. `apps/web/src/pages/project-workspace/OrchestrationDetailsSection.tsx`
6. `apps/web/src/lib/api/types.ts`
7. `apps/web/src/lib/api/client.projects.ts`

### Expected Files to Create

1. `apps/web/src/components/orchestration/AgentCommunicationThreadPanel.tsx`

---

## 12. Acceptance Criteria

### 12.1 Capability and Contract

1. `nexus_orchestrator` supports mesh actions with validated payloads.
2. Capability manifest and runtime handlers remain parity-checked in tests.

### 12.2 Communication Semantics

1. Agent can request peer help via `mention_agent` in a work-item run.
2. Request and response are persisted with thread/correlation IDs.
3. Agent can retrieve pending/recent responses via `check_agent_mentions`.

### 12.3 Security and Governance

1. Mention attempts outside policy are denied with explicit reason.
2. Rate limits and payload limits are enforced.
3. Communication is scoped to the same project/work-item context.

### 12.4 Observability and UX

1. Mention lifecycle appears in workflow event history.
2. Orchestration activity feed shows mesh notifications.
3. Active session view renders mention request/response entries.

### 12.5 Reliability

1. Timeout and no-recipient paths are deterministic and non-blocking.
2. Existing subagent spawn/wait/status behavior remains backward-compatible.

### 12.6 Quality Gate

1. Unit and integration suites pass for changed modules.
2. E2E scenario for peer-help flow passes.

---

## 13. Risks and Mitigations

1. Risk: Tool action declared but not callable end-to-end.
   Mitigation: contract parity tests across manifest, runner bridge, and gateway handler.

2. Risk: Message routing misses active target because of identity mismatch.
   Mitigation: strict correlation on run/step/subagent IDs and explicit tests for routing keys.

3. Risk: Agent spam/noise from unbounded mentions.
   Mitigation: profile pair policy, per-run quotas, and cool-down intervals.

4. Risk: Cross-thread context leakage.
   Mitigation: enforce work-item and project scope checks in mesh service.

5. Risk: UX confusion between subagent lifecycle and peer chat.
   Mitigation: separate UI labels and event taxonomy (`subagent` vs `agent_mesh`).

---

## 14. Dependencies

1. EPIC-048 Subagent Runtime Wiring and Coordination Baseline
2. EPIC-050 Capability Contract and Orchestration Tooling Excellence
3. Existing telemetry/event-log pipeline and orchestration diagnostics endpoints

---

## 15. Definition of Done

1. Peer mention actions are callable and policy-enforced in production runtime.
2. Mesh threads/messages are persisted, queryable, and visible in UI timelines.
3. Telemetry and diagnostics clearly explain request, response, timeout, and denial states.
4. Existing orchestration and subagent workflows remain stable with no contract regressions.
5. Regression tests (unit/integration/E2E) pass for the new communication mesh path.
