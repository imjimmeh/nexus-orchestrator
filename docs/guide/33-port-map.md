# 33 — Port Map, Endpoints, and Environment Variables

Complete reference for service ports, REST API endpoints, WebSocket events, BullMQ queues, and environment variables across the Nexus Orchestrator stack.

---

## Service Port Table

### Core Services

| Service          | Container Port | Host Port | Protocol  | Notes                                             |
| ---------------- | -------------- | --------- | --------- | ------------------------------------------------- |
| API HTTP         | 3000           | 3010      | HTTP      | NestJS REST + Swagger at `/docs`                  |
| API WebSocket    | 3001           | 3011      | WebSocket | Socket.IO telemetry + notification gateway        |
| Kanban API       | 3012           | 3012      | HTTP      | Kanban domain REST                                |
| Web UI           | 80             | 3120      | HTTP      | Nginx-served React SPA (Docker)                   |
| Web UI (preview) | —              | 3121      | HTTP      | Vite preview mode (local dev)                     |
| PostgreSQL       | 5432           | 5433      | TCP       | Primary data store (pgvector/pgvector:0.8.3-pg18) |
| Redis            | 6379           | 6380      | TCP       | BullMQ queues, pub-sub, caching                   |
| Agent Local      | 3033           | 3033      | HTTP      | Local MCP service                                 |

### Honcho Profile (add `--profile honcho` to compose)

| Service         | Container Port | Host Port | Protocol | Notes                                     |
| --------------- | -------------- | --------- | -------- | ----------------------------------------- |
| Honcho API      | 8000           | 8030      | HTTP     | Honcho memory backend                     |
| Honcho Postgres | 5432           | 5443      | TCP      | Vector-enabled PostgreSQL (pgvector/pg15) |

---

## API Endpoints Index

All Core API endpoints are prefixed with `/api` (global prefix configured in `main.ts`). Swagger documentation is available at `/docs`.

### Workflows

| Method | Path                               | Controller                     | Purpose                       |
| ------ | ---------------------------------- | ------------------------------ | ----------------------------- |
| GET    | `/api/workflows`                   | `WorkflowController`           | List all workflow definitions |
| POST   | `/api/workflows`                   | `WorkflowController`           | Create a workflow definition  |
| GET    | `/api/workflows/:id`               | `WorkflowController`           | Get a workflow definition     |
| PATCH  | `/api/workflows/:id`               | `WorkflowController`           | Update a workflow definition  |
| DELETE | `/api/workflows/:id`               | `WorkflowController`           | Delete a workflow definition  |
| POST   | `/api/workflows/launch`            | `WorkflowLaunchController`     | Launch a workflow run         |
| POST   | `/api/workflows/:id/launch`        | `WorkflowLaunchController`     | Launch by workflow ID         |
| GET    | `/api/workflows/repository`        | `WorkflowRepositoryController` | Browse workflow repository    |
| GET    | `/api/workflows/lifecycle`         | `WorkflowLifecycleController`  | Lifecycle event definitions   |
| GET    | `/api/workflows/runs`              | `WorkflowRunsController`       | List workflow runs            |
| GET    | `/api/workflows/runs/:runId`       | `WorkflowRunsController`       | Get run detail                |
| PATCH  | `/api/workflows/runs/:runId`       | `WorkflowRunsController`       | Update run (steer, cancel)    |
| GET    | `/api/workflow-runs/:runId/events` | `WorkflowEventLogController`   | Event log for a run           |

### Workflow Runtime

| Method | Path                                           | Controller                                       | Purpose                            |
| ------ | ---------------------------------------------- | ------------------------------------------------ | ---------------------------------- |
| POST   | `/api/workflow-runtime/step-complete`          | `WorkflowRuntimeStepCompleteController`          | Agent reports step completion      |
| POST   | `/api/workflow-runtime/lifecycle`              | `WorkflowRuntimeLifecycleController`             | Agent reports lifecycle transition |
| GET    | `/api/workflow-runtime/artifacts`              | `WorkflowRuntimeArtifactsController`             | List artifacts for a run           |
| POST   | `/api/workflow-runtime/artifacts`              | `WorkflowRuntimeArtifactsController`             | Upload artifact                    |
| POST   | `/api/workflow-runtime/agent-mentions`         | `WorkflowRuntimeAgentMentionsController`         | Agent mention agent                |
| POST   | `/api/workflow-runtime/subagents`              | `WorkflowRuntimeSubagentsController`             | Spawn subagent                     |
| POST   | `/api/workflow-runtime/war-room`               | `WorkflowRuntimeWarRoomController`               | War room operations                |
| POST   | `/api/workflow-runtime/internal-tool-callback` | `WorkflowRuntimeInternalToolCallbacksController` | Internal tool callback             |
| POST   | `/api/workflow-runtime/capability-lifecycle`   | `WorkflowRuntimeCapabilityLifecycleController`   | Capability lifecycle               |

### Chat Sessions

| Method | Path                                   | Controller                           | Purpose               |
| ------ | -------------------------------------- | ------------------------------------ | --------------------- |
| POST   | `/api/sessions/chat`                   | `ChatSessionsController`             | Create chat session   |
| GET    | `/api/sessions/chat/:id`               | `ChatSessionsController`             | Get session           |
| POST   | `/api/sessions/chat/:id/messages`      | `ChatMessagesController`             | Send message          |
| GET    | `/api/sessions/chat/:id/messages`      | `ChatMessagesController`             | Get messages          |
| POST   | `/api/sessions/chat/:id/collaboration` | `ChatSessionCollaborationController` | Collaboration actions |
| GET    | `/api/sessions`                        | `WorkflowAdHocSessionController`     | List ad-hoc sessions  |

### Tools

| Method | Path                               | Controller                           | Purpose                 |
| ------ | ---------------------------------- | ------------------------------------ | ----------------------- |
| GET    | `/api/tools`                       | `ToolController`                     | List available tools    |
| GET    | `/api/tools/:name`                 | `ToolController`                     | Get tool definition     |
| POST   | `/api/tools/:name/execute`         | `ToolController`                     | Execute a tool          |
| POST   | `/api/tool-call-approval-requests` | `ToolCallApprovalRequestsController` | Submit approval request |
| GET    | `/api/tool-approval-rules`         | `ToolApprovalRulesController`        | List approval rules     |
| POST   | `/api/tool-approval-rules`         | `ToolApprovalRulesController`        | Create approval rule    |

### AI Config

| Method | Path                                  | Controller                | Purpose               |
| ------ | ------------------------------------- | ------------------------- | --------------------- |
| GET    | `/api/ai-config`                      | `AiConfigController`      | Get full AI config    |
| GET    | `/api/ai-config/agent-profiles`       | `AgentProfilesController` | List agent profiles   |
| POST   | `/api/ai-config/agent-profiles`       | `AgentProfilesController` | Create agent profile  |
| GET    | `/api/ai-config/agent-profiles/:name` | `AgentProfilesController` | Get profile by name   |
| PATCH  | `/api/ai-config/agent-profiles/:name` | `AgentProfilesController` | Update profile        |
| DELETE | `/api/ai-config/agent-profiles/:name` | `AgentProfilesController` | Delete profile        |
| GET    | `/api/ai-config/skills`               | `AgentSkillsController`   | List skills           |
| POST   | `/api/ai-config/skills`               | `AgentSkillsController`   | Create skill          |
| GET    | `/api/ai-config/providers`            | `ProvidersController`     | List LLM providers    |
| POST   | `/api/ai-config/providers`            | `ProvidersController`     | Create provider       |
| GET    | `/api/ai-config/models`               | `ModelsController`        | List LLM models       |
| POST   | `/api/ai-config/models`               | `ModelsController`        | Create model          |
| GET    | `/api/ai-config/secrets`              | `SecretsController`       | List secrets (masked) |
| POST   | `/api/ai-config/secrets`              | `SecretsController`       | Store a secret        |

### Auth

| Method | Path                 | Controller       | Purpose             |
| ------ | -------------------- | ---------------- | ------------------- |
| POST   | `/api/auth/login`    | `AuthController` | Login (returns JWT) |
| POST   | `/api/auth/refresh`  | `AuthController` | Refresh JWT token   |
| POST   | `/api/auth/logout`   | `AuthController` | Logout              |
| POST   | `/api/auth/register` | `AuthController` | Register new user   |
| GET    | `/api/auth/me`       | `AuthController` | Get current user    |

### Users

| Method | Path                        | Controller             | Purpose         |
| ------ | --------------------------- | ---------------------- | --------------- |
| GET    | `/api/users`                | `UsersController`      | List users      |
| POST   | `/api/users`                | `UsersController`      | Create user     |
| GET    | `/api/users/:id`            | `UsersController`      | Get user        |
| PATCH  | `/api/users/:id`            | `UsersController`      | Update user     |
| DELETE | `/api/users/:id`            | `UsersController`      | Delete user     |
| GET    | `/api/users/:userId/memory` | `UserMemoryController` | Get user memory |

### Memory

| Method | Path                    | Controller                  | Purpose               |
| ------ | ----------------------- | --------------------------- | --------------------- |
| GET    | `/api/memory/system`    | `SystemMemoryController`    | System memory API     |
| GET    | `/api/memory/chat`      | `ChatMemoryAdminController` | Chat memory admin     |
| GET    | `/api/memory/learning`  | `LearningController`        | Learning/feedback API |
| GET    | `/api/skills/proposals` | `SkillProposalsController`  | Skill proposals       |

### Automation

| Method | Path                              | Controller                  | Purpose               |
| ------ | --------------------------------- | --------------------------- | --------------------- |
| GET    | `/api/automation/standing-orders` | `StandingOrdersController`  | List standing orders  |
| POST   | `/api/automation/standing-orders` | `StandingOrdersController`  | Create standing order |
| GET    | `/api/automation/schedules`       | `ScheduledJobsController`   | List scheduled jobs   |
| POST   | `/api/automation/schedules`       | `ScheduledJobsController`   | Create schedule       |
| POST   | `/api/automation/heartbeat`       | `HeartbeatController`       | Agent heartbeat       |
| GET    | `/api/automation/hooks`           | `AutomationHooksController` | Automation hooks      |

### Plugins

| Method | Path                      | Controller                       | Purpose                 |
| ------ | ------------------------- | -------------------------------- | ----------------------- |
| GET    | `/api/plugins`            | `PluginManagementController`     | List installed plugins  |
| POST   | `/api/plugins`            | `PluginManagementController`     | Install/register plugin |
| POST   | `/api/plugins/:id/invoke` | `PluginToolInvocationController` | Invoke plugin tool      |

### MCP / ACP

| Method | Path       | Controller      | Purpose               |
| ------ | ---------- | --------------- | --------------------- |
| GET    | `/api/mcp` | `McpController` | MCP server management |
| GET    | `/api/acp` | `AcpController` | ACP server management |

### Operations

| Method | Path                            | Controller                   | Purpose               |
| ------ | ------------------------------- | ---------------------------- | --------------------- |
| GET    | `/api/operations/doctor`        | `OperationsDoctorController` | Run doctor diagnostic |
| POST   | `/api/operations/doctor/checks` | `OperationsDoctorController` | Run specific check    |
| GET    | `/api/operations/doctor/status` | `OperationsDoctorController` | Doctor status         |

### Health / Setup / Settings

| Method | Path                            | Controller                   | Purpose           |
| ------ | ------------------------------- | ---------------------------- | ----------------- |
| GET    | `/api/health`                   | `HealthController`           | Health check      |
| POST   | `/api/setup`                    | `SetupController`            | Initialize setup  |
| GET    | `/api/setup/status`             | `SetupController`            | Setup status      |
| GET    | `/api/system-settings`          | `SystemSettingsController`   | System settings   |
| GET    | `/api/system-settings/telegram` | `TelegramSettingsController` | Telegram settings |

### Telemetry / Observability

| Method | Path                    | Controller                  | Purpose            |
| ------ | ----------------------- | --------------------------- | ------------------ |
| GET    | `/api/events`           | `EventLedgerController`     | Query event ledger |
| GET    | `/api/metrics`          | `MetricsController`         | Service metrics    |
| GET    | `/api/runtime-feedback` | `RuntimeFeedbackController` | Runtime feedback   |

### Webhooks

| Method | Path                             | Controller                  | Purpose                  |
| ------ | -------------------------------- | --------------------------- | ------------------------ |
| POST   | `/api/webhooks/:type`            | `WebhookController`         | Generic webhook receiver |
| POST   | `/api/channel-adapters/telegram` | `TelegramWebhookController` | Telegram bot webhook     |

### Notifications

| Method | Path                       | Controller                    | Purpose                |
| ------ | -------------------------- | ----------------------------- | ---------------------- |
| GET    | `/api/notifications/inbox` | `NotificationInboxController` | Get user notifications |

### Security

| Method | Path                    | Controller                  | Purpose                |
| ------ | ----------------------- | --------------------------- | ---------------------- |
| POST   | `/api/internal/secrets` | `SecretsInternalController` | Internal secret access |

---

## Kanban API Endpoints Index

All Kanban endpoints have a global prefix of `/api` (separate NestJS app on port 3012).

### Projects

| Method | Path                       | Controller          | Purpose        |
| ------ | -------------------------- | ------------------- | -------------- |
| GET    | `/api/projects`            | `ProjectController` | List projects  |
| POST   | `/api/projects`            | `ProjectController` | Create project |
| GET    | `/api/projects/:projectId` | `ProjectController` | Get project    |
| PATCH  | `/api/projects/:projectId` | `ProjectController` | Update project |
| DELETE | `/api/projects/:projectId` | `ProjectController` | Delete project |

### Work Items

| Method | Path                                       | Controller                 | Purpose                    |
| ------ | ------------------------------------------ | -------------------------- | -------------------------- |
| GET    | `/api/projects/:project_id/work-items`     | `WorkItemController`       | List work items in project |
| POST   | `/api/projects/:project_id/work-items`     | `WorkItemController`       | Create work item           |
| GET    | `/api/projects/:project_id/work-items/:id` | `WorkItemController`       | Get work item              |
| PATCH  | `/api/projects/:project_id/work-items/:id` | `WorkItemController`       | Update work item           |
| GET    | `/api/work-items`                          | `WorkItemGlobalController` | Global work item search    |

### Orchestration

| Method | Path                                             | Controller                    | Purpose                     |
| ------ | ------------------------------------------------ | ----------------------------- | --------------------------- |
| POST   | `/api/projects/:project_id/orchestration/cycle`  | `OrchestrationController`     | Trigger orchestration cycle |
| GET    | `/api/projects/:project_id/orchestration/status` | `OrchestrationController`     | Cycle status                |
| POST   | `/api/orchestration/action-requests`             | `OrchestrationController`     | Submit orchestration action |
| GET    | `/api/projects/:project_id/control-plane`        | `ControlPlaneBoardController` | Control plane board         |

### Review

| Method | Path                                    | Controller         | Purpose       |
| ------ | --------------------------------------- | ------------------ | ------------- |
| GET    | `/api/projects/:project_id/reviews`     | `ReviewController` | List reviews  |
| POST   | `/api/projects/:project_id/reviews`     | `ReviewController` | Create review |
| GET    | `/api/projects/:project_id/reviews/:id` | `ReviewController` | Get review    |
| PATCH  | `/api/projects/:project_id/reviews/:id` | `ReviewController` | Update review |

### Dispatch

| Method | Path                                        | Controller           | Purpose          |
| ------ | ------------------------------------------- | -------------------- | ---------------- |
| POST   | `/api/projects/:project_id/dispatch`        | `DispatchController` | Trigger dispatch |
| GET    | `/api/projects/:project_id/dispatch/status` | `DispatchController` | Dispatch status  |

### Other Kanban Endpoints

| Method | Path                                            | Controller                 | Purpose                 |
| ------ | ----------------------------------------------- | -------------------------- | ----------------------- |
| GET    | `/api/projects/:project_id/goals`               | `ProjectGoalsController`   | Project goals           |
| GET    | `/api/retrospectives`                           | `RetrospectivesController` | Retrospective summaries |
| GET    | `/api/kanban-settings`                          | `KanbanSettingsController` | Kanban settings         |
| GET    | `/api/mcp`                                      | `KanbanMcpController`      | Kanban MCP endpoints    |
| POST   | `/api/external-sync`                            | `ExternalSyncController`   | External sync           |
| GET    | `/api/projects/:projectId/external-connections` | `ExternalSyncController`   | External connections    |
| GET    | `/api/health`                                   | `AppController`            | Kanban health check     |
| POST   | `/api/internal/core`                            | `CoreEventsController`     | Core event ingestion    |

---

## WebSocket Event Catalog

The WebSocket gateway runs on port 3001 (host 3011) and serves three namespaces.

### Telemetry Gateway (`/` namespace)

Agent-to-orchestrator events during workflow step execution:

| Event                   | Direction      | Purpose                                                  |
| ----------------------- | -------------- | -------------------------------------------------------- |
| `agent_telemetry`       | Agent → Server | Streaming telemetry (thoughts, progress, partial output) |
| `tool_execution_start`  | Agent → Server | Tool call started                                        |
| `tool_execution_end`    | Agent → Server | Tool call completed (with result/error)                  |
| `tool_execution_update` | Agent → Server | Mid-tool progress update                                 |
| `agent_error`           | Agent → Server | Agent encountered an error                               |
| `step_complete`         | Agent → Server | Workflow step finished (success/failure)                 |
| `user_questions_posed`  | Agent → Server | Agent asks user for clarification                        |
| `turn_end`              | Agent → Server | Agent turn ended                                         |
| `agent_end`             | Agent → Server | Agent session ended                                      |
| `spawn_subagent_async`  | Agent → Server | Request to spawn a subagent                              |
| `wait_for_subagents`    | Agent → Server | Wait for subagents to complete                           |
| `check_subagent_status` | Agent → Server | Poll subagent status                                     |

### War Room Gateway (`/` namespace)

Multi-agent collaboration events:

| Event                         | Direction            | Purpose                     |
| ----------------------------- | -------------------- | --------------------------- |
| `open_war_room`               | UI/Agent → Server    | Open a new war room session |
| `invite_war_room_participant` | UI/Agent → Server    | Invite an agent to war room |
| `post_war_room_message`       | Participant → Server | Post message to war room    |
| `update_war_room_blackboard`  | Participant → Server | Update shared blackboard    |
| `submit_war_room_signoff`     | Participant → Server | Sign off on consensus       |
| `get_war_room_state`          | Participant → Server | Request current state       |
| `close_war_room`              | UI/Agent → Server    | Close war room              |

### Notification Gateway (`/notifications` namespace)

Server-to-client notification events:

| Event               | Direction     | Purpose                              |
| ------------------- | ------------- | ------------------------------------ |
| `notification:new`  | Server → User | New notification (inbox item, alert) |
| `notification:read` | Server → User | Notification marked as read          |

### Chat Session Collaboration

Real-time chat collaboration is handled through the `ChatSessionCollaborationService` which manages agent mention resolution, thread management, and agent invitations within chat sessions.

---

## BullMQ Queue Reference

| Queue Name          | Consumer                  | Concurrency | Purpose                                        |
| ------------------- | ------------------------- | ----------- | ---------------------------------------------- |
| `workflow-steps`    | `StepExecutionConsumer`   | 4           | Workflow step execution, scheduling, and retry |
| `chat-sessions`     | `ChatSessionConsumer`     | 4           | Chat session execution and message processing  |
| `distillation`      | `DistillationConsumer`    | 1           | Conversation summarization and distillation    |
| `session-cleanup`   | `SessionCleanupService`   | 1           | Expired session archival and cleanup           |
| `container-cleanup` | `ContainerCleanupService` | 1           | Docker container garbage collection            |
| `scheduled-jobs`    | `ScheduledJobsConsumer`   | 1           | Scheduled job polling and execution            |

All queues use Redis (host port 6380, container port 6379) via BullMQ. Queue prefix is configurable via `BULLMQ_QUEUE_NAME` (default: `bull:workflow_steps`).

---

## Database Connection Strings

### Default (Primary PostgreSQL)

```
postgresql://nexus:nexus_password@localhost:5433/nexus_orchestrator
```

Inside Docker network (service-to-service):

```
postgresql://nexus:nexus_password@postgres:5432/nexus_orchestrator
```

### Honcho (Vector DB, requires `--profile honcho`)

```
postgresql://honcho:honcho_password@localhost:5443/honcho
```

---

## Redis Connection Details

| Property     | Value                                                        |
| ------------ | ------------------------------------------------------------ |
| Host         | `localhost` (outside Docker), `redis` (inside Docker)        |
| Port         | 6380 (host), 6379 (container)                                |
| Password     | None (default)                                               |
| Queue prefix | `bull:workflow_steps` (configurable via `BULLMQ_QUEUE_NAME`) |

---

## Environment Variables Reference

### Application

| Variable    | Required | Default       | Purpose             |
| ----------- | -------- | ------------- | ------------------- |
| `PORT`      | No       | `3000`        | API HTTP port       |
| `NODE_ENV`  | No       | `development` | Runtime environment |
| `LOG_LEVEL` | No       | `info`        | Logging verbosity   |

### Database (API + Kanban)

| Variable      | Required | Default              | Purpose           |
| ------------- | -------- | -------------------- | ----------------- |
| `DB_HOST`     | Yes      | `localhost`          | PostgreSQL host   |
| `DB_PORT`     | Yes      | `5432`               | PostgreSQL port   |
| `DB_USERNAME` | Yes      | `nexus`              | Database user     |
| `DB_PASSWORD` | Yes      | `nexus_password`     | Database password |
| `DB_DATABASE` | Yes      | `nexus_orchestrator` | Database name     |

### Redis + BullMQ

| Variable            | Required | Default               | Purpose           |
| ------------------- | -------- | --------------------- | ----------------- |
| `REDIS_HOST`        | Yes      | `localhost`           | Redis host        |
| `REDIS_PORT`        | Yes      | `6379`                | Redis port        |
| `REDIS_PASSWORD`    | No       | —                     | Redis password    |
| `BULLMQ_QUEUE_NAME` | No       | `bull:workflow_steps` | Queue name prefix |

### Docker

| Variable             | Required | Default                | Purpose                  |
| -------------------- | -------- | ---------------------- | ------------------------ |
| `DOCKER_SOCKET_PATH` | No\*     | `/var/run/docker.sock` | Docker daemon socket     |
| `DOCKER_HOST`        | No\*     | —                      | Remote Docker daemon URL |

\*One of `DOCKER_SOCKET_PATH` or `DOCKER_HOST` must be set.

### Auth + Security

| Variable                     | Required | Default     | Purpose                           |
| ---------------------------- | -------- | ----------- | --------------------------------- |
| `JWT_SECRET`                 | Yes      | —           | JWT signing secret (min 32 chars) |
| `JWT_ACCESS_EXPIRY`          | No       | `15m`       | Access token TTL                  |
| `JWT_REFRESH_EXPIRY`         | No       | `7d`        | Refresh token TTL                 |
| `JWT_REFRESH_REMEMBER_ME`    | No       | `30d`       | Extended refresh TTL              |
| `SECRET_ENCRYPTION_KEY`      | Yes      | —           | Encryption key for secret store   |
| `WEBHOOK_SECRET`             | No       | `change-me` | Webhook HMAC secret               |
| `CORS_ORIGIN`                | No       | `*`         | CORS allowed origins              |
| `PASSWORD_MIN_LENGTH`        | No       | `8`         | Minimum password length           |
| `PASSWORD_REQUIRE_UPPERCASE` | No       | `true`      | Require uppercase                 |
| `PASSWORD_REQUIRE_LOWERCASE` | No       | `true`      | Require lowercase                 |
| `PASSWORD_REQUIRE_NUMBERS`   | No       | `true`      | Require numbers                   |
| `PASSWORD_REQUIRE_SPECIAL`   | No       | `true`      | Require special chars             |
| `PASSWORD_BCRYPT_ROUNDS`     | No       | `12`        | Bcrypt cost factor                |
| `RATE_LIMIT_TTL`             | No       | `60`        | Rate limit window (seconds)       |
| `RATE_LIMIT_REQUESTS`        | No       | `10`        | Max requests per window           |
| `RATE_LIMIT_AUTH_TTL`        | No       | `60`        | Auth rate limit window            |
| `RATE_LIMIT_AUTH_REQUESTS`   | No       | `5`         | Auth requests per window          |

### Workflow / Agent Runtime

| Variable                    | Required | Default                            | Purpose                           |
| --------------------------- | -------- | ---------------------------------- | --------------------------------- |
| `WEBSOCKET_URL`             | No       | `http://host.docker.internal:3001` | Internal WS URL for agents        |
| `TELEMETRY_PUBLIC_WS_URL`   | No       | `http://localhost:3011`            | Public WS URL for browser clients |
| `NEXUS_DOCKER_NETWORK`      | No       | `nexus-network`                    | Docker network for containers     |
| `NEXUS_WORKSPACE_BASE_PATH` | No       | `/data/nexus-workspaces`           | Workspace mount base              |

### AI Model Fallbacks

| Variable              | Required | Default | Purpose                            |
| --------------------- | -------- | ------- | ---------------------------------- |
| `MODEL`               | No       | —       | Default AI model (env fallback)    |
| `DISTILLATION_MODEL`  | No       | —       | Distillation model (env fallback)  |
| `SUMMARIZATION_MODEL` | No       | —       | Summarization model (env fallback) |

### Provider Credentials (Fallback)

| Variable               | Required | Default | Purpose                         |
| ---------------------- | -------- | ------- | ------------------------------- |
| `OPENAI_API_KEY`       | No       | —       | OpenAI API key (fallback)       |
| `ANTHROPIC_API_KEY`    | No       | —       | Anthropic API key (fallback)    |
| `GOOGLE_API_KEY`       | No       | —       | Google API key (fallback)       |
| `AZURE_OPENAI_API_KEY` | No       | —       | Azure OpenAI API key (fallback) |

### Host Mount / DinD

| Variable                         | Required | Default                   | Purpose                              |
| -------------------------------- | -------- | ------------------------- | ------------------------------------ |
| `NEXUS_HOST_WORKSPACE_PATH`      | No       | —                         | Host path for workspace mounts       |
| `NEXUS_HOST_TOOL_MOUNT_PATH`     | No       | —                         | Host path for tool mounts            |
| `NEXUS_HOST_SKILLS_PATH`         | No       | —                         | Host path for skills library         |
| `NEXUS_HOST_SEED_PATH`           | No       | `./seed`                  | Host path for seed data              |
| `NEXUS_HOST_SHARE_MOUNT_PATH`    | No       | —                         | Host path for governed shares        |
| `NEXUS_API_HOST_SHARE_BASE_PATH` | No       | `/data/nexus-host-shares` | Container share base path            |
| `NEXUS_HOST_MOUNT_CATALOG_JSON`  | No       | —                         | Mount catalog alias overrides (JSON) |

### Memory Backend

| Variable                    | Required | Default                  | Purpose                                 |
| --------------------------- | -------- | ------------------------ | --------------------------------------- |
| `MEMORY_BACKEND`            | No       | `postgres`               | Memory backend (`postgres` or `honcho`) |
| `HONCHO_BASE_URL`           | No       | `http://honcho-api:8000` | Honcho API URL                          |
| `HONCHO_API_KEY`            | No       | —                        | Honcho API key                          |
| `HONCHO_DEFAULT_WORKSPACE`  | No       | `nexus`                  | Honcho workspace name                   |
| `HONCHO_WORKSPACE_STRATEGY` | No       | `global`                 | Workspace scoping strategy              |
| `HONCHO_FALLBACK_ON_ERROR`  | No       | `true`                   | Fallback to postgres on error           |

### Chat / Telegram

| Variable                              | Required | Default                      | Purpose                          |
| ------------------------------------- | -------- | ---------------------------- | -------------------------------- |
| `CHAT_TELEGRAM_BOT_TOKEN`             | No       | —                            | Telegram bot token               |
| `CHAT_TELEGRAM_WEBHOOK_SECRET`        | No       | —                            | Telegram webhook secret          |
| `CHAT_TELEGRAM_INGRESS_MODE`          | No       | `webhook`                    | `webhook` or `polling`           |
| `CHAT_TELEGRAM_DEFAULT_AGENT_PROFILE` | No       | `friendly-general-assistant` | Default chat agent               |
| `CHAT_TELEGRAM_ALLOWED_USER_IDS`      | No       | —                            | Comma-separated allowed user IDs |

### E2E Testing

| Variable                | Required | Default                 | Purpose                      |
| ----------------------- | -------- | ----------------------- | ---------------------------- |
| `RUN_LIVE_E2E`          | No       | `false`                 | Enable live E2E tests        |
| `E2E_API_URL`           | No       | `http://127.0.0.1:3010` | E2E API URL                  |
| `E2E_WS_URL`            | No       | `http://127.0.0.1:3011` | E2E WebSocket URL            |
| `E2E_JWT_SECRET`        | No       | —                       | JWT secret for E2E test auth |
| `E2E_PROVIDER_NAME`     | No       | —                       | E2E LLM provider name        |
| `E2E_MODEL_NAME`        | No       | —                       | E2E LLM model name           |
| `E2E_PROVIDER_API_KEY`  | No       | —                       | E2E provider API key         |
| `E2E_PROVIDER_BASE_URL` | No       | —                       | E2E provider base URL        |

### Seed Control

| Variable                    | Required | Default            | Purpose                         |
| --------------------------- | -------- | ------------------ | ------------------------------- |
| `NEXUS_SKILLS_SEED_PATH`    | No       | `./seed/skills`    | Skill seed directory            |
| `NEXUS_AGENTS_SEED_PATH`    | No       | `./seed/agents`    | Agent profile seed directory    |
| `NEXUS_WORKFLOWS_SEED_PATH` | No       | `./seed/workflows` | Workflow YAML seed directory    |
| `SEED_LLM_SECRET_FROM_ENV`  | No       | `false`            | Bootstrap secrets from env vars |
| `STRICT_SKILL_VALIDATION`   | No       | `false`            | Enable strict skill validation  |

### Feature Toggles

| Variable                   | Required | Default | Purpose                   |
| -------------------------- | -------- | ------- | ------------------------- |
| `EXTERNAL_PROMPTS_ENABLED` | No       | `true`  | External prompt injection |
| `WORKFLOW_DRY_RUN`         | No       | `true`  | Workflow dry-run mode     |

### Kanban-Specific (apps/kanban)

| Variable                      | Required | Default                       | Purpose                |
| ----------------------------- | -------- | ----------------------------- | ---------------------- |
| `KANBAN_PORT`                 | No       | `3012`                        | Kanban API port        |
| `KANBAN_CORE_BASE_URL`        | No       | `http://api:3000/api`         | Core API URL           |
| `KANBAN_CORE_BEARER_TOKEN`    | No       | —                             | Core API auth token    |
| `KANBAN_SERVICE_BEARER_TOKEN` | No       | `nexus-kanban-internal-token` | Internal service token |
| `KANBAN_SERVICE_JWT_AUDIENCE` | No       | `nexus-kanban-service`        | Service JWT audience   |
| `KANBAN_SERVICE_JWT_ISSUER`   | No       | `nexus-api`                   | Service JWT issuer     |
| `KANBAN_CORE_JWT_AUDIENCE`    | No       | `nexus-core-internal`         | Core JWT audience      |
| `KANBAN_CORE_JWT_ISSUER`      | No       | `nexus-kanban`                | Core JWT issuer        |

### PI Runner (packages/pi-runner)

| Variable          | Required | Default | Purpose                   |
| ----------------- | -------- | ------- | ------------------------- |
| `AGENT_JWT`       | Yes\*    | —       | JWT for agent-to-API auth |
| `WORKFLOW_RUN_ID` | Yes\*    | —       | Workflow run identifier   |
| `TEMPERATURE`     | No       | `0.7`   | Model temperature         |
| `RESUME_NODE_ID`  | No       | —       | Resume from specific step |
| `SYSTEM_PROMPT`   | No       | —       | System prompt override    |

\*Injected by the orchestrator when spawning agent containers.

### Observability

| Variable                      | Required | Default                           | Purpose                 |
| ----------------------------- | -------- | --------------------------------- | ----------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No       | `http://localhost:4318/v1/traces` | OpenTelemetry collector |
