---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: repair-agent
outcome: success
inferred_status: implemented
confidence_score: 0.90
evidence_refs:
  - apps/repair-agent/src/repair-agent.ts (main entry point)
  - apps/repair-agent/src/worker/pool.ts (worker pool with concurrency control)
  - apps/repair-agent/src/worker/repair-job.ts (opencode execution and parsing)
  - apps/repair-agent/src/db/repair-tracker.ts (session persistence)
  - apps/repair-agent/src/api/server.ts (HTTP API)
  - apps/repair-agent/tests/ (5 test files with good coverage)
source_paths:
  - apps/repair-agent/src
updated_at: 2026-06-02T14:30:00Z
---

# Probe Result: Autonomous Repair Agent

## Narrative Summary

The repair agent is a standalone Node.js service that monitors the Nexus Orchestrator for error telemetry events, creates repair sessions in PostgreSQL, and autonomously fixes errors by spawning opencode agents. The agent processes errors through a deduplication layer (SHA-256 hash of error code + message), spawns configurable worker pools to run opencode with tailored prompts, commits fixes to git, pushes to remote, and optionally rebuilds Docker images. A lightweight HTTP API exposes session status, history queries, and repair log updates for external monitoring.

## Capability Updates

| Capability | Status | Implementation |
|------------|--------|----------------|
| Telemetry event subscription | Implemented | Socket.IO client in `telemetry-client.ts` connects to `TELEMETRY_URL`, subscribes to error/critical severity events |
| Error deduplication | Implemented | SHA-256 hash of `{errorCode}:{errorMessage}` truncated to 16 chars; 24-hour lookback window in `getDedupHistory()` |
| Repair session lifecycle | Implemented | TypeORM entity `RepairSession` with states: pending → running → success/failed/cancelled; managed via `RepairTracker` |
| Worker pool concurrency | Implemented | `RepairPool` manages N workers (configurable via `REPAIR_MAX_WORKERS`); FIFO queue with drain logic |
| opencode agent execution | Implemented | `RepairJob.runOpencode()` spawns subprocess with configurable model, agent profile, system prompt, working dir; 30min default timeout |
| Git commit/push workflow | Implemented | Token injected via `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0` env vars; opencode output parsed for `commit_hash`, `commit_pushed` markers |
| Docker rebuild integration | Implemented | opencode output parsed for `docker_rebuild_success`, `docker_images` markers; results stored in session |
| HTTP API for tool integrations | Implemented | `RepairAgentAPI` exposes: `POST /api/repair/update`, `GET /api/repair/session/:id`, `GET /api/repair/history`, `GET /health` |
| Configuration via env vars | Implemented | 13 configuration options with sensible defaults; documented in README.md |
| Graceful shutdown | Implemented | SIGINT/SIGTERM handlers stop pool, disconnect telemetry, close API, close DB |

## Health Findings

| Metric | Status | Notes |
|--------|--------|-------|
| Test coverage | Good | 5 test files covering `pool.test.ts`, `repair-job.test.ts`, `repair-tracker.test.ts`, `handlers.test.ts`, `error-event-parser.test.ts` |
| Test framework | Vitest | Configured with TypeScript via SWC; 15s timeout per test |
| Code quality | Clean | No TODO/FIXME/HACK comments found; consistent logging via `Logger` class |
| Separation of concerns | Good | `connection/` (telemetry), `db/` (persistence), `worker/` (execution), `api/` (HTTP), `shared/` (logging) |
| Error handling | Present | `RepairJob` catches subprocess errors, marks session failed; graceful timeout handling |
| Type safety | Strong | `RepairAgentConfig`, `TelemetryEvent`, `UpdateRepairLogParams`, and entity types fully typed |

## Open Questions

- The opencode binary (`OPencode_PATH`) must be available in the execution environment — no bundled fallback or validation
- Docker rebuild depends on `docker compose` being available; no validation or error message if unavailable
- Git push requires `GITHUB_TOKEN`/`GH_TOKEN`/`GIT_TOKEN` env vars — service fails without them if repairs succeed but push fails
- Telemetry WebSocket reconnection is configured with `reconnectionAttempts: Infinity` — long-term behavior under persistent connection failures is undefined
- The `RepairAgentAPI` does not authenticate requests; any client can update repair logs or query sessions

## Architecture Summary

```
┌──────────────────────────────────────────────────────────────┐
│                      repair-agent.ts                         │
│  Orchestrates: DB connect → Telemetry connect → Pool start   │
└───────────────────────┬──────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┬───────────────┐
        ▼               ▼               ▼               ▼
   ┌─────────┐    ┌──────────┐    ┌─────────┐    ┌──────────┐
   │Telemetry│    │RepairPool│    │   API   │    │   DB     │
   │ Client  │    │ Workers  │    │ Server  │    │ Tracker  │
   └────┬────┘    └────┬─────┘    └────┬────┘    └────┬─────┘
        │             │                │              │
   Socket.IO       RepairJob      HTTP routes     TypeORM
   events         opencode       /api/repair     Repositories
```

## Key Files

| File | Role |
|------|------|
| `src/repair-agent.ts` | Main entry, initializes all components, handles shutdown signals |
| `src/worker/pool.ts` | Worker pool with queue management and deduplication check |
| `src/worker/repair-job.ts` | opencode subprocess spawning, prompt construction, output parsing |
| `src/db/repair-tracker.ts` | Repository pattern for repair session CRUD |
| `src/db/entities/repair-session.entity.ts` | TypeORM entity with indexes on `status`, `dedupKey`, `createdAt` |
| `src/connection/telemetry-client.ts` | Socket.IO client with auto-reconnect |
| `src/api/server.ts` | Lightweight HTTP server for tool integrations |