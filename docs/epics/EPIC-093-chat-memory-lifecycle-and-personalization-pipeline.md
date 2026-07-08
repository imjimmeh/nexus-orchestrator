# EPIC-093: Chat Memory Lifecycle and Personalization Pipeline

Status: Implemented
Priority: P1
Depends On: EPIC-092
Related: PLAN-REFACTOR Phase 4 (memory expansion)
Last Updated: 2026-04-13

---

## 1. Epic Summary

Implement the persistent memory capabilities of apps/chat after baseline service extraction:

1. Short-term session memory
2. Durable profile memory promotion
3. Distillation and consolidation jobs
4. Memory-informed response context injection

This epic establishes chat-owned memory lifecycle while keeping Core memory-agnostic for product behavior.

---

## 2. Context

Current memory features are hosted in apps/api/memory and partially consumed by session/chat paths:

1. Memory module is global and includes distillation queue consumers.
2. Chat and session behavior rely on telemetry streams and session hydration paths.
3. Chat service target architecture requires memory ownership in apps/chat.

A controlled extraction is needed to avoid regressions in existing memory-backed behavior.

---

## 3. References

1. ../../PLAN-REFACTOR.md
2. ../../apps/api/src/memory/memory.module.ts
3. ../../apps/api/src/memory/memory-manager.service.ts
4. ../../apps/api/src/memory/distillation.consumer.ts
5. ../../apps/api/src/session/session-chat-messaging.service.ts
6. ../../apps/api/src/database/entities/memory-segment.entity.ts
7. ../../apps/api/src/database/repositories/memory-segment.repository.ts
8. ../../apps/api/src/database/entities/chat-session.entity.ts

---

## 4. Scope

### In Scope

1. Move chat-facing memory orchestration into apps/chat.
2. Implement chat memory domains:
   - session short-term memory
   - profile durable memory
   - promotion/audit records
3. Add background distillation and consolidation jobs in apps/chat.
4. Integrate memory retrieval into chat action prompt-building path.
5. Emit chat.memory.promoted.v1 and related memory lifecycle events.

### Out of Scope

1. Generic memory platform for non-chat domains.
2. Provider-specific deep memory integrations beyond current backend abstractions.
3. Full reimplementation of core telemetry infrastructure.

---

## 5. Implementation Plan

### 5.1 Memory Domain Model

1. Define chat-owned memory entities and repositories (or logical schema partition in interim).
2. Establish retention and pruning policy for short-term memory.
3. Add promotion audit fields and idempotency metadata.

### 5.2 Distillation Pipeline

1. Move or mirror distillation consumer logic into apps/chat worker context.
2. Add trigger policies for distillation (turn-count, session-close, scheduled).
3. Add consolidation routines to reduce duplicate or conflicting memories.

### 5.3 Retrieval and Context Injection

1. Add MemoryContextAssembler service in apps/chat.
2. Inject relevant memory slices into chat action requests to Core.
3. Track retrieval provenance in message metadata.

### 5.4 Events and Observability

1. Emit versioned memory lifecycle events from apps/chat.
2. Add metrics:
   - distillation success/failure
   - memory promotion volume
   - retrieval hit rate
3. Add operational dashboards and runbook notes.

---

## 6. Deliverables

1. apps/chat memory module and worker pipeline.
2. Distillation and promotion jobs with retry and idempotency behavior.
3. Memory-informed context assembly for chat actions.
4. Memory lifecycle event emission and telemetry.
5. Migration notes for memory ownership split from apps/api.

---

## 7. Acceptance Criteria

1. apps/chat persists short-term and durable memory records for chat sessions/profiles.
2. Distillation jobs run in apps/chat and are resilient to retries/replays.
3. Memory retrieval is used in chat action context assembly with measurable hit metrics.
4. chat.memory.promoted.v1 events are emitted with shared contract envelope.
5. Existing chat session behavior remains stable under deterministic integration tests.

---

## 8. Actionable Tasks

- [x] E093-001 Implement apps/chat memory module and persistence abstraction.
- [x] E093-002 Port or recompose distillation workers into apps/chat.
- [x] E093-003 Add promotion and consolidation policies with idempotency guards.
- [x] E093-004 Add MemoryContextAssembler for Core action requests.
- [x] E093-005 Add memory lifecycle event publishers and schemas.
- [x] E093-006 Add observability metrics and dashboards for memory pipeline.
- [x] E093-007 Add integration tests for memory promotion and retrieval behavior.

---

## 9. Test and Quality Gates

1. npm run lint
2. npm run lint:summary
3. npm run test --workspace=apps/chat
4. Targeted integration tests for distillation/retrieval consistency

---

## 10. Risks and Mitigations

1. Risk: Memory quality degradation after extraction.
   Mitigation: deterministic evaluation fixtures and regression scoring.
2. Risk: Duplicate memory writes across transition period.
   Mitigation: event idempotency and canonical ownership flag.
3. Risk: Prompt bloat from uncontrolled memory inclusion.
   Mitigation: ranking, token budgeting, and bounded inclusion strategy.

---

## 11. Exit Criteria

1. Chat memory lifecycle runs entirely in apps/chat.
2. Memory promotion/retrieval is observable, testable, and stable.
3. apps/api no longer owns chat memory product behavior.
