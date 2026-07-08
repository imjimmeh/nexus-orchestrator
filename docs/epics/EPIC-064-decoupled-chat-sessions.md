# EPIC-064: Decoupled Chat Sessions

**Status:** In Progress  
**Created:** 2026-04-08  
**Plan Reference:** [`docs/plans/PLAN-decoupled-agent-sessions.md`](../plans/PLAN-decoupled-agent-sessions.md)

---

## Summary

Decouple agent chat sessions from the workflow engine so that users can start a conversation with any agent profile without requiring seeded workflow definitions, BullMQ workflow job processing, or workflow run state management. A new `ChatSession` entity and `ChatExecutionService` directly provision containers and execute agents, providing a lightweight alternative to the full workflow engine path.

## Problem

All agent execution currently routes through the workflow engine:

1. `WorkflowEngineService.startWorkflow()` → `WorkflowRun` row → BullMQ `workflow-steps` queue → step executor → container provisioning → pi-runner HTTP call.
2. This requires a seeded workflow definition (`orchestration_invoke_agent_default`) in the database.
3. Telemetry WebSocket auth is gated behind `GET /workflows/runs/:runId/telemetry-auth`.
4. The ad-hoc session endpoint (`POST /sessions/ad-hoc`) fails silently when the workflow seed hasn't run.

These coupling points make simple chat sessions fragile and heavyweight.

## Goals

1. Users can start a chat session with any active agent profile, independently of workflows.
2. Chat sessions provision containers directly (`ContainerOrchestratorService`), without workflow runs.
3. Telemetry streaming works for both chat sessions and workflow runs via a generalized stream ID concept.
4. Session persistence reuses the existing `PiSessionTree` infrastructure.
5. The frontend provides a seamless New Chat → Active Session experience.

## Non-Goals

- Multi-turn / follow-up messages in the same container session (future work).
- Workflow-to-chat-session migration for existing data (no backfill).
- Changes to the pi-runner container image or SDK.

---

## Acceptance Criteria

1. `POST /sessions/chat` creates a `ChatSession` row and enqueues a BullMQ job on the `chat-sessions` queue.
2. The `ChatSessionConsumer` provisions a container, executes the agent, and handles completion/failure.
3. `GET /sessions/chat` lists chat sessions with filtering by status and project.
4. `GET /sessions/chat/:id` returns session details including status and agent profile.
5. `DELETE /sessions/chat/:id` cancels a running session.
6. `GET /sessions/chat/:id/telemetry-auth` returns a WebSocket auth token for real-time event streaming.
7. `GET /sessions/chat/:id/events` returns event history (polling fallback).
8. The telemetry gateway accepts connections from chat session containers (JWT with `chatSessionId`).
9. The frontend `NewSessionDialog` uses the chat session API.
10. The frontend `SessionsListPage` displays chat sessions from the new API.
11. The `ActiveSessionWorkspace` supports chat session IDs for real-time telemetry.
12. All existing workflow-based telemetry and session flows continue to work (backward compatible).
13. All unit tests pass; new services have >80% coverage.
14. Linting and type-checking pass with zero suppressions.

---

## Technical Design

### New Entity: `chat_sessions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `status` | VARCHAR(20) | STARTING, RUNNING, COMPLETED, FAILED, CANCELLED |
| `agent_profile_id` | UUID FK | References `agent_profiles(id)` |
| `agent_profile_name` | VARCHAR(255) | Snapshot at creation |
| `project_id` | UUID FK (nullable) | Optional project scope |
| `initial_message` | TEXT | User's first message |
| `display_name` | VARCHAR(512) | Human-readable label |
| `container_id` | VARCHAR(128) | Docker container ID |
| `container_tier` | SMALLINT | 1=light, 2=heavy |
| `provider` | VARCHAR(64) | Resolved AI provider |
| `model` | VARCHAR(128) | Resolved model name |
| `system_prompt` | TEXT | Resolved system prompt |
| `session_tree_id` | UUID FK (nullable) | Link to `pi_session_trees` |
| `workflow_run_id` | UUID FK (nullable) | Optional workflow linkage |
| `error_message` | TEXT (nullable) | Failure details |
| `source` | VARCHAR(64) | 'ad-hoc', 'workflow', 'subagent' |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |
| `completed_at` | TIMESTAMPTZ (nullable) | |

### Execution Flow (No Workflow Engine)

```
POST /sessions/chat
  → Validate agent profile + project
  → Create ChatSession (status=STARTING)
  → Enqueue to 'chat-sessions' BullMQ queue
  → Return { id: chatSessionId }

ChatSessionConsumer processes job:
  → Resolve AI config (model, provider, API key)
  → Provision container (ContainerOrchestratorService)
  → Start container, wait for health
  → POST /execute/agent to pi-runner
  → Update status to RUNNING
  → On success: save session (PiSessionTree), status=COMPLETED
  → On failure: log error, status=FAILED
  → Cleanup: shutdown container, remove
```

### Telemetry Generalization

- JWT payload adds optional `chatSessionId` field alongside existing `workflowRunId`.
- Gateway connection handler derives `streamId = chatSessionId ?? workflowRunId`.
- Redis stream/pub-sub keys use `streamId` for consistent event routing.
- Workflow-specific handlers (turn_end advancement, step_complete) guard against chat session connections.

### Session Hydration Extension

- `PiSessionTree` gains nullable `chat_session_id` column.
- `SessionHydrationService` adds `saveSessionForChat(containerId, chatSessionId)` that creates a `PiSessionTree` row linked to the chat session.

---

## Phases

### Phase 1: Core Types & Entity Layer
- `IChatSession` interface and `ChatSessionStatus` enum in `@nexus/core`
- `ChatSession` TypeORM entity
- `ChatSessionRepository`
- TypeORM migration
- `PiSessionTree` entity update (nullable `chat_session_id`)
- `DatabaseModule` registration

### Phase 2: Chat Execution Service ✅ COMPLETE
- ✅ `ChatExecutionService` — orchestrates container lifecycle
- ✅ `ChatSessionConsumer` — BullMQ consumer for `chat-sessions` queue  
- ✅ `ChatSessionJobData` type
- ✅ Session hydration support for chat sessions
- ✅ Unit tests

### Phase 3: Telemetry Generalization
- Generalize `AuthenticatedSocket` with `chatSessionId` and `streamId`
- Update JWT decode in `handleTelemetryConnectionCompat`
- Guard workflow-specific handlers against chat connections
- Add `GET /sessions/chat/:id/telemetry-auth` endpoint

### Phase 4: API Endpoints
- Replace `POST /sessions/ad-hoc` with `POST /sessions/chat`
- Replace `GET /sessions/ad-hoc` with `GET /sessions/chat`
- Add `GET /sessions/chat/:id`, `DELETE /sessions/chat/:id`
- Add `GET /sessions/chat/:id/events`
- Unit tests for all endpoints

### Phase 5: Frontend Integration
- Chat session types and API client methods
- `useChatSessions` hook (replaces `useAdHocSessions`)
- Generalized telemetry hook supporting both workflows and chat sessions
- Updated `NewSessionDialog`, `SessionsListPage`, `ActiveSessionWorkspace`
- Route updates

---

## File Inventory

### New Files

| File | Purpose |
|------|---------|
| `packages/core/src/interfaces/chat-session.types.ts` | `IChatSession`, `ChatSessionStatus` |
| `apps/api/src/database/entities/chat-session.entity.ts` | TypeORM entity |
| `apps/api/src/database/repositories/chat-session.repository.ts` | Repository |
| `apps/api/src/database/migrations/20260408000000-create-chat-sessions.ts` | Migration |
| `apps/api/src/session/chat-execution.service.ts` | Core execution orchestrator |
| `apps/api/src/session/chat-execution.consumer.ts` | BullMQ consumer |
| `apps/api/src/session/chat-execution.types.ts` | Job data types |
| `apps/api/src/session/chat-execution.service.spec.ts` | Service unit tests |
| `apps/api/src/session/chat-execution.consumer.spec.ts` | Consumer unit tests |
| `apps/web/src/hooks/useChatSessions.ts` | React Query hooks |

### Modified Files

| File | Change |
|------|--------|
| `packages/core/src/interfaces/index.ts` | Re-export chat session types |
| `apps/api/src/database/entities/pi-session-tree.entity.ts` | Add nullable `chat_session_id` |
| `apps/api/src/database/database.module.ts` | Register entity + repository |
| `apps/api/src/session/session.module.ts` | Register services + BullMQ queue |
| `apps/api/src/session/session.controller.ts` | Chat session endpoints |
| `apps/api/src/session/session.controller.dto.ts` | New DTOs |
| `apps/api/src/session/session.controller.spec.ts` | Updated tests |
| `apps/api/src/session/session-hydration.service.ts` | Chat session support |
| `apps/api/src/telemetry/types.ts` | Add `chatSessionId`, `streamId` |
| `apps/api/src/telemetry/telemetry-gateway-connection.helpers.ts` | Generic stream ID |
| `apps/web/src/lib/api/client.ts` | Chat session API methods |
| `apps/web/src/lib/api/types.ts` | Chat session types |
| `apps/web/src/lib/queryKeys.ts` | Chat session keys |
| `apps/web/src/components/sessions/NewSessionDialog.tsx` | Use chat API |
| `apps/web/src/pages/sessions/SessionsListPage.tsx` | Query chat API |
| `apps/web/src/pages/active-session/ActiveSessionWorkspace.tsx` | Support chatSessionId |
| `apps/web/src/App.tsx` | Update routes |

### Deleted Files

| File | Replaced By |
|------|-------------|
| `apps/web/src/hooks/useAdHocSessions.ts` | `apps/web/src/hooks/useChatSessions.ts` |
