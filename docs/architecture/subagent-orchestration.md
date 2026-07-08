# Subagent Orchestration (As Implemented)

Last verified: 2026-04-04

> **Note (2026-06-25):** The thin `SubagentOrchestratorService` facade was restored at `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.service.ts`. See [ADR-0003](./adr/ADR-0003-restore-subagent-orchestrator-facade.md).

This document describes the current, code-verified behavior of subagent orchestration in Nexus, including what works, what is partially wired, and what is currently missing.

## Core Components

1. `SubagentOrchestratorService` (`apps/api/src/workflow/workflow-subagents/subagent-orchestrator.service.ts`) — public facade
   - Spawns subagent containers.
   - Tracks executions in `subagent_executions`.
   - Supports both sync (`spawnSubagent`) and async (`spawnSubagentAsync`) paths.
   - Supports `waitForSubagents` polling.
   - Enforces maximum depth of 3.

   Component layering (post-M2 / ADR-0003):

   - **Public facade**: `SubagentOrchestratorService` is the single
     NestJS-injectable entry point that re-exposes the combined
     subagent surface as typed methods. It owns no behaviour of its
     own and is intentionally thin.
   - **Inner services** (sitting beneath the facade):
     - `SubagentProvisioningService`
       (`subagent-provisioning.service.ts`) owns the spawn flow:
       depth/profile validation, skill mount resolution,
       runner-config staging, and container provisioning. The
       facade delegates `spawn` here.
     - `SubagentCoordinationService`
       (`subagent-coordination.service.ts`) owns runtime
       coordination: waiting, status queries, cancellation, and
       completion handling. The facade delegates
       `waitForSubagents`, `checkStatus`, `cancelExecution`,
       `cancelActiveForParent`, and `handleCompletion` here.
   - **Pure-function operation files** (carrying the actual logic
     in side-effect-free modules, exercised by the inner services):
     - `subagent-orchestrator.spawn.operations.ts`
     - `subagent-orchestrator.runtime.operations.ts`
     - `subagent-orchestrator.coordination.operations.ts`
     - `subagent-orchestrator.container-config.operations.ts`
     - `subagent-orchestrator.kickoff-execution.operations.ts`
   - **Cross-cutting primitive**:
     - `SubagentParentLockService`
       (`subagent-parent-lock.service.ts`) owns per-parent-container
       mutual exclusion and is consumed by the inner services
       directly (not through the facade).

   Historical context (preserved as a record): the
   `SubagentOrchestratorService` referenced at the old path
   `apps/api/src/workflow/subagent-orchestrator.service.ts` grew
   into a 16-dependency god class that mixed provisioning,
   coordination, locking, and lifecycle tracking in one constructor.
   The 2026-04-04 refactor split that class into the inner services
   and operation files above, and ADR-0003 (2026-06-25) restored a
   thin facade to give consumers a single import surface.

2. WebSocket handlers (`apps/api/src/telemetry/telemetry.gateway.ts`)
   - Handles socket events: `spawn_subagent`, `spawn_subagent_async`, `wait_for_subagents`.
   - On `turn_end`, calls subagent completion handling when JWT marks socket as subagent.

3. Runner bridge tools (`packages/pi-runner/src/nexus-bridge-tools.ts`)
   - Provides `nexus_orchestrator` custom tool with action `spawn_subagent` (plus non-subagent actions).
   - Provides `ask_user_questions` custom tool via `createAskUserQuestionsTool`.

4. Persistence
   - `subagent_executions` entity/repository track status, depth, parent/child container IDs, result, and optional `assigned_files`.

## Execution Modes

### 1) Synchronous Delegation (`spawn_subagent`)

Flow:

1. Parent emits `spawn_subagent` over gateway.
2. Parent session is dehydrated.
3. Subagent execution record is created.
4. Child container is provisioned and run.
5. On child `turn_end`, gateway marks subagent complete.
6. Child is stopped/removed.
7. Parent session tree is resumed with a system node containing subagent result.

Behavioral effect:

- Parent does not continue concurrently; it is paused/dehydrated during child execution.

### 2) Asynchronous Delegation (`spawn_subagent_async` + `wait_for_subagents`)

Backend service support exists:

- `spawnSubagentAsync` does not dehydrate parent and can run multiple child executions concurrently.
- Concurrency limit is enforced by system setting `max_concurrent_subagents_per_workflow` (default 3).
- Optional `assigned_files` overlap check prevents file collisions with active subagents.
- `waitForSubagents` polls until all active subagents for the parent container complete (or timeout).

Important current caveat:

- End-to-end tool wiring from model tool calls to these async socket events is incomplete (see Known Gaps).

## What Subagents Can Do Today

1. Run in their own container with independent session state.
2. Emit telemetry and complete via `turn_end`.
3. Return structured result payload persisted on execution row.
4. Potentially spawn nested subagents (depth-capped).
5. Ask user questions from runner tool layer (`ask_user_questions` exists).

## Known Gaps and Limitations

1. Tool wiring mismatch between catalog and runner bridge
   - Runner bridge supports `nexus_orchestrator(action: spawn_subagent, ...)`.
   - It does not expose `spawn_subagent_async` or `wait_for_subagents` actions.
   - Catalog contains `spawn_subagent_async` and `wait_for_subagents`, but bridge does not map them.

2. `check_subagent_status` is declared but not wired
   - Tool exists in catalog/profile definitions but no gateway handler or orchestration implementation path consumes it.

3. `wait_for_subagents` schema and handler are inconsistent
   - Schema advertises `execution_ids` and `timeout_seconds`.
   - Gateway handler ignores payload and waits on all active subagents for parent container with fixed service timeout.

4. Subagent `tools` parameter is currently ignored in orchestrator provisioning
   - `tools` is accepted in spawn payload but not used to filter/mount a toolset in subagent provisioning.

5. No direct inter-agent messaging channel
   - Parent and subagents do not have real-time peer messaging primitives.
   - Coordination is indirect via DB status/results and shared filesystem.

6. Team-style coordination is limited
   - Concurrent subagents are independent workers.
   - No shared task graph runtime, leader election, lock manager, or conflict-resolution protocol.

7. Coordination safety is partial
   - `assigned_files` overlap protection only applies when provided.
   - No mandatory path partitioning or centralized lock enforcement.

8. Question flow integration has gaps
   - Runner emits `user_questions_posed` and blocks for `question_response`.
   - Gateway command path supports sending `question_response`.
   - A dedicated gateway ingest path for `user_questions_posed` events is not currently present.

9. Runtime authorization boundaries are not fully enforced for bridge tools
   - Bridge custom tools are injected runner-side, independent of mounted tool allowlist filtering.
   - This creates potential divergence between profile `allowed_tools` intent and runtime exposure.

## Direct Answers to Common Questions

1. Can agents communicate with each other?
   - Not directly. There is no native agent-to-agent messaging API.
   - Communication is indirect via persisted result handoff, parent resume context, and shared filesystem side effects.

2. Can the parent continue while the subagent works?
   - With synchronous `spawn_subagent`: no (parent is dehydrated).
   - Async primitives exist in backend (`spawn_subagent_async`), but end-to-end tool exposure is incomplete.

3. Can the parent wait for subagent completion?
   - Yes, service-level support exists (`waitForSubagents`).

4. Can it do both continue and wait?
   - Intended architecture supports both (async spawn + explicit wait).
   - In current fully wired path, sync spawn is the reliable path; async/wait path needs tool wiring completion.

5. Can subagents ask questions and use tools?
   - Tool usage: yes, but with caveats on what is truly wired and authorized at runtime.
   - Asking questions: runner tool exists and blocks waiting for response; integration is partially wired and needs completion for robust UX.

6. Can subagent profile be selected from user-created profiles?
   - Yes. Spawn accepts `agent_profile` string and resolves settings via AI profile repository.
   - So it can reference seeded profiles and admin-created profiles stored in DB.

7. Can a parent execute more than one subagent at once?
   - Service-level: yes, via async spawn with configurable concurrency limit.

8. If multiple subagents run, do they work as a team or separately?
   - Separately. They are independent executions; there is no native cooperative protocol.

9. Can multiple concurrent agents coordinate memory/progress/avoid collisions automatically?
   - Not comprehensively.
   - Current safeguards are status tracking plus optional `assigned_files` overlap checks.
   - No shared transactional memory, lock service, or cross-agent progress protocol.

## Implementation Roadmap (Recommended)

### Phase 1: Wiring Completeness (High Priority)

1. Add runner bridge actions for:
   - `spawn_subagent_async`
   - `wait_for_subagents`
   - `check_subagent_status`
2. Make gateway handlers consume and validate payloads (including `execution_ids`, `timeout_seconds`).
3. Ensure tool catalog `api_callback` metadata is valid and typed (object, not boolean sentinel).

### Phase 2: Permission and Safety Hardening

1. Enforce profile/tool allowlists for bridge custom tools at runtime.
2. Apply spawn-time `tools` allowlist to subagent runtime exposure.
3. Add required `assigned_files` policy for async multi-subagent runs.
4. Add global file-lock service (optimistic lock + timeout + diagnostics).

### Phase 3: Inter-Agent Coordination Features

1. Add explicit message bus primitives:
   - `send_agent_message(execution_id, payload)`
   - `broadcast_agent_update(channel, payload)`
2. Add shared ephemeral coordination store for task state/leases.
3. Add parent orchestration state machine with subagent heartbeats/progress updates.

### Phase 4: UX and Observability

1. Add full gateway support for `user_questions_posed` ingestion and replay.
2. Add first-class UI timeline for subagent spawn/wait/status/result events.
3. Expose per-subagent progress, step output snippets, and failure reason normalization.

## Suggested Additional Useful Functionality

1. Retry policies for failed subagents with bounded backoff.
2. Automatic conflict detection using file diff overlap and git index locks.
3. Cost/time budget-aware scheduler for subagent dispatch.
4. Subagent result validation hooks (schema + acceptance checks) before parent resume.
5. Cancellation propagation (parent abort cancels all active children deterministically).
