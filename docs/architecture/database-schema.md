# Database Schema (Conceptual)

This document is a high-level architecture reference for major persistence domains.

For exact runtime truth, use:

- `apps/api/src/database/entities/`
- `apps/api/src/database/migrations/`
- `apps/kanban/src/database/entities/`

## 1. Workflow and Execution Domain

Primary tables:

- `workflows` - Workflow definitions
- `workflow_runs` - Workflow execution instances
- `workflow_events` - Event timeline for runs
- `workflow_run_todos` - Todo list items for runs
- `subagent_executions` - Subagent execution records
- `pi_session_trees` - Agent session continuity

Purpose:

- Store workflow definitions, run state, event timelines, and session/subagent continuity artifacts
- Track todo items and execution state
- Maintain subagent execution history

## 2. Project and Kanban Domain

Primary tables:

- `projects` - Project definitions
- `work_items` - Kanban work items
- `work_item_dependencies` - Dependencies between work items
- `work_item_subtasks` - Subtasks for work items
- `project_orchestrations` - Orchestration state
- `project_orchestration_action_requests` - Pending actions
- `project_agent_capacities` - Per-agent capacity limits

### Project Agent Capacities (EPIC-056)

Table: `project_agent_capacities`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Unique identifier |
| `project_id` | uuid (FK → projects.id) | Parent project |
| `agent_profile_id` | varchar | Agent profile name |
| `max_active_items` | integer | Maximum concurrent items |
| `is_enabled` | boolean | Whether capacity limit is active |
| `created_at`, `updated_at` | timestamptz | Timestamps |

Constraint: `UNIQUE (project_id, agent_profile_id)`

Used by dispatch reconciliation and assignment paths.

## 3. Project Goals Domain (EPIC-059)

Primary tables:

- `project_goals` - High-level project objectives
- `project_goal_worklogs` - Worklog entries linked to goals

### project_goals

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Unique identifier |
| `project_id` | uuid (FK → projects.id) | Parent project |
| `title` | varchar | Goal title |
| `description` | text (nullable) | Detailed description |
| `status` | varchar | Current status |
| `moscow` | varchar (nullable) | MoSCoW priority |
| `priority` | varchar (nullable) | Priority level |
| `sort_order` | integer | Display order |
| `target_date` | timestamptz (nullable) | Target completion |
| `completed_at` | timestamptz (nullable) | Completion timestamp |
| `owner_agent_profile_id` | uuid (nullable FK → agent_profiles.id) | Owner |
| `metadata` | jsonb (nullable) | Additional data |
| `is_archived` | boolean | Archive status |
| `created_at`, `updated_at` | timestamptz | Timestamps |

### project_goal_worklogs

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Unique identifier |
| `goal_id` | uuid (FK → project_goals.id) | Parent goal |
| `project_id` | uuid (FK → projects.id) | Parent project |
| `work_item_id` | uuid (nullable FK → work_items.id) | Linked work item |
| `entry_type` | varchar | Type of entry |
| `author_type` | varchar | Type of author |
| `author_id` | varchar (nullable) | Author identifier |
| `author_name` | varchar (nullable) | Author name |
| `note` | text | Worklog note |
| `linked_run_id` | varchar (nullable) | Linked workflow run |
| `metadata` | jsonb (nullable) | Additional data |
| `created_at`, `updated_at` | timestamptz | Timestamps |

## 4. AI Configuration and Skills Domain (EPIC-057)

Primary tables:

- `llm_providers` - LLM provider configurations
- `llm_models` - Available models per provider
- `agent_profiles` - Agent configurations
- `secret_store` - Encrypted secrets
- `agent_skills` - Reusable skill definitions
- `agent_profile_skills` - Skill assignments to profiles

### agent_skills

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Unique identifier |
| `name` | varchar (unique) | Skill name |
| `description` | varchar | Skill description |
| `skill_markdown` | text | Skill documentation/content |
| `compatibility` | varchar (nullable) | Compatibility notes |
| `metadata` | jsonb (nullable) | Additional data |
| `source` | varchar | Skill source |
| `created_by_profile` | varchar (nullable) | Creator profile |
| `created_by_workflow_run_id` | varchar (nullable) | Creating workflow run |
| `version` | integer | Version number |
| `is_active` | boolean | Active status |
| `created_at`, `updated_at` | timestamptz | Timestamps |

### agent_profile_skills

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Unique identifier |
| `agent_profile_id` | uuid (FK → agent_profiles.id) | Parent profile |
| `skill_id` | uuid (FK → agent_skills.id) | Assigned skill |
| `assignment_order` | integer | Display/priority order |
| `created_at`, `updated_at` | timestamptz | Timestamps |

Constraint: `UNIQUE (agent_profile_id, skill_id)`

## 5. Agent Communication Mesh Domain (EPIC-054)

Primary tables:

- `agent_communication_threads` - Communication threads
- `agent_communication_messages` - Messages within threads

Purpose:

- Persist mention threads, participants, responses, and lifecycle state for peer assistance flows

## 6. Settings and Control Domain

Primary tables:

- `system_settings` - Global system settings
- `setup_config` - Initial setup configuration

Dispatch and pre-flight settings include keys such as:

- `work_item_preflight_pipeline_enabled`
- `work_item_preflight_required`
- `work_item_scheduler_enabled`
- `work_item_dispatch_polling_enabled`
- `work_item_dispatch_poll_interval_seconds`
- `work_item_dispatch_poll_batch_size`

## 7. Restart Continuity Note (EPIC-058)

EPIC-058 core behavior is primarily event/prompt-state driven.

- Restart context fields `isRestart` and `stateSummary` are carried in orchestration-start event payloads and workflow inputs
- No new dedicated database table is required for those fields; continuity builds on existing project/orchestration/work-item/session data

## 8. Automation and Scheduling Domain (EPIC-078, EPIC-079)

Primary tables:

- `scheduled_jobs` - Scheduled workflow executions
- `scheduled_job_runs` - Individual job run instances
- `automation_hooks` - Event-triggered automation rules
- `heartbeat_profiles` - Heartbeat monitoring configurations
- `heartbeat_runs` - Heartbeat execution records
- `standing_orders` - Persistent project directives

### scheduled_jobs

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Unique identifier |
| `project_id` | uuid (FK → projects.id) | Parent project |
| `name` | varchar(180) | Job name |
| `status` | enum | `active`, `paused` |
| `schedule_type` | enum | `one_time`, `interval`, `cron` |
| `schedule_expression` | text | Schedule definition |
| `timezone` | varchar(128) (nullable) | Timezone |
| `next_run_at` | timestamptz (nullable) | Next execution |
| `execution_target_type` | enum | `workflow` |
| `execution_target_ref` | uuid | Target workflow ID |
| `payload_json` | jsonb | Execution payload |
| `created_by`, `updated_by` | varchar(255) (nullable) | User tracking |
| `paused_at` | timestamptz (nullable) | Pause timestamp |
| `created_at`, `updated_at` | timestamptz | Timestamps |

Indexes: `(project_id, status, next_run_at)`, `(status, next_run_at)`

### automation_hooks

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Unique identifier |
| `project_id` | uuid (FK → projects.id) | Parent project |
| `enabled` | boolean | Active status |
| `trigger_type` | enum | Event type that triggers hook |
| `trigger_filter` | jsonb (nullable) | Filter criteria |
| `priority` | int | Execution priority |
| `action_type` | enum | Action to perform |
| `action_payload` | jsonb | Action parameters |
| `cooldown_window_seconds` | int | Minimum time between triggers |
| `last_fired_at` | timestamptz (nullable) | Last execution |
| `created_by`, `updated_by` | varchar (nullable) | User tracking |
| `created_at`, `updated_at` | timestamptz | Timestamps |

Indexes: `(project_id, trigger_type)`, `(project_id, enabled, priority)`

### heartbeat_profiles

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Unique identifier |
| `project_id` | uuid (FK → projects.id) | Parent project |
| `name` | varchar(180) | Profile name |
| `enabled` | boolean | Active status |
| `interval_seconds` | int | Heartbeat interval |
| `workflow_id` | uuid | Target workflow |
| `payload_json` | jsonb | Execution payload |
| `next_run_at`, `last_run_at` | timestamptz (nullable) | Schedule tracking |
| `created_by`, `updated_by` | varchar (nullable) | User tracking |
| `created_at`, `updated_at` | timestamptz | Timestamps |

Indexes: `(project_id, enabled, next_run_at)`, `(workflow_id)`

### standing_orders

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Unique identifier |
| `project_id` | uuid (FK → projects.id) | Parent project |
| `title` | varchar(180) | Order title |
| `instruction` | text | Directive content |
| `profile_name` | varchar(120) (nullable) | Target agent profile |
| `enabled` | boolean | Active status |
| `priority` | int | Priority level |
| `override_policy` | enum | `advisory`, `allow_override`, `deny_override` |
| `created_by`, `updated_by` | varchar (nullable) | User tracking |
| `created_at`, `updated_at` | timestamptz | Timestamps |

Indexes: `(project_id, enabled, priority)`, `(project_id, profile_name)`

## 9. Chat Sessions Domain (EPIC-064, EPIC-077)

Primary tables:

- `chat_sessions` - Chat session instances
- `chat_session_participants` - Session participants

### chat_sessions

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Unique identifier |
| `status` | enum | `STARTING`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED` |
| `agent_profile_id` | uuid | Agent profile |
| `agent_profile_name` | varchar(255) | Agent name |
| `project_id` | uuid (nullable) | Associated project |
| `initial_message` | text | Starting message |
| `display_name` | varchar(512) (nullable) | Display name |
| `container_id` | varchar(128) (nullable) | Runtime container |
| `container_tier` | smallint | Container tier (default: 2) |
| `provider` | varchar(64) (nullable) | LLM provider |
| `model` | varchar(128) (nullable) | Model name |
| `system_prompt` | text (nullable) | System prompt |
| `session_tree_id` | uuid (nullable) | Session tree root |
| `workflow_run_id` | uuid (nullable) | Linked workflow run |
| `error_message` | text (nullable) | Error details |
| `source` | varchar(64) | `ad-hoc`, `workflow`, `subagent` |
| `session_type` | varchar(20) | `general` | `steering` |
| `completed_at` | timestamptz (nullable) | Completion time |
| `created_at`, `updated_at` | timestamptz | Timestamps |

### chat_session_participants

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Unique identifier |
| `chat_session_id` | string (FK → chat_sessions.id) | Parent session |
| `agent_profile` | string | Agent profile name |
| `role` | enum | `owner`, `participant`, `moderator` |
| `participation_status` | enum | `invited`, `active`, `declined`, `left`, `removed`, `default invited` |
| `invited_by` | varchar (nullable) | Inviter |
| `joined_at`, `left_at` | timestamptz (nullable) | Timestamps |
| `metadata` | jsonb (nullable) | Additional data |
| `created_at`, `updated_at` | timestamptz | Timestamps |

Constraint: `UNIQUE (chat_session_id, agent_profile)`

## 10. War Room Domain

Primary tables:

- `agent_war_room_sessions` - War room sessions
- `agent_war_room_participants` - Session participants
- `agent_war_room_messages` - Session messages
- `agent_war_room_blackboards` - Shared state versions
- `agent_war_room_signoffs` - Participant sign-offs

### agent_war_room_sessions

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Unique identifier |
| `session_id` | string (unique) | Human-readable session ID |
| `project_id` | varchar (nullable) | Associated project |
| `workflow_run_id` | string | Parent workflow run |
| `work_item_id` | varchar (nullable) | Associated work item |
| `status` | enum | `open`, `closed` |
| `consensus_state` | enum | `collecting_input`, `draft_ready`, `partial_signoff`, `consensus_reached`, `deadlocked`, `ceo_tie_break_applied` |
| `created_by_execution_id` | varchar (nullable) | Creating agent execution |
| `moderator_profile` | string | Default: `ceo-agent` |
| `resolution_type` | enum (nullable) | `consensus`, `deadlock`, `ceo_tie_break`, `manual` |
| `resolution_note` | text (nullable) | Resolution explanation |
| `metadata` | jsonb (nullable) | Additional data |
| `opened_at`, `closed_at` | timestamptz | Timestamps |

Index: `(project_id, workflow_run_id)`

## 11. MCP Servers Domain (EPIC-080)

Primary tables:

- `mcp_servers` - MCP server configurations

### mcp_servers

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Unique identifier |
| `name` | varchar(120) (unique) | Server identifier |
| `enabled` | boolean | Active flag (default: true) |
| `transport_type` | enum `McpTransportType` | `stdio`, `http` |
| `command` | text (nullable) | Executable command (stdio only) |
| `args` | jsonb string[] (nullable) | Command arguments (stdio only) |
| `url` | text (nullable) | Server URL (http only) |
| `headers` | jsonb (nullable) | HTTP headers (http only) |
| `include_tools` | jsonb string[] (nullable) | Tool whitelist (empty = all) |
| `exclude_tools` | jsonb string[] (nullable) | Tool blacklist |
| `timeout_ms` | int | Tool invocation timeout (default: 30000) |
| `connect_timeout_ms` | int | Connection timeout (default: 10000) |
| `max_retries` | int | Retry count (default: 2) |
| `retry_backoff_ms` | int | Retry backoff (default: 1000) |
| `last_status` | enum `McpServerStatus` | `unknown`, `connected`, `failed`, `disabled` |
| `last_error` | text (nullable) | Last connection error |
| `last_connected_at`, `last_discovered_at` | timestamptz (nullable) | Last activity |
| `last_discovered_tool_count` | int (nullable) | Tools found |
| `created_at`, `updated_at` | timestamptz | Timestamps |

## 12. Doctor Repair History Domain (EPIC-082)

Primary tables:

- `doctor_repair_history` - Repair action records

### doctor_repair_history

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Unique identifier |
| `action_id` | varchar(120) | Action identifier |
| `status` | varchar(32) | `pending`, `running`, `succeeded`, `failed` |
| `dry_run` | boolean | Test mode flag |
| `requested_by` | varchar(255) (nullable) | Requestor |
| `input_json` | jsonb (nullable) | Input parameters |
| `result_json` | jsonb (nullable) | Result data |
| `evidence_json` | jsonb (nullable) | Supporting evidence |
| `error_message` | text (nullable) | Error details |
| `started_at` | timestamptz | Start time |
| `finished_at` | timestamptz (nullable) | Completion time |
| `created_at`, `updated_at` | timestamptz | Timestamps |

Indexes: `(action_id)`, `(status)`, `(started_at)`

## 13. Workflow Run Extensions

### workflow_run_todos

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Unique identifier |
| `workflowRunId` | string (FK → workflow_runs.id CASCADE) | Parent workflow run |
| `projectId` | uuid (nullable) | Associated project |
| `workItemId` | uuid (nullable) | Associated work item |
| `title` | varchar(500) | Todo title |
| `status` | varchar(32) | `not-started`, `in-progress`, `completed`, `skipped` |
| `orderIndex` | int | Display order |
| `sourceSubtaskId` | varchar(255) (nullable) | Source subtask |
| `sourceKind` | varchar(32) | `manual`, `subtask`, `spec` |
| `isArchived` | boolean | Archive status |
| `metadata` | jsonb (nullable) | Additional data |
| `createdAt`, `updatedAt` | timestamptz | Timestamps |

Unique: `(workflowRunId, sourceSubtaskId)` WHERE `sourceSubtaskId` IS NOT NULL

### work_item_subtasks

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | Unique identifier |
| `projectId` | string | Parent project |
| `workItemId` | string (FK → work_items.id CASCADE) | Parent work item |
| `subtaskId` | varchar(255) | Subtask identifier |
| `title` | varchar(500) | Subtask title |
| `status` | varchar(32) | `todo`, `in-progress`, `done`, `skipped` |
| `orderIndex` | int | Display order |
| `dependsOnSubtaskIds` | jsonb string[] (nullable) | Dependencies |
| `sourcePath` | text | Source file path |
| `sourceHash` | varchar(64) | Content hash |
| `sourceLastSyncedAt` | timestamptz (nullable) | Last sync |
| `isArchived` | boolean | Archive status |
| `metadata` | jsonb (nullable) | Additional data |
| `createdAt`, `updatedAt` | timestamptz | Timestamps |

Unique: `(workItemId, subtaskId)`

## 14. Related Docs

- `docs/architecture/rest-api.md` - API endpoint reference
- `docs/architecture/workflow-engine.md` - Workflow execution engine
- `docs/architecture/ARCH-kanban-workflow.md` - Kanban workflow details
- `docs/architecture/project-goals.md` - Goals domain details
- `docs/architecture/agent-skills.md` - Skills management
- `docs/architecture/automation.md` - Automation and scheduling
- `docs/architecture/chat-sessions.md` - Chat session management
- `docs/architecture/operations-doctor.md` - Repair operations
- `docs/architecture/mcp-integration.md` - MCP server integration