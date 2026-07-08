# Chat Memory Lifecycle Runbook

This runbook covers operations for the `apps/api` chat memory lifecycle introduced in EPIC-093.

## Scope

- Session short-term memory ingestion and pruning
- Profile durable memory promotion and consolidation
- Background distillation/consolidation jobs
- Memory lifecycle event emission (`chat.memory.promoted.v1`, `chat.memory.updated.v1`)
- Memory retrieval observability for chat action context assembly

## Runtime Endpoints

All endpoints require internal service auth (`CHAT_SERVICE_BEARER_TOKEN`):

- `GET /api/internal/chat-memory/metrics`
- `GET /api/internal/chat-memory/jobs?limit=20`
- `GET /api/internal/chat-memory/events?limit=20`

## Key Metrics

`GET /api/internal/chat-memory/metrics` returns:

- `distillationSuccess`
- `distillationFailure`
- `promotionVolume`
- `retrievalRequests`
- `retrievalHits`
- `retrievalHitRate`

## Triage Playbook

1. Verify worker loop is active.

- Confirm `CHAT_MEMORY_JOBS_DISABLED` is not `true`.
- Check recent jobs: `GET /api/internal/chat-memory/jobs?limit=50`.

2. Investigate repeated distillation failures.

- Inspect `last_error` and `attempts` in failed jobs.
- Confirm DB connectivity and profile/session linkage values.
- Validate `CHAT_MEMORY_RETRY_DELAY_MS` and `CHAT_MEMORY_JOB_MAX_ATTEMPTS`.

3. Investigate low retrieval hit rate.

- Check `retrievalHitRate` trend.
- Verify session memory pruning is not overly aggressive (`CHAT_MEMORY_MAX_SESSION_ENTRIES`).
- Verify context limits (`CHAT_MEMORY_CONTEXT_TOKEN_BUDGET`, `CHAT_MEMORY_CONTEXT_MAX_SLICES`).

4. Verify event emission.

- Query `GET /api/internal/chat-memory/events?limit=50`.
- Confirm envelopes include `eventVersion: "v1"` and `sourceService: "chat"`.

## Migration Notes

- Chat memory product behavior is owned by `apps/api` chat runtime modules.
- apps/api memory module remains available for non-chat use cases.
- Use chat internal observability endpoints for memory lifecycle diagnostics.

## Context Provider Health (`/health` `context-providers` down)

The `/health` endpoint includes a `context-providers` indicator driven by
`apps/api/src/health/context-provider.health.ts` and
`ChatSessionContextService.assertRegistryNonEmpty()`. It reports
**down** when the chat context provider registry is empty (i.e. the
canonical built-in providers were not registered at `MemoryModule`
bootstrap). The full design is in
[`docs/architecture/memory-management.md`](../architecture/memory-management.md)
("Built-in Context Provider Bootstrap").

### Symptoms

- `GET /health` returns HTTP 503.
- The `context-providers` key is either missing or `status: "down"`
  in the response body.
- Application startup logs do **not** contain a
  `Built-in context provider registration complete: 5 provider(s) registered`
  line.

### Triage

1. Confirm the alert by `curl http://<api-host>/health` and inspect
   the `context-providers` block.
2. If the registry was empty at startup, the application should
   have failed to start. Check the process logs for
   `ChatContextRegistryEmptyError` and a non-zero exit code.
3. If the process is up but the indicator is down, the registry was
   cleared at runtime. The only public method that empties the
   registry is `ChatSessionContextService.clearProvidersForTesting()`
   which is documented as test-only. Search the codebase for that
   method to find the offending caller.
4. Verify `apps/api/src/memory/built-in-context-providers/built-in-memory-context-providers.module.ts`
   still lists all five canonical providers in its `providers` array.
5. Restart the application. Runtime recovery is not supported — a
   chat session that ran with an empty registry has already been
   mis-served, and the only safe action is a restart.
