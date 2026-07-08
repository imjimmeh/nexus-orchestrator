---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: chat-runtime
outcome: success
inferred_status: implemented
confidence_score: 0.85
evidence_refs:
  - apps/api/src/chat/chat-sessions/chat-sessions.service.ts
  - apps/api/src/chat/chat-messages/chat-messages.service.ts
  - apps/api/src/chat-execution/chat-execution.service.ts
  - apps/api/src/session/session-hydration.service.ts
  - apps/api/src/session/chat-session-context.service.ts
  - apps/api/src/chat/chat-sessions/chat-session-collaboration.service.ts
  - apps/api/src/chat/memory/chat-memory-lifecycle.service.ts
source_paths:
  - apps/api/src/chat
  - apps/api/src/chat-execution
  - apps/api/src/session
updated_at: 2026-06-02T00:00:00.000Z
---

# Probe Result: Chat Runtime and Sessions

## Narrative Summary

The chat runtime system is fully implemented across three interconnected modules: `chat` (session and message management), `chat-execution` (container orchestration and agent execution), and `session` (hydration, context, and cleanup). Sessions follow a complete lifecycle from creation through running, retry, completion/failure, and dehydration. Message handling integrates with workflow runs via BullMQ queues, with support for question/answer bridging to active agent containers via WebSocket. Collaboration features enable multi-participant chat sessions with role-based invites and activation jobs.

## Capability Updates

### Session Management
- **Session creation**: `ChatSessionsService.createSession()` handles profile validation, participant setup, and initial job enqueuing with tier-based container selection
- **Channel routing**: Deterministic session resolution per provider+thread+user identity, with active session tracking via `ChatChannelRouteRepository`
- **Collaboration**: `ChatSessionCollaborationService` orchestrates participant invites with acceptance/denial logic, activation job enqueuing, and lifecycle event publishing
- **Retry logic**: Auto-retry with exponential backoff, rate-limit-aware delay calculation, and in-flight capacity limits via `ChatSessionAutoRetryHelpers`

### Message Handling
- **Message sending**: `ChatMessagesService.sendChatMessage()` persists inbound messages, records memory, and links to workflow runs via `ChatToCoreActionService`
- **Workflow continuation**: Follow-up messages continue existing runs; fallback to new run if continuation fails
- **Question/answer bridging**: Pending runs are polled for pending questions; answers submitted to core or forwarded via WebSocket to active containers
- **Idempotency**: Provider message IDs prevent duplicate message persistence

### Execution Orchestration
- **Container provisioning**: `ChatExecutionService` provisions Docker containers based on profile tier (light/heavy), with JWT auth tokens containing session context
- **Tool mounting**: SDK tools and profile-allowed tools are mounted into containers at `/opt/pi-runner/extensions`
- **Context injection**: `ChatSessionContextService` orchestrates context providers, assembles markdown context, and injects as system message before agent execution
- **Session rehydration**: `SessionHydrationService` extracts JSONL from containers, validates structure, redacts secrets, compresses with gzip, and persists to `PiSessionTreeRepository`

### Memory and Distillation
- **Memory lifecycle**: `ChatMemoryLifecycleService` records inbound/outbound messages with type inference (history/preference/fact), importance scoring, and session-based pruning
- **Distillation queueing**: Sessions trigger distillation after turn count intervals or on close; large sessions auto-queued to distillation queue
- **Token threshold**: Sessions exceeding 80% of model context window trigger distillation

## Health Findings

### Test Coverage
- **chat-sessions.service.spec.ts**: 2+ test cases covering session creation, heavy tier, retry enqueuing
- **chat-messages.service.spec.ts**: 10+ test cases covering message persistence, workflow linking, Q/A bridging, WebSocket forwarding, idempotency, event history polling
- **chat-execution auto-retry**: `chat-session-auto-retry.helpers.spec.ts` with 8+ cases covering config loading, 429/529 handling, duration caps, exponential backoff
- **session-context.service.spec.ts**: Full provider orchestration tests including cache behavior, error resilience, priority sorting
- **session-hydration.service.spec.ts**: Docker archive extraction, compression, rehydration injection

### Code Quality
- Dependency injection via NestJS constructors with typed repositories
- BullMQ queue integration for async job processing (chat-sessions, session-cleanup, distillation)
- Error resilience: provider failures return degraded blocks rather than failing entire context build
- Structured logging with Logger instances per service

## Open Questions

- **Context provider implementations**: `chat-context-providers/` contains only interface; concrete implementations (project, external, steering) may be elsewhere or planned
- **Channel adapter completeness**: `channel-adapters/` directory contains types and Telegram submodule; coverage of other channels (web, API) not verified
- **Notification consumer**: `notification-consumer.service.ts` exists but scope of notification events not fully mapped
- **Distillation processing**: Queued distillation jobs are enqueued but actual worker processor not examined in this scope