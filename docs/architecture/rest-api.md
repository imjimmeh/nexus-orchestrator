# REST API Architecture

The platform currently runs with two active service apps. All HTTP routes are still served behind each app's global `/api` prefix.

## Service Ownership

### `apps/api` (control plane + chat runtime)

Owns workflow execution/control, AI config, setup, operations doctor, telemetry auth, session control-plane endpoints, chat session/message APIs, chat memory observability, and channel adapters (Telegram first).

### `apps/kanban` (domain service)

Owns project/work-item/orchestration/review/war-room domain APIs.

## Chat Route Ownership

Chat runtime routes are served directly by `apps/api`.

## Key Endpoint Groups by Service

### Core API (`apps/api`)

#### Workflow and Run APIs

- `POST /api/workflows` - Create workflow definition
- `GET /api/workflows` - List workflow definitions
- `POST /api/workflows/:id/execute` - Execute workflow
- `POST /api/workflows/projects/:projectId/:id/execute` - Execute workflow for project
- `GET /api/workflows/runs` - List workflow runs
- `GET /api/workflows/runs/:runId` - Get workflow run by ID
- `GET /api/workflows/runs/:runId/events` - Get workflow run telemetry event history
- `GET /api/workflows/runs/:runId/telemetry-auth` - Get telemetry websocket auth token
- `GET /api/workflows/runs/:runId/graph` - Get workflow run graph snapshot
- `GET /api/workflows/runs/:runId/host-mounts/diagnostics` - Get host mount diagnostics
- `GET /api/workflows/:id/graph` - Get workflow definition graph
- `POST /api/workflows/runs/:runId/control/pause` - Pause active run container
- `POST /api/workflows/runs/:runId/control/resume` - Resume paused run container
- `POST /api/workflows/runs/:runId/control/abort` - Abort active run container
- `POST /api/workflows/runs/:runId/inject` - Inject user guidance into run telemetry stream
- `POST /api/workflows/runs/:runId/question-answers` - Submit answers to agent-posed questions
- `GET /api/workflows/runs/:runId/workspace/tree` - Get workspace file tree for active run step
- `GET /api/workflows/runs/:runId/workspace/diff` - Get current git diff for active run workspace

#### Workflow Runtime Browser Actions (Internal)

Browser automation is implemented as an internal service (`WorkflowRuntimeBrowserActionsService`) invoked by workflow steps. No dedicated HTTP endpoints are exposed.

#### Setup, Webhooks, and Session Routes

- `GET /api/setup/status` - Get setup status
- `POST /api/setup/initialize` - Initialize platform
- `POST /api/setup/skip` - Skip setup
- `POST /api/webhooks/kanban` - Kanban webhook endpoint
- `POST /api/webhooks/github` - GitHub webhook endpoint
- `POST /api/webhooks/:workflow_id` - Workflow-specific webhook
- `POST /api/sessions/ad-hoc` - Create ad-hoc session
- `GET /api/sessions/ad-hoc` - List ad-hoc sessions
- `GET /api/sessions/:id` - Get session by ID
- `GET /api/sessions/:id/events` - Get session event history

#### Chat Session and Messaging APIs

- `POST /api/sessions/chat` - Create chat session
- `GET /api/sessions/chat` - List chat sessions
- `GET /api/sessions/chat/:chatId` - Get chat session by ID
- `DELETE /api/sessions/chat/:chatId` - Delete chat session
- `GET /api/sessions/chat/:chatId/participants` - List chat participants
- `POST /api/sessions/chat/:chatId/participants/invite` - Invite participant to chat
- `GET /api/sessions/chat/:chatId/state` - Get chat session state
- `GET /api/sessions/chat/:chatId/telemetry-auth` - Get chat telemetry auth token
- `POST /api/sessions/chat/:chatId/messages` - Send message to chat
- `GET /api/sessions/chat/:chatId/events` - Get chat event history
- `POST /api/sessions/chat/:chatId/question-answers` - Submit answers to chat questions

#### Chat Memory Observability APIs

- `GET /api/internal/chat-memory/metrics` - Get chat memory metrics
- `GET /api/internal/chat-memory/jobs` - List chat memory jobs
- `GET /api/internal/chat-memory/events` - List chat memory events

#### Channel Ingress

- `POST /api/channel-adapters/telegram/webhook` - Telegram webhook endpoint

#### AI Config and Skills

- `GET|POST /api/ai-config/providers` - List or create LLM providers
- `GET|POST /api/ai-config/models` - List or create models
- `GET|POST /api/ai-config/agent-profiles` - List or create agent profiles
- `GET|POST /api/ai-config/secrets` - Manage secrets
- `GET|POST|PATCH|DELETE /api/ai-config/skills` - Manage skills
- `GET|PUT|DELETE /api/ai-config/skills/:id/files` - Manage skill files
- `GET|PUT /api/ai-config/agent-profiles/:id/skills` - Manage profile skill assignments

#### MCP Runtime

- `GET|POST|PATCH|DELETE /api/mcp/servers` - Manage MCP server configurations
- `POST /api/mcp/servers/:id/test` - Test server connectivity
- `POST /api/mcp/servers/:id/reload` - Reload server tool catalog
- `POST /api/mcp/reload` - Reload all enabled servers
- `POST /api/mcp/servers/:id/tools/:toolName/invoke` - Invoke MCP tool

#### Operations Doctor

- `GET /api/operations/doctor` - Get doctor status
- `POST /api/operations/doctor/repair` - Execute repair action
- `GET /api/operations/doctor/history` - Get repair history

#### Observability

- `GET /api/metrics` - Prometheus metrics endpoint
- `GET /api/health` - Health check endpoint
- `GET /api/event-ledger` - Event ledger query endpoint

#### Tool Registry and Execution

- `POST /api/tools` - Register new tool
- `POST /api/tools/upsert` - Upsert tool by name
- `GET /api/tools` - List all registered tools
- `GET /api/tools/:id` - Get tool by ID
- `PATCH /api/tools/:id` - Update registered tool
- `DELETE /api/tools/:id` - Remove tool
- `POST /api/tools/candidates` - Create tool candidate draft
- `GET /api/tools/candidates` - List tool candidates
- `GET /api/tools/candidates/:id` - Get tool candidate by ID
- `GET /api/tools/candidates/:id/validation-runs` - List validation runs
- `POST /api/tools/candidates/:id/validate` - Run validation
- `POST /api/tools/candidates/:id/publish` - Publish validated candidate
- `POST /api/tools/runtime/:toolName/execute` - Execute published tool

#### Workflow Runtime Tools

- `POST /api/workflow-runtime/get-capabilities` - Get available capabilities for context
- `POST /api/workflow-runtime/check-permission` - Check if tool call is permitted
- `POST /api/workflow-runtime/query-memory` - Query persisted memory
- `POST /api/workflow-runtime/get-todo-list` - Get workflow run todo list
- `POST /api/workflow-runtime/manage-todo-list` - Replace todo list
- `POST /api/workflow-runtime/set-job-output` - Persist job output
- `POST /api/workflow-runtime/preflight/submit` - Submit preflight artifacts
- `POST /api/workflow-runtime/tools/candidates` - Create tool candidate via runtime
- `POST /api/workflow-runtime/tools/candidates/:artifactId/validate` - Validate candidate
- `POST /api/workflow-runtime/tools/candidates/:artifactId/publish` - Publish candidate
- `POST /api/workflow-runtime/tools/upsert` - Upsert tool via runtime
- `POST /api/workflow-runtime/skills` - Create skill via runtime
- `POST /api/workflow-runtime/skills/save-script` - Save script as skill
- `PATCH /api/workflow-runtime/skills/:skillId` - Update skill via runtime
- `POST /api/workflow-runtime/skills/:skillId/files/list` - List skill files
- `PUT /api/workflow-runtime/skills/:skillId/files` - Create/update skill file
- `DELETE /api/workflow-runtime/skills/:skillId/files` - Delete skill file
- `POST /api/workflow-runtime/profiles/:profileId/skills` - Replace profile skills
- `POST /api/workflow-runtime/profiles/:profileId/skills/add` - Add profile skills
- `POST /api/workflow-runtime/profiles/:profileId/skills/remove` - Remove profile skills
- `POST /api/workflow-runtime/orchestration/invoke-agent-workflow` - Launch Core workflow
- `POST /api/workflow-runtime/subagents/spawn-async` - Spawn async subagent
- `POST /api/workflow-runtime/subagents/wait` - Wait for subagent completion
- `POST /api/workflow-runtime/subagents/status` - Get subagent status
- `POST /api/workflow-runtime/subagents/delegations/create` - Create mesh delegation
- `POST /api/workflow-runtime/subagents/delegations/get` - Get delegation contract
- `POST /api/workflow-runtime/subagents/delegations/cancel` - Cancel delegation
- `POST /api/workflow-runtime/subagents/delegations/dispatch` - Dispatch queued delegations
- `POST /api/workflow-runtime/subagents/delegations/sweep-timeouts` - Sweep timed-out delegations
- `POST /api/workflow-runtime/subagents/delegations/replay` - Replay delegation lifecycle

#### Tool Call Approval Governance

- `GET|POST /api/tool-call-approval-requests` - List/create approval requests
- `GET /api/tool-call-approval-requests/:id` - Get approval request details
- `PATCH /api/tool-call-approval-requests/:id` - Approve/reject approval request

#### Tool Approval Rules

- `GET|POST /api/tool-approval-rules` - List/create approval rules
- `GET /api/tool-approval-rules/:id` - Get approval rule details
- `PATCH /api/tool-approval-rules/:id` - Update approval rule
- `DELETE /api/tool-approval-rules/:id` - Delete approval rule

#### Notifications

- `GET|POST /api/notifications/inbox` - List/create notification inbox entries

#### ACP (Agent Communication Protocol)

- `GET /api/acp` - ACP status/health

### Kanban Service (`apps/kanban`)

Project/work-item/orchestration APIs live in `apps/kanban` and use the same route shapes expected by the web UI:

- `/api/projects/*` - Project CRUD and listing
- `/api/projects/:projectId/work-items/*` - Work item management
- `/api/projects/:projectId/orchestration/*` - Orchestration and dispatch
- `/api/projects/:projectId/reviews/*` - Review and QA workflows
- `/api/projects/:projectId/goals/*` - Project goals management
- `/api/projects/:projectId/dispatch/*` - Work item dispatch

#### Internal Core Integration Endpoints

- `/api/internal/core/*` - Internal service-to-service communication

## Authentication and Authorization

### User-Facing Endpoints

- JWT auth + role checks in core API controllers
- Roles: `Admin`, `Developer`, `Agent`

### Internal Service-to-Service Routes

- Static bearer token mode, or
- Service JWT mode with required service scopes

## Runtime URL Resolution

Telemetry websocket URL precedence for run auth endpoints:

1. `TELEMETRY_PUBLIC_WS_URL`
2. `TELEMETRY_WS_URL`
3. `WEBSOCKET_URL`
4. Request-derived fallback

## API Versioning

The API is versioned through the URL path. Current version is v1 (implied by `/api` prefix). Future versions may use `/api/v2/` prefix.

## Rate Limiting

Not currently implemented.

## Error Responses

All errors return JSON with the following structure:

```json
{
  "success": false,
  "error": {
    "code": "HttpExceptionName",
    "message": "Error message",
    "details": { ... },
    "timestamp": "2026-01-01T00:00:00.000Z",
    "requestId": "optional-correlation-id"
  }
}
```

The `error.code` field contains the NestJS exception class name (e.g., `BadRequestException`, `NotFoundException`, `ForbiddenException`, `InternalServerError`). The `error.details` field contains additional context from the exception. A `requestId` is included when available from the request context.

## Pagination

List endpoints use offset-based pagination:

```json
{
  "success": true,
  "data": [ ... ]
}
```

Query parameters:
- `limit` - Number of items per page (default varies by endpoint)
- `offset` - Number of items to skip (default: 0)

Some endpoints include a `total` count in the response envelope. Sorting and text search are endpoint-specific, not universal.

## Related Documentation

- `docs/architecture/chat-sessions.md` - Chat session management
- `docs/architecture/telemetry-gateway.md` - Telemetry and real-time updates
- `docs/operations/compatibility-layers-and-legacy-removal.md` - API evolution