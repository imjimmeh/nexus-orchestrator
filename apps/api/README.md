# Nexus Orchestrator - API

Foundational API for the Nexus Orchestrator system, built with NestJS.

All REST endpoints below are served under the global `/api` prefix.

## Prerequisites

- Node.js 20+
- PostgreSQL 15+
- Redis 7+

## Setup

1. Copy `.env.example` to `.env` and fill in the values:

   ```bash
   cp .env.example .env
   ```

2. Install dependencies (from root):

   ```bash
   npm install
   ```

3. Build shared packages:

   ```bash
   npm run build --workspace=packages/core
   npm run build --workspace=packages/plugin-sdk
   ```

4. Start the API in development mode:

   ```bash
   npm run start:dev --workspace=apps/api
   ```

## Environment Variables

### Core runtime defaults (.env / local dev)

- `PORT`: API port. Default `3000`.
- `LOG_LEVEL`: API log level (`error`, `warn`, `info`, `debug`). Default `info`. TypeORM SQL queries are logged at `debug`, so set `LOG_LEVEL=debug` only when you need query-level diagnostics.
- `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`: PostgreSQL connection settings. Defaults `localhost:5432`, `postgres/postgres`, `nexus_orchestrator`.
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`: Redis connection settings. Defaults `localhost:6379` with no password.
- `BULLMQ_QUEUE_NAME`: BullMQ queue name. Default `bull:workflow_steps`.
- `JWT_SECRET`: JWT signing secret for auth and telemetry tokens. Required. Use an explicit local-only value at least 32 characters long.
- `AGENT_JWT_TTL`: Lifetime of agent JWTs minted for workflow-step, subagent, parent-resume, and chat-agent containers. Accepts seconds (`7200`) or a duration string (`24h`, `90m`). Default `24h`. Set this longer than your longest expected _active_ step — the token is baked in at container start and never refreshed, so a too-short value makes long steps hit governance `401`s mid-run.
- `WEBHOOK_SECRET`: Shared secret for webhook HMAC verification. Required for webhook endpoints.
- `DOCKER_SOCKET_PATH`: Docker socket path for container orchestration. Typical Linux default: `/var/run/docker.sock`.
- `DOCKER_HOST`: Remote Docker daemon address (used instead of local socket when set).
- `NEXUS_DOCKER_NETWORK`: Docker network used for managed containers.
- `NEXUS_WORKTREE_BASE_PATH`: Legacy explicit worktree root override. Default fallback: `<repo>/data/worktrees`.
- `NEXUS_WORKSPACE_BASE_PATH`: Workspace base path used by container/workspace orchestration. Default fallback: OS temp + `nexus-workspaces`.
- `NEXUS_WORKSPACE_EXPORT_PATH`: Workspace export path for run workspace tree/diff APIs. Defaults to `NEXUS_WORKSPACE_BASE_PATH`.
- `NEXUS_HOST_WORKSPACE_PATH`: Host workspace path override for nested Docker bind remapping.
- `NEXUS_HOST_TOOL_MOUNT_PATH`: Host tool mount path override for nested Docker bind remapping.
- `NEXUS_TOOL_MOUNT_BASE_PATH`: Container-side base path for temporary tool mounts. Default fallback: `/tmp/nexus-tools`.
- `NEXUS_WORKTREE_CONTAINER_USER`: Optional `UID:GID` for container file ownership alignment.
- `TELEMETRY_PUBLIC_WS_URL`, `TELEMETRY_WS_URL`, `WEBSOCKET_URL`: WebSocket URL resolution chain for UI/runtime connectivity.
- `CORS_ORIGIN`: Allowed origins list (comma-separated, `*` supported).

### Docker Compose overrides

`docker-compose.yaml` runs API with container-network values that differ from local `.env.example`:

- Postgres: `DB_HOST=postgres`, `DB_PORT=5432`, `DB_USERNAME=nexus`, `DB_PASSWORD=nexus_password`
- Redis: `REDIS_HOST=redis`, `REDIS_PORT=6379`
- Auth/telemetry signing: `JWT_SECRET` (defaults to `nexus-e2e-secret` in compose if unset)
- Docker orchestration: `DOCKER_SOCKET_PATH=/var/run/docker.sock`, `NEXUS_DOCKER_NETWORK=nexus-network`
- Workspace mounts: `NEXUS_WORKSPACE_BASE_PATH=/data/nexus-workspaces`, `NEXUS_WORKSPACE_EXPORT_PATH=/data/nexus-workspaces`
- Optional host mount remapping: `NEXUS_HOST_WORKSPACE_PATH`, `NEXUS_HOST_TOOL_MOUNT_PATH`, `NEXUS_TOOL_MOUNT_BASE_PATH`
- Host-exposed ports: API `3010`, WS `3011`, Postgres `5433`, Redis `6380`

### Chat runtime and Telegram ingress (current in-process implementation)

Chat runtime routes and Telegram ingress are currently served directly by `apps/api` as part of the core orchestration logic. While a separate `apps/chat` service is planned for future extraction, all active chat functionality resides here.

Common chat runtime env vars:

- `CHAT_SERVICE_BEARER_TOKEN`: static bearer token for trusted chat clients/internal calls
- `CHAT_SERVICE_JWT_AUDIENCE` (default `nexus-chat-service`)
- `CHAT_SERVICE_JWT_ISSUER` (default `nexus-api`)
- `CHAT_SERVICE_JWT_TTL` (default `5m`)
- `CHAT_TELEGRAM_BOT_TOKEN`
- `CHAT_TELEGRAM_WEBHOOK_SECRET`
- `CHAT_TELEGRAM_INGRESS_MODE` (`webhook`, `polling`, `hybrid`)
- `CHAT_TELEGRAM_POLL_TIMEOUT_SECONDS`
- `CHAT_TELEGRAM_POLL_RETRY_DELAY_MS`
- `CHAT_TELEGRAM_POLL_BACKOFF_MAX_MS`
- `CHAT_TELEGRAM_OUTBOUND_RELAY_ENABLED`
- `CHAT_TELEGRAM_OUTBOUND_RELAY_INTERVAL_MS`
- `CHAT_TELEGRAM_OUTBOUND_RELAY_BATCH_SIZE`
- `CHAT_TELEGRAM_DEFAULT_AGENT_PROFILE`
- `CHAT_TELEGRAM_DEFAULT_PROJECT_ID`
- `CHAT_TELEGRAM_ALLOWED_USER_IDS`

Split-service diagnostics:

- `KANBAN_SERVICE_BASE_URL`: optional health target for split-service doctor checks
- `DOCTOR_SPLIT_SERVICE_TIMEOUT_MS`: timeout for split-service connectivity checks

### Invitation email delivery (SMTP, Phase 3)

Email is an **opt-in** delivery channel for [multi-tenant invitations](../../docs/guide/multi-tenant-scopes.md#phase-3--email-delivery):
when SMTP is configured and an invitation carries an `email`,
`InvitationService.createInvitation` sends the accept link by email,
best-effort — a missing/misconfigured SMTP setup or a transport failure
never blocks invitation creation, and the copyable accept link (Phase 2)
always still works regardless. All vars below are optional; a blank value
(as shipped in `.env.example`) is treated as absent so `cp .env.example .env`
never crashes the API on boot.

- `PUBLIC_APP_URL`: public origin used to build the accept-invite link. Default `http://localhost:3120`.
- `SMTP_HOST`, `SMTP_FROM`: minimum pair required for email to be considered "configured" (`EmailConfigService.isConfigured()`).
- `SMTP_PORT`: default `587`.
- `SMTP_SECURE`: implicit-TLS flag passed to nodemailer. Default `false`.
- `SMTP_USER`: SMTP auth username; only used if a password also resolves (a lone `SMTP_USER` with no resolvable password sends unauthenticated, with a warning).
- `SMTP_PASSWORD_SECRET_ID`: preferred password source — a `secret_store` id (must be a UUID; the config schema enforces `.uuid()`, so a non-UUID value fails validation at boot) resolved via `SecretCrudService.findByIdRaw`.
- `SMTP_PASSWORD`: fallback plaintext password, not recommended for production. **Precedence: `SMTP_PASSWORD_SECRET_ID` wins over `SMTP_PASSWORD` whenever the secret resolves.** The resolved password is never logged.

## Health Check

Endpoint: `GET /api/health`

Returns status for:

- Database connection
- Redis connectivity

## First-Login Setup Endpoints (EPIC-026)

For admin users, the API exposes setup bootstrap endpoints used by the first-login onboarding flow.

- `GET /setup/status`
  - Returns whether setup is required (`requiresSetup`) and readiness flags:
    - `hasAnySecret`
    - `hasActiveProvider`
    - `hasActiveModel`
    - `hasArchitectProfile`
- `POST /setup/initialize`
  - Admin-only idempotent bootstrap for:
    - Encrypted provider secret (`secret_store`)
    - Provider activation and secret linkage (`llm_providers`)
    - Default model activation (`llm_models`)
    - Architect profile activation and model/provider binding (`agent_profiles`)
- `POST /setup/skip`
  - Admin-only endpoint to bypass first-login setup and clear setup-required state.
  - Returns `{ success: true, data: { skipped: true } }`.

Startup seeding behavior:

- On startup, `StartupSeedService` seeds roles, setup config, LLM defaults,
  filesystem skills, agent profiles, and workflow YAML definitions.
- Agent profile startup seed source precedence:
  1. `seed/agents/<agent-name>/agent.json` + `PROMPT.md`
  2. Legacy TypeScript profile definitions (fallback only when file seeds are absent)
- Agent skills assignment startup precedence:
  1. `assigned_skills` in each `seed/agents/<agent-name>/agent.json`
  2. Legacy `seed/agents/skill-assignments.seed.json` fallback only when a file-seeded agent omits `assigned_skills`
- When file-based agent seeds exist, standalone legacy assignment seeding is skipped and a deprecation warning is logged.
- `POST /setup/initialize` also seeds workflows as a best-effort step.
- Manual reseed remains available via `npm --prefix apps/api run seed:workflows`.

## Workflow Run Telemetry Endpoints

The workflow module exposes run-level telemetry endpoints used by the web execution detail page.

- `GET /workflows/runs`
  - Supports optional query filters:
    - `workflowId`: limit results to a single workflow
    - project id: limit results to runs triggered for a project
  - Filters can be combined with a project filter for scoped run lookups.
  - Orchestration-initiated `invoke_agent_workflow` runs now include
    `trigger.orchestrationId`, enabling deterministic linkage to
    `project_orchestrations.current_workflow_run_id`.

- `GET /workflows/runs/:runId`
  - Returns workflow run state, including `state_variables` (step outputs).
- `GET /workflows/runs/:runId/events`
  - Returns replayable telemetry history from Redis stream `stream:telemetry:{runId}`.
- `GET /workflows/runs/:runId/telemetry-auth`
  - Returns short-lived UI websocket auth payload:
    - `token`: JWT with `{ workflowRunId, role: 'ui' }`
    - `wsUrl`: telemetry gateway URL (`TELEMETRY_PUBLIC_WS_URL`, then `TELEMETRY_WS_URL`, then `WEBSOCKET_URL`, then request-derived fallback)
- `GET /workflows/runs/:runId/graph`
  - Returns canonical runtime workflow DAG snapshot (run status + node status projection).
- `GET /workflows/:id/graph`
  - Returns static workflow graph projection for workflow-definition visualization.

EPIC-022 adds Active Session deep-steering endpoints:

- `POST /workflows/runs/:runId/control/pause`
- `POST /workflows/runs/:runId/control/resume`
- `POST /workflows/runs/:runId/control/abort`
- `POST /workflows/runs/:runId/inject` with `{ message }`
- `POST /workflows/runs/:runId/question-answers` with `{ answers }` — submit answers to agent-posed `ask_user_questions`. Answers are persisted to the durable `user_question_awaits` record first, then delivered via the live agent socket (WS) or, failing that, by resuming the recorded job from the saved session tree. `awaiting_input` is cleared only after a delivery path succeeds; total failure returns `409` with the answers saved for retry (it does not falsely acknowledge). See [guide 08 — Durable user questions](../../docs/guide/08-workflow-runtime.md#durable-user-questions-ask_user_questions).
- `GET /workflows/runs/:runId/workspace/tree`
- `GET /workflows/runs/:runId/workspace/diff`

Additional live telemetry event types emitted into run streams:

- `bash_output` (`payload.stream`, `payload.chunk`, `payload.stepId`, `payload.containerId`)
- `workflow_control` (pause/resume/abort audit markers)
- `user_message` (manual operator prompt injections)
- `user_question_answers` (answers submitted for a parked `ask_user_questions` interaction)

## Domain Ownership Boundary

The API owns core orchestration runtime, workflow execution, telemetry, and generic scope/context contracts. Domain-specific board, backlog, resource publication, and lifecycle tooling belongs to the Kanban service and its contracts/MCP packages, not to API runtime special steps or internal tools.

## Multi-Tenant Scopes (Phases 0–4)

`scope_nodes.is_tenant_root` marks a node as a tenant/isolation boundary, orthogonal to its `type` (`platform | org | region | team | project`). `assertValidParentChildType` (`apps/api/src/scope/scope-typing.ts`) enforces the SDD §2.3 parent→child typing matrix in both `ScopeService.createNode` and `moveNode`, so a node can never nest under a type that disallows it. `role_assignments` is the single authorization authority — `user_roles` and JWT `roles` claims are never consulted for allow/deny decisions, and `AdminAccessIntegrityService` checks on every boot that no legacy `user_roles` grant is missing its backfilled root-scoped `role_assignments` row. Phase 2 adds a subtree-bound, hashed single-use invitation lifecycle with link-only delivery; Phase 3 layers an opt-in email delivery channel on top (see [Invitation email delivery](#invitation-email-delivery-smtp-phase-3) above). Phase 4 ships self-service org-hierarchy management: `PermissionsGuard` resolves `scopes:create` at `body.parentId` (no route param exists yet at create time), `archive`/`restore`/`move` route params are renamed `:id` → `:scopeId` so they gate at the target node's own subtree rather than the global root, `isTenantRoot: true` is rejected on any type other than `org`/`platform` (`createNode` and the new `updateNode`), and two new endpoints — `PATCH /scopes/:scopeId` (rename + tenant-boundary toggle) and `GET /scopes/:scopeId/allowed-child-types` (drives the web create-child type dropdown) — back the `OrgHierarchyManager` UI at `/scopes/:id/manage`. See [multi-tenant-scopes.md](../../docs/guide/multi-tenant-scopes.md) for the full writeup.

## Memory Backend Instrumentation

The `BackendInstrumentation` helper centralizes cross-backend metrics for the three memory backend services (`PostgresMemoryBackendService`, `HonchoMemoryBackendService`, `HonchoFallbackMemoryBackendService`). All 27 instrumented call sites route through `this.backendInstrumentation.recordWrite / recordRead / recordFallback / passthrough`, fanning out to the in-memory `MemoryMetricsService` mirror and the prom-client `MetricsService` mirror from a single call site. See [ADR-backend-instrumentation-helper-extraction.md](../../docs/architecture/decisions/ADR-backend-instrumentation-helper-extraction.md) and source at [apps/api/src/memory/backend-instrumentation.ts](src/memory/backend-instrumentation.ts).

## Project Goals & Goal Worklogs (EPIC-059)

Project goals are now first-class records (multi-goal, status tracked) with per-goal worklogs.

- `POST /projects` accepts optional `goals[]` payload for creation-time goals.
- Goal endpoints under `projects/:project-id/goals`
  - `GET /` with optional `?include_archived=true`
  - `POST /`
  - `PATCH /:goalId`
  - `PATCH /:goalId/status`
  - `PATCH /reorder`
  - `POST /:goalId/archive`
  - `POST /:goalId/unarchive`
- Worklog endpoints under `projects/:project-id/goals/:goalId/worklogs`
  - `GET /`
  - `POST /`

## Kanban Runtime Boundary

Kanban board state, lifecycle transitions, scheduling, realtime board sync, and
dispatch coordination are owned by the Kanban service and its runtime/tooling.
The API remains responsible for workflow orchestration primitives and run
telemetry. Keep Kanban lifecycle and board endpoint details in the Kanban docs.

## Runtime Feedback Diagnostics API

Runtime feedback diagnostics remain API-owned because they report workflow
runtime signals rather than board lifecycle behavior.

- `GET /runtime-feedback/diagnostics`
  - Supports optional query filters:
    - `signalType`: limit results to one runtime feedback signal type
    - `candidateCreated`: `true` or `false` candidate linkage filter
    - `limit`: page size, from `1` to `100` (default `20`)
    - `offset`: page offset (default `0`)
  - Returns signal counts, candidate counts, skipped-reason counts, total matching groups, and sparse recent groups.
  - Raw evidence, raw examples, and persisted diagnostics payloads are not returned.

## Agent Communication Mesh (EPIC-054)

The telemetry gateway now supports peer-assistance mesh actions for agents:

- Socket actions:
  - `mention_agent`
  - `check_agent_mentions`
  - `resolve_agent_thread`
- Mesh lifecycle event types include:
  - `agent_mention_requested`
  - `agent_mention_received`
  - `agent_mention_responded`
  - `agent_mention_timeout`
  - `agent_thread_resolved`
  - `agent_mention_denied`

## Agent Skills Management and Runtime Sync (EPIC-057)

AI config now includes filesystem-backed skill lifecycle APIs and profile assignment.

Storage model:

- Skill source of truth is the skills library directory at
  `NEXUS_SKILLS_LIBRARY_PATH` (default in compose: `/data/nexus-skills`).
- In docker compose, host path `NEXUS_HOST_SKILLS_PATH` is mounted into API at
  `/data/nexus-skills`.
- Each skill lives at `/data/nexus-skills/<skill-name>/SKILL.md` with optional
  additional files under the same directory.

- Skill CRUD:
  - `GET /ai-config/skills`
  - `GET /ai-config/skills/:id`
  - `POST /ai-config/skills`
  - `PATCH /ai-config/skills/:id`
  - `DELETE /ai-config/skills/:id`
- Skill file management:
  - `GET /ai-config/skills/:id/files`
  - `PUT /ai-config/skills/:id/files`
  - `DELETE /ai-config/skills/:id/files?path=<relative-path>`
- Profile skill assignment:
  - `GET /ai-config/agent-profiles/:id/skills`
  - `PUT /ai-config/agent-profiles/:id/skills`

Runtime behavior:

- Assigned skills are mounted into execution/subagent containers at the running
  harness's native skills directory (`HarnessCapabilities.skillsContainerPath`):
  `${CONTAINER_AGENT_DIR}/skills` (`/opt/harness-runtime/agent/skills`) for `pi`,
  `/root/.claude/skills` for `claude-code`. The harness scans that directory and
  injects the assigned skills into the system prompt itself (pi's
  `DefaultResourceLoader` → `<available_skills>`; Claude Code's personal-skills
  discovery), so `pi`/`claude-code` agents auto-detect skills with no extra tool.
- The runtime mount includes each assigned skill's full directory tree (not only
  `SKILL.md`), so referenced files are available at stable relative paths.
- For `pi`/`claude-code`, Nexus does NOT also render a skill-catalog prompt
  section — the harness's native injection is the single source of truth. Other
  harnesses fall back to the `skill_discovery_mode` prompt section
  (`native` listing vs `search` guidance).

Hybrid authoring/runtime model:

- The assigned-skills mount remains a read-only execution snapshot mounted at the
  harness's `skillsContainerPath`.
- Workflows and subagents can additionally request a governed host mount alias
  such as `skills_library` to access the persistent library rooted at
  `NEXUS_SKILLS_LIBRARY_PATH`.
- In docker compose, pass `NEXUS_HOST_SKILLS_PATH` into the API container so
  nested runner provisioning can remap `/data/nexus-skills/...` back to the
  host path when attaching `skills_library` mounts.
- Use `mode: ro` for inspection/reference workflows and `mode: rw` only when
  the host-mount policy explicitly allows authoring.

## CEO Restart Context Continuity (EPIC-058)

Project orchestration restart now includes state-aware context injection:

- `ProjectOrchestrationStartedEvent` includes:
  - `isRestart`
  - `stateSummary`
- Discovery workflow consumes `state_summary` and `is_restart` inputs for
  restart-aware prompting.

## Conversational Steering (EPIC-128)

> **Not yet implemented.** Documented endpoints (`/steering/plans`, `/workflow-runtime/steering/steer-project`, etc.) do not have corresponding controllers. Only `WorkflowRunSteeringService` (pause/resume/abort for workflow runs) exists.

## Workflow Graph and Status Unification (EPIC-060)

API now provides canonical graph read models used by web visualization and
status unification surfaces:

- `GET /workflows/runs/:runId/graph`
- `GET /workflows/:id/graph`

Node statuses are normalized server-side and returned with graph metadata so
clients do not need to reconstruct execution state from raw event streams.

## Git Worktree Sandboxing (EPIC-023)

EPIC-023 adds deterministic git worktree orchestration for isolated workflow-run
execution.

- Provisioning
  - Workflow-run callers may request a managed checkout for a neutral scope or
    context. The resolved path is derived from the configured worktree base and
    the scoped run identity.
  - Worktree base resolves by precedence:
    1. `NEXUS_WORKTREE_BASE_PATH` (legacy explicit override)
    2. `NEXUS_WORKSPACE_BASE_PATH/worktrees`
    3. `<repo>/data/worktrees`
  - Branch workflow:
    - Creates the target branch from the base branch (`git worktree add -b`) when
      the target does not yet exist.
    - Reuses an existing local branch when already present.
- Runtime mount behavior
  - Heavy-tier workflow containers automatically mount the managed checkout (if
    present) to `/workspace`.
  - This allows the agent to edit the branch checkout directly from inside the
    container.
  - Optional `NEXUS_WORKTREE_CONTAINER_USER` can be used to align host/container
    file ownership.
- Cleanup
  - Workflow-run cleanup removes managed checkout directories when the owning run
    no longer needs them.
  - On startup, `WorktreeReconcilerService` scans managed checkout directories
    and removes orphaned entries not tied to active workflow-run state.
  - Board lifecycle ownership lives outside the API runtime boundary; keep those
    transition rules in the board service docs.

## Workflow Reliability Hardening (EPIC-036)

High-level behavior changes added for run/idempotency and workspace safety:

- Trigger-context dedupe for active runs:
  - `startWorkflow` now reuses an existing active run for the same workflow + trigger context (`event`, `scopeId`, `contextId`, `status`).
  - A per-key in-process start lock reduces duplicate run creation races.
- Strict worktree validation before mount:
  - Existing worktree path resolution now requires path existence, git registration, and `.git` marker presence.
- Orphan cleanup expansion:
  - Worktree deletion removes filesystem orphans even when unregistered.
  - Reconciler sweeps both git-registered worktrees and filesystem-only managed directories.
- Engine modularization:
  - Job completion and DAG branch progression moved into `WorkflowRunJobExecutionService` plus utility helpers.
  - `WorkflowEngineService` remains responsible for workflow lifecycle entry points and start orchestration.

## Workflow Automation

Core API special step handlers cover platform-level orchestration primitives only. Domain lifecycle automation is owned outside the API runtime boundary.

- Active core special workflow step types (non-agent automation)
  - `run_command` — Executes an arbitrary shell command (`sh -c`) in a configurable
    working directory. Outputs `{ ok, exit_code, stdout, stderr, stdout_lines, timed_out }`.
    Default `working_dir` is `worktree` (auto-resolved via `GitPathService`).
  - `register_tool` — Registers dynamic tools in the tool registry.
  - `invoke_workflow` — Spawns and optionally waits for child workflows.
  - `emit_event` — Emits a NestJS EventEmitter2 event from a workflow step.
    Enables event-driven workflow-to-workflow chaining. Requires `inputs.event_name`.
- Tool output capture
  - Agent execution jobs may set `output_tool` to copy tool call arguments
    into `jobs.<jobId>.output` for branching and metadata recording.
- Removed/reserved special-step names remain blocked for plugin registration through the shared plugin SDK reserved list. Do not re-add removed domain-specific handlers under `apps/api/src`.

Behavior notes:

- Project specs (PRD/SDD) are stored on the `projects` table (`prd_markdown`, `sdd_markdown`) and viewable in the frontend Specs tab.
- Board lifecycle records, ranking fields, and bulk board mutations are owned by the Kanban service/runtime. Keep those contracts in Kanban docs, not in API runtime guidance.

## Provider Setup

Providers are configured via the web UI provider management page or through the AI config admin API (`/api/ai-config/providers`).

### API-key Provider Setup

API-key providers can be created with an **inline credential** (recommended for simplicity) or by referencing a **pre-created secret**.

#### Inline Credential (Recommended)

Supply the API key directly in the provider creation request. The secret is created automatically with the correct field name:

```json
{
  "name": "openai",
  "auth_type": "api_key",
  "base_url": "https://api.openai.com/v1",
  "credential": {
    "api_key": "sk-proj-...",
    "extra": {
      "OPENAI_ORG_ID": "org-..."
    },
    "headers": [
      {
        "name": "X-Custom-Header",
        "value": "{{OPENAI_ORG_ID}}"
      }
    ]
  },
  "is_active": true
}
```

**Field naming:** The API automatically derives the correct JSON key name:

- Known presets (OpenAI, Anthropic, Gemini, etc.): `<PROVIDER>_API_KEY`
- Custom/unknown providers: `API_KEY`

**Custom headers:** Header values can contain `{{KEY}}` placeholders, which are resolved at runtime from the encrypted secret. Resolved values remain encrypted and are never logged.

**Editing:** When updating, leave `credential.api_key` blank to keep the existing key, or supply a new value to rotate it.

#### Using a Pre-created Secret

Reference an existing secret by ID:

```json
{
  "name": "openai",
  "auth_type": "api_key",
  "secret_id": "a1b2c3d4-...",
  "base_url": "https://api.openai.com/v1",
  "is_active": true
}
```

The secret must contain a flat key map with the provider's expected API key field name:

```json
{
  "OPENAI_API_KEY": "sk-...",
  "OPENAI_ORG_ID": "org-..."
}
```

See [12a — Secret and Provider Setup](../../docs/guide/12a-secret-provider-setup.md) for detailed secret creation instructions and field-naming conventions.

### OAuth Provider Setup

OAuth providers are configured through the web UI:

1. Navigate to the provider management page.
2. Create or select a provider with `auth_type` set to `oauth`.
3. Configure OAuth fields: authorization URL, token URL, client ID, client secret (stored as a secret referenced by `oauth_client_secret_id`), scopes, and redirect URI.
4. Click **Connect** (or **Reconnect** if re-authorizing). The UI initiates the OAuth flow.
5. On callback, the API exchanges the authorization code for tokens and persists them into the linked secret as an encrypted JSON payload:

```json
{
  "oauth": {
    "accessToken": "...",
    "refreshToken": "...",
    "expiresAt": 4102444800000,
    "scope": "model.read model.write",
    "tokenType": "Bearer"
  }
}
```

The runtime token payload uses camelCase keys (`accessToken`, `refreshToken`, `expiresAt`) with optional `scope` and `tokenType` fields. All values are encrypted server-side in `secret_store`.

`pi-runner` does not initiate login. It consumes already-resolved OAuth credentials injected at container startup and can refresh tokens via provider metadata.

> **Note:** Inline credential creation is not yet supported for OAuth providers. OAuth client secrets must be pre-created via the secrets API.

### Provider References

Workflow steps, agent profiles, and other runtime configs reference providers using one of two patterns:

1. **Exact provider ID** — selects one provider record without fallback:

   ```json
   { "provider_id": "550e8400-e29b-41d4-a716-446655440000", "model": "gpt-4.1" }
   ```

2. **Separated source and name** — resolves within the current execution context:
   ```json
   { "provider_source": "global", "provider": "openai", "model": "gpt-4.1" }
   ```
   Valid `provider_source` values: `"global"`, `"user"`, `"scope"`.

`provider_id` wins if both are present. If `provider_source` is omitted, resolution uses the execution context then falls back to global.

> **See also:** these patterns are the _direct_ provider-reference mechanisms (per step / per run). The full runtime model selection precedence — workflow step override → agent profile → DB default model for use case → env fallback — is documented in [How runtime model selection reaches the resolver](../../docs/guide/memory-token-budget-resolver.md#how-runtime-model-selection-reaches-the-resolver).

### Provider Ownership

Providers are scoped configurable resources. The `owner_type` field (`global`, `user`, or `scope`) and optional `owner_id` determine visibility. Global providers have no `owner_id` and are available to all scopes unless a scoped provider overrides them by name.

## Workflow Runtime Inputs

Workflow execution accepts runtime inputs through `trigger_data`.

- `POST /workflows/:id/execute`
- Request body:

```json
{
  "trigger_data": {
    "customer": "acme",
    "priority": "high"
  }
}
```

- At run start, the engine stores this under `state_variables.trigger`.

## Step Input Templating

At step execution time, `steps[].inputs` values are template-resolved from run `state_variables`.

- Template syntax: `{{ scope.path }}` (for example: `{{ trigger.customer }}`)
- Resolution is recursive across strings nested in objects and arrays.
- Resolved values are applied to step runtime settings (`agent_profile`, `model`, `provider`, `system_prompt`).
- For `invoke_workflow` steps, resolved `inputs` are also forwarded into the child workflow trigger payload.

Example workflow snippet:

```yaml
steps:
   - id: decide
      type: review
      tier: light
      inputs:
         system_prompt: |
            Review request for customer {{ trigger.customer }} with priority {{ trigger.priority }}.
```

## Scoped Variable Store and Orchestration Policy

The **scoped variable store** (`/variables`) is a generic, Kanban-neutral key–value API for storing configuration at global or project scope.

### Data Model

- **`scoped_variables`** — stores key–value pairs with `key`, `value`, `scope`, `scope_id`.
- **`scoped_variable_audit`** (Phase 3) — logs all writes: `key`, `before_value`, `after_value`, `changed_at`, `changed_by`.

### Endpoints

#### Read effective configuration

```http
GET /api/variables/effective?scopeId=<project_id>
```

Returns merged configuration: global variables + project-scoped overrides. Scoped entries override global defaults.

**Example response:**

```json
{
  "autonomy.strategize": true,
  "autonomy.dispatch": false,
  "autonomy.ideation": true
}
```

#### Write a variable (scoped)

```http
POST /api/variables
Content-Type: application/json

{
  "key": "autonomy.dispatch",
  "value": false,
  "scope": "project",
  "scope_id": "<project_id>"
}
```

Validates key format (`autonomy\.*`, `mode` etc.) and value type (boolean, number, string).

#### Read audit history (Phase 3)

```http
GET /api/variables/audit?scopeId=<project_id>&key=autonomy.dispatch
```

Returns paginated audit entries: before, after, timestamp, changed_by.

**Example response:**

```json
{
  "total": 2,
  "entries": [
    {
      "key": "autonomy.dispatch",
      "before_value": true,
      "after_value": false,
      "changed_at": "2026-06-19T10:05:00.000Z",
      "changed_by": "system"
    },
    {
      "key": "autonomy.dispatch",
      "before_value": null,
      "after_value": true,
      "changed_at": "2026-06-19T10:00:00.000Z",
      "changed_by": "system"
    }
  ]
}
```

### Orchestration Policy

The **curated Orchestration Policy** defines 44 well-known keys (e.g., `autonomy.strategize`, `autonomy.ideation`) with safe defaults. The registry lives in `packages/kanban-contracts/src/orchestration-policy.schema.ts`.

Registry validation (ensuring only known keys are written with correct types) is enforced server-side by the Kanban `OrchestrationPolicyService` on mutation. The generic `/variables` API validates only key format and type.

**Key categories:**

- **Autonomy flags** (`autonomy.strategize`, `autonomy.dispatch`, `autonomy.ideation`): boolean; control whether the CEO phase runs fully autonomous or waits for approval.
- **Mode** (read-only, API-computed): snapshot of the effective preset at workflow start.
- **Defaults**: Global defaults are applied via `OrchestrationPolicyBackfillService` on Kanban startup; missing project-scoped keys inherit the global value.

## Testing

Run unit tests:

```bash
npm run test --workspace=apps/api
```

Run e2e tests:

```bash
npm run test:e2e --workspace=apps/api
```

### Integration tests and dedicated test database

Files matching `*.integration.spec.ts` connect to a real Postgres instance and are run via:

```bash
npm run test:integration --workspace=apps/api
```

**Integration specs are destructive** — some truncate tables such as `memory_segments` in their `beforeEach`. They must **never** run against the application (dev/prod) database. They are gated behind a dedicated env var:

```
INTEGRATION_TEST_DATABASE_URL=postgres://nexus:nexus_password@localhost:5433/nexus_orchestrator_it
```

- When `INTEGRATION_TEST_DATABASE_URL` is **not set**, all `*.integration.spec.ts` DB-dependent suites are automatically skipped. Running `npm run test --workspace=apps/api` on a dev machine is therefore safe: it cannot wipe live data.
- When `INTEGRATION_TEST_DATABASE_URL` **is set**, the tests connect to that URL only, and a runtime guard (`assertNotApplicationDatabase`) refuses to proceed if the connected database name matches the application DB (`DB_DATABASE` env, default `nexus_orchestrator`).
- In CI, provision a disposable Postgres database (e.g. `nexus_orchestrator_it`) and export `INTEGRATION_TEST_DATABASE_URL` pointing to it before running integration tests.

Run full live lifecycle e2e (external API + WebSocket + real provider configuration):

```bash
RUN_LIVE_E2E=true npm run test:e2e --workspace=apps/api
```

Live lifecycle e2e environment variables:

| Variable                                                      | Required             | Description                                                                   |
| ------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------- |
| RUN_LIVE_E2E                                                  | Yes (for live tests) | Enables live E2E test scenarios.                                              |
| E2E_API_URL                                                   | No                   | API base URL (default: `http://127.0.0.1:3010`).                              |
| E2E_WS_URL                                                    | No                   | WebSocket URL (default: `http://127.0.0.1:3011`).                             |
| JWT_SECRET or E2E_JWT_SECRET                                  | Yes                  | Admin/UI/agent JWT signing secret used by tests.                              |
| E2E_PROVIDER_API_KEY (or E2E_OPENAI_API_KEY / OPENAI_API_KEY) | Yes                  | Provider credential used to create encrypted AI secret via admin API.         |
| E2E_PROVIDER_SECRET_KEY                                       | No                   | Secret payload key name (default: `OPENAI_API_KEY`).                          |
| E2E_PROVIDER_SECRET_NAME                                      | No                   | Secret record name when seeding from env (default: `<provider>-seed-secret`). |
| E2E_PROVIDER_BASE_URL                                         | No                   | Optional provider base URL set in provider runtime env.                       |
| E2E_PROVIDER_NAME                                             | No                   | Override provider name generated by test.                                     |
| E2E_MODEL_NAME                                                | No                   | Override model name generated by test.                                        |
| E2E_AGENT_PROFILE_NAME                                        | No                   | Override agent profile name generated by test.                                |
| SEED_LLM_SECRET_FROM_ENV                                      | No                   | If `true`, DB startup seeds only `secret_store` from provider key env vars.   |

The live lifecycle e2e suite creates AI config objects (`/ai-config/secrets`, `/ai-config/providers`, `/ai-config/models`, `/ai-config/agent-profiles`), executes workflows that use those configs, validates DAG/decision/cycle/subagent behavior, then performs best-effort cleanup.
