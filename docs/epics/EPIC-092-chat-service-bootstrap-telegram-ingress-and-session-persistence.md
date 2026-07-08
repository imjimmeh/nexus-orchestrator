# EPIC-092: Chat Service Bootstrap, Telegram Ingress, and Session Persistence

Status: Implemented
Priority: P0
Depends On: EPIC-088, EPIC-089, EPIC-090
Related: PLAN-REFACTOR Phase 4 (initial slice)
Last Updated: 2026-04-13

---

## 1. Epic Summary

Start implementation of the third service (apps/chat) by extracting chat domain ownership from apps/api/session and delivering a production-viable baseline:

1. Channel adapter abstraction
2. Telegram ingress adapter (first channel)
3. Persistent chat session and message timeline
4. Core workflow action request integration through shared contracts

This epic is the first executable step for the new chat service.

---

## 2. Context

The current monolith already contains chat primitives but no standalone chat service:

1. Session controller currently hosts both legacy ad-hoc and decoupled chat routes.
2. Chat execution service provisions containers and executes agents in-process.
3. Session messaging persists user events to telemetry streams and uses participant turn services.
4. apps workspace currently has no apps/chat package.

The migration should preserve existing behavior while moving ownership into apps/chat.

---

## 3. References

1. ../../PLAN-REFACTOR.md
2. ../../apps/api/src/session/session.module.ts
3. ../../apps/api/src/session/session.controller.ts
4. ../../apps/api/src/session/chat-execution.service.ts
5. ../../apps/api/src/session/session-chat-messaging.service.ts
6. ../../apps/api/src/database/entities/chat-session.entity.ts
7. ../../apps/api/src/database/repositories/chat-session.repository.ts
8. ../../apps/api/src/telemetry/telemetry.gateway.ts
9. ../../docker-compose.yaml

---

## 4. Scope

### In Scope

1. Create apps/chat Nest service with channel, session, and messaging modules.
2. Port chat session CRUD and message submission APIs from apps/api/session.
3. Add channel adapter interface and Telegram webhook adapter.
4. Persist inbound/outbound message timeline in chat-owned store.
5. Integrate with Core internal workflow API for tool-capable actions.
6. Add compatibility proxy path in apps/api for existing /sessions/chat clients.

### Out of Scope

1. Full multi-channel support (Slack/Discord).
2. Advanced memory distillation lifecycle (covered in EPIC-093).
3. Full frontend endpoint migration.

---

## 5. Implementation Plan

### 5.1 Service Scaffold and Domain Modules

1. Create apps/chat modules:
   - channel-adapters
   - chat-sessions
   - chat-messages
   - chat-actions
2. Add service-specific persistence layer for chat entities.
3. Move session/chat controller responsibilities from apps/api into apps/chat controllers.

### 5.2 Telegram Adapter

1. Define inbound channel contract (provider, external user, message payload, correlation metadata).
2. Implement Telegram webhook endpoint and signature/secret validation.
3. Add outbound sender abstraction and Telegram sender implementation.

### 5.3 Core Action Integration

1. Create ChatToCoreActionService using shared CoreClient contracts.
2. Support minimal action flow:
   - inbound message creates/updates chat session
   - action request to Core workflow run
   - receive completion/failure status via API polling or event subscription
3. Persist linkage between chat message and runId.

### 5.4 Compatibility Bridge

1. Keep current /sessions/chat route availability through apps/api proxy to apps/chat.
2. Add compatibility metrics for routed calls and failures.
3. Preserve auth behavior with service-to-service identity propagation.

---

## 6. Deliverables

1. apps/chat service baseline running in local compose.
2. Telegram inbound webhook endpoint and adapter abstraction.
3. Persistent chat session and message timeline APIs.
4. Core action request integration for first executable chat actions.
5. apps/api compatibility proxy for chat endpoints.

---

## 7. Acceptance Criteria

1. apps/chat starts and serves chat session and message APIs.
2. Telegram inbound message creates or appends to a chat session timeline.
3. Chat action request triggers Core workflow execution via shared contract client.
4. Run linkage is persisted and queryable from chat session details.
5. Existing clients using /sessions/chat continue functioning via compatibility proxy.
6. No direct dependency on workflow internals inside apps/chat.

---

## 8. Actionable Tasks

- [x] E092-001 Scaffold apps/chat modules and bootstrap wiring.
- [x] E092-002 Port chat session list/get/create/cancel endpoints into apps/chat.
- [x] E092-003 Port message submission and event retrieval APIs into apps/chat.
- [x] E092-004 Define ChannelAdapter interface and Telegram adapter implementation.
- [x] E092-005 Add inbound Telegram webhook route with auth/signature validation.
- [x] E092-006 Add outbound adapter abstraction and Telegram sender service.
- [x] E092-007 Add ChatToCoreActionService using packages/core contracts.
- [x] E092-008 Persist chat-to-run linkage and response status projection.
- [x] E092-009 Add apps/api compatibility proxy for /sessions/chat routes.
- [x] E092-010 Add integration tests for inbound message to core action flow.

---

## 9. Test and Quality Gates

1. npm run lint
2. npm run lint:summary
3. npm run test --workspace=apps/chat
4. npm run test:api (compatibility proxy coverage)
5. Targeted integration test for inbound Telegram to core run request flow

---

## 10. Risks and Mitigations

1. Risk: Telegram adapter introduces untrusted payload risk.
   Mitigation: strict schema validation and provider signature checks.
2. Risk: Double processing from webhook retries.
   Mitigation: idempotency keys using provider message IDs.
3. Risk: Proxy drift between apps/api and apps/chat contracts.
   Mitigation: proxy contract tests and shared DTO imports only.

---

## 11. Exit Criteria

1. apps/chat can ingest Telegram messages and persist sessions/messages.
2. apps/chat can request Core actions with durable run linkage.
3. Existing /sessions/chat clients remain operational through proxy.
