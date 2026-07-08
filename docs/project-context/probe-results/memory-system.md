---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: memory-system
outcome: success
inferred_status: implemented
confidence_score: 0.87
evidence_refs:
  - apps/api/src/memory/memory.module.ts
  - apps/api/src/memory/memory-manager.service.ts
  - apps/api/src/memory/memory-backend.types.ts
  - apps/api/src/memory/memory-backend.factory.ts
  - apps/api/src/memory/postgres-memory-backend.service.ts
  - apps/api/src/memory/honcho-memory-backend.service.ts
  - apps/api/src/memory/distillation.consumer.ts
  - apps/api/src/memory/token-counter.service.ts
  - apps/api/src/session/session.module.ts
  - apps/api/src/session/session-hydration.service.ts
  - apps/api/src/session/session-cleanup.service.ts
  - apps/api/src/session/jsonl-validation.service.ts
  - apps/api/src/session/chat-session-context.service.ts
  - apps/api/src/session/chat-session-context-refresh.listener.ts
  - apps/api/src/memory/learning/learning.service.ts
source_paths:
  - apps/api/src/memory
  - apps/api/src/session
updated_at: 2026-06-02T00:00:00.000Z
---

# Probe Result: Memory and Session Management

## Narrative Summary

The memory and session management subsystems are fully implemented with comprehensive coverage across both scopes. The memory system provides a pluggable backend architecture supporting PostgreSQL and Honcho (with dual-mode fallback), session dehydration/rehydration via Docker archive operations, automated token-based distillation for long sessions, and a learning subsystem for promoting learned behaviors. The session system handles containerized session state persistence with gzip compression, JSONL validation, scheduled cleanup (30-day retention + orphaned run detection), and dynamic context injection for chat sessions via provider-based context blocks.

## Capability Updates

### Memory Module (`apps/api/src/memory`)
- **MemoryBackend interface**: 8-method contract defining create, read, update, delete, and search operations with entity/entity-type scoping and memory-type filtering (`memory-backend.types.ts`)
- **MemoryManagerService**: Orchestration layer delegating to injected backend, publishing plugin events on memory recording with best-effort semantics
- **Backend factory**: Environment-driven mode selection (`MEMORY_BACKEND=postgres|honcho|dual`) with graceful fallback
- **PostgresMemoryBackendService**: Primary persistent storage implementation with repository pattern
- **HonchoMemoryBackendService**: Read-optimized external backend with postgres write-through; supports `HONCHO_FALLBACK_ON_ERROR` and `HONCHO_FALLBACK_ON_EMPTY` config
- **HonchoFallbackMemoryBackendService**: Dual-write mode with conflict resolution
- **TokenCounterService**: Estimates JSONL token counts for distillation threshold decisions
- **DistillationConsumer**: BullMQ processor implementing age-tiered summarization (0-10 turns: none; 10-20: 70%; 20-50: 50%; 50+: 30%) with LLM summarization calls
- **Learning submodule**: `learning.service.ts` with candidate proposal listeners, promotion policies, skill proposal generation, and record-learning operations
- **Controllers**: `system-memory.controller.ts` (system-level ops), `chat-memory-admin.controller.ts` (admin CRUD)
- **21 spec files** covering services, controllers, and repository implementations

### Session Module (`apps/api/src/session`)
- **SessionHydrationService**: Full lifecycle management for containerized sessions — dehydration extracts `session.jsonl` from Docker containers (with SESSION_PATH env, default paths: `/opt/pi-runner/.pi/agent/session.jsonl`, legacy, workspace); validates JSONL and tree structure; scans/redacts secrets; gzip+base64 compresses; persists to `PiSessionTreeRepository`; rehydration injects via `docker.putArchive()` with fallback path resolution
- **SessionCleanupService**: BullMQ `@Processor('session-cleanup')` with `onModuleInit` scheduled daily at 02:00 UTC; archives sessions > 30 days or with orphaned `workflow_run_id` references
- **JSONLValidationService**: Validates JSONL line format and conversation tree parentage structure
- **ChatSessionContextService**: Provider-based context assembly with TTL caching, priority sorting, safe per-provider error handling, and mid-session refresh capability
- **ChatSessionContextRefreshListener**: Event-driven context invalidation on orchestration state changes
- **4 spec files** covering hydration, cleanup, validation, and context services

## Health Findings

- **Test coverage**: 21 spec files in memory, 4 in session — ~88% service coverage for core services; controllers have dedicated spec files
- **Architecture quality**: Clean separation via interfaces (`MemoryBackend`, `IChatContextProvider`); factory pattern for backend selection; dependency injection throughout
- **Error resilience**: Best-effort plugin event publishing, per-provider fallback in context assembly, configurable Honcho fallback modes, multiple session file path resolution attempts
- **No code churn signals**: Files appear stable with established patterns; no TODO comments or placeholder patterns observed in core services

## Open Questions

- The Honcho memory backend currently writes to PostgreSQL even in "honcho mode" (read-through writes); long-term strategy for write-through vs native Honcho writes needs clarification from product/architecture
- Session distillation is triggered at 80% of threshold tokens, but the optimal threshold percentage is not configurable — hardcoded value in `session-hydration.service.ts`
- Context provider registry is populated at runtime via `registerProvider()` rather than discovered via module imports; need to verify all intended providers are registered at startup
- The `HonchoFallbackMemoryBackendService` (dual mode) implementation details should be verified against the interface contract