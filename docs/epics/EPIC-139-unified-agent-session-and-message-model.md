# EPIC-139: Unified Agent Session and Message Model

Status: Proposed

## Context & Problem Statement

Currently, agent session data and conversation history are fragmented across multiple tables and inconsistent linking mechanisms in the Nexus Orchestrator.

### Current Table Fragmentation

1. **`chat_sessions`**: Metadata for ad-hoc agent chats (e.g., via Telegram or Web UI).
2. **`pi_session_trees`**: Stores the "source of truth" for agent conversation history as compressed JSONL blobs (`jsonl_data`). Used for session hydration/dehydration.
3. **`workflow_runs`**: Orchestration metadata. Sessions are often linked via `state_variables` JSONB or implicit `pi_session_trees.workflow_run_id` links, but there is no first-class `session_id` on the run.
4. **Fragmented Message Tables**:
   - `chat_messages`: Individual rows for `chat_sessions`.
   - `inception_chat_messages`: Messages for project inception flows.
   - `agent_communication_messages`: Peer-to-peer agent communication.
   - `agent_war_room_messages`: Multi-agent collaboration in a "War Room".

### Issues

- **Observability**: Querying "all agent activity for Project X" requires complex joins and unions across 5+ tables.
- **Data Opaque**: The most detailed history (tool calls, internal thoughts) is trapped in compressed JSONL blobs in `pi_session_trees`.
- **Inconsistent Linking**: Orchestration runs don't consistently create a "Session" entity, making it hard to track long-running agent threads that span multiple runs or re-implementations.

## Desired End State

A unified, queryable, and consistent model for all agent activities.

1. **Unified `AgentSession`**: The existing `chat_sessions` table is evolved into `agent_sessions` (or treated as the canonical session table) with a `source` column (`ad-hoc | workflow | subagent | inception`).
2. **Universal Persistence of JSONL**: **CRITICAL MANDATE**: Every agent activity, regardless of source (workflow, ad-hoc chat, subagent, or inception), MUST persist its full conversation history as a compressed JSONL blob in `pi_session_trees`. This remains the "source of truth" for session hydration and agent state.
3. **First-Class Linking**: `WorkflowRun` and `WorkItem` have direct, explicit foreign keys to `AgentSession`.
4. **Queryable Message Read-Model**: A unified `AgentMessage` table (or generalized `chat_messages`) that is automatically populated by `SessionHydrationService` whenever a JSONL blob is saved. This provides a SQL-queryable timeline of all agent thoughts and tool calls.
5. **Unified API**: A single set of services/controllers to list and retrieve session history regardless of the source.

## Proposed Architecture

### 1. Entity Updates

#### `AgentSession` (Generalized `ChatSession`)

- Rename `chat_sessions` to `agent_sessions` (or keep name but expand usage).
- Ensure `workflow_run_id` and `project_id` are consistently populated.
- Add `parent_session_id` for subagent/branched threads.

#### `AgentMessage` (Unified Message Model)

- A single table to store messages from all sources.
- Columns: `session_id`, `role` (user/agent/system), `content`, `message_kind` (text/tool_call/thought), `metadata` (JSONB).
- Replace `chat_messages`, `inception_chat_messages`, etc., with views or migrate them entirely.

#### `WorkflowRun`

- Add `current_session_id` UUID column.

### 2. Service Updates

- **`SessionHydrationService`**: When `extractAndPersistSession` is called, it should:
  1. **ALWAYS** save/update the `PiSessionTree` (JSONL blob).
  2. Save/Update the `AgentSession` record.
  3. "Shred" the JSONL nodes into `AgentMessage` rows (the "Read Model").
- **`StepAgentStepExecutorService`**: Always create an `AgentSession` before starting a container for a workflow job.

## Migration Plan

### Phase 1: Foundation (Non-Breaking)

1. Add `current_session_id` to `workflow_runs`.
2. Ensure `chat_sessions` (to be `agent_sessions`) has all necessary columns for orchestration (tier, container_id, etc. - mostly already there).
3. Create a new `AgentMessage` entity (or expand `ChatMessage`).

### Phase 2: Implementation (Read-Side)

1. Update `SessionHydrationService` to sync JSONL nodes to `AgentMessage` rows.
2. Backfill: A one-time script to decompress existing `pi_session_trees` and shred them into `AgentMessage`.

### Phase 3: Implementation (Write-Side)

1. Update `StepAgentStepExecutorService` to create/link an `AgentSession` record whenever an agent is spawned.
2. Update `WorkItem` logic to store `last_session_id`.

### Phase 4: Consolidation & Cleanup

1. Deprecate `inception_chat_messages`, `agent_communication_messages`, etc.
2. Migrate existing records to `AgentMessage`.
3. Drop redundant columns from `pi_session_trees` (like `workflow_run_id` and `chat_session_id` once the session entity handles the linking).

## Concrete Tasks

- [ ] Create Database Migration for `workflow_runs.current_session_id` and generic session columns.
- [ ] Implement `AgentMessage` entity and repository.
- [ ] Update `SessionHydrationService` to "shred" JSONL into `AgentMessage` rows.
- [ ] Update `StepAgentStepExecutorService` to initialize `AgentSession` for every job.
- [ ] Implement `SessionHistoryService` to provide a unified view of all sessions per project.
- [ ] Backfill existing `pi_session_trees` to `AgentMessage`.
- [ ] Extend backfill and runtime writes from legacy war-room, mesh, and inception message sources into `AgentMessage`.
- [ ] Update Frontend to use the new unified session endpoints.

## Definition of Done

- [ ] A single SQL query can retrieve a chronological list of ALL agent messages (thoughts, tool calls, and text) for a given Project.
- [ ] Every `WorkflowRun` that spawns an agent has a linked `AgentSession` record.
- [ ] The `pi_session_trees` JSONL blob is still used for hydration but is no longer the ONLY way to read agent history.
- [ ] All automated tests (unit and E2E) pass with the new unified model.
- [ ] No regression in agent hydration/dehydration performance.

## References

- `docs/architecture/session-hydration.md`
- `apps/api/src/database/entities/chat-session.entity.ts`
- `apps/api/src/session/session-hydration.service.ts`
- `apps/api/src/workflow/step-agent-step-executor.service.ts`
