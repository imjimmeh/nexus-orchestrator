---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: acp
outcome: success
inferred_status: implemented
confidence_score: 0.92
evidence_refs:
  - apps/api/src/acp/acp.module.ts
  - apps/api/src/acp/acp.controller.ts
  - apps/api/src/acp/acp.service.ts
  - apps/api/src/acp/acp-runtime-manager.service.ts
  - apps/api/src/acp/acp-http.client.ts
  - apps/api/src/acp/acp-http-client.types.ts
  - apps/api/src/acp/acp-filter.utils.ts
  - apps/api/src/acp/acp-message.utils.ts
  - apps/api/src/acp/acp-runtime.constants.ts
  - apps/api/src/acp/acp-schema.utils.ts
  - apps/api/src/acp/acp-tool-name.utils.ts
  - apps/api/src/acp/database/entities/acp-server.entity.ts
  - apps/api/src/acp/database/entities/acp-discovered-agent.entity.ts
  - apps/api/src/acp/database/repositories/acp-server.repository.ts
  - apps/api/src/acp/database/repositories/acp-discovered-agent.repository.ts
  - apps/api/src/acp/__tests__/acp.controller.spec.ts
  - apps/api/src/acp/__tests__/acp.service.spec.ts
  - apps/api/src/acp/__tests__/acp-http.client.spec.ts
  - apps/api/src/acp/__tests__/acp-runtime-manager.service.spec.ts
  - apps/api/src/common/plugin-runtime/base-plugin-runtime-manager.service.ts
  - packages/core/src/interfaces/acp.types.ts
  - packages/core/src/schemas/acp/acp-server.schema.ts
  - apps/api/src/app.module.ts
source_paths:
  - apps/api/src/acp
updated_at: 2026-06-15T17:30:00.000Z
---

# Probe Result: Agent Communication Protocol (ACP)

## Narrative Summary

The Agent Communication Protocol (ACP) scope is fully implemented as a first-class feature in
`apps/api/src/acp/`. The module provides an HTTP-based runtime that discovers, registers, and
invokes agents exposed by external ACP servers, integrates them into Nexus as tools via the
capability-registrar system, and persists configuration in TypeORM. The implementation is
registered in `AppModule`, reuses a shared `BasePluginRuntimeManagerService` abstraction with the
MCP runtime, and exposes a complete CRUD/test/reload/invoke REST surface under
`/api/acp/...` guarded by JWT + `RequirePermission` decorators. Type-level contracts and Zod
schemas live in `@nexus/core` (`acp.types.ts` and `schemas/acp/acp-server.schema.ts`) and are
re-exported through `packages/core/src/schemas/index.ts`. Frontend hooks and forms in
`apps/web/src/hooks/useAcpServers.ts`, `apps/web/src/pages/settings/AcpServerFormDialog.tsx`, and
`apps/web/src/pages/Settings.tsx` consume the API.

## Capability Updates

**Server Lifecycle (CRUD + reload)**
- `AcpController` (`acp.controller.ts`): REST endpoints under `/api/acp` for list, create, patch,
  delete, test, reload-single, reload-all, list-discovered-agents, get-manifest, and invoke.
  All routes guarded by `JwtAuthGuard` + `PermissionsGuard` and tagged with `@ApiTags('acp')`
  + `@ApiBearerAuth()`.
- Permission model uses `'agents:read'` for read/invoke paths and `'agents:manage'` for
  administrative mutations; consistent with how the MCP scope secures its endpoints.
- `AcpService` (`acp.service.ts`): orchestrates `AcpServerRepository`,
  `AcpDiscoveredAgentRepository`, `AcpRuntimeManagerService`, and
  `SecretReferenceResolver`. Builds create/update payloads with normalization helpers
  (`normalizeHeaders`, `normalizeStringArray`, `normalizeNullableString`,
  `assignIfDefined`, `assignDirectValues`) from `common/utils/server-payload.utils.ts` and
  validates `name`/`url` before persistence.

**Runtime Manager (Discovery, Sync, Invocation)**
- `AcpRuntimeManagerService` extends `BasePluginRuntimeManagerService<AcpServer, AcpAgentManifest,
  IAcpReloadResult, IAcpReloadServerResult, IAcpServerTestResult>` and implements
  `OnApplicationBootstrap` to eagerly `reloadAllServers()` on startup.
- `discoverItemsWithRetry()` performs `listAgents()` with up to `max_retries` retries and
  linear backoff of `retry_backoff_ms * (attempt + 1)`, then applies
  `filterAcpAgents(agents, include_agents, exclude_agents)`.
- `syncDiscoveredAgents()` reconciles server state with the `tool_registry` table: registers a
  tool projection for each discovered agent under a hashed registry name
  (`buildAcpRegistryToolName` → `acp:<namespace>_<sanitized>_<8-char-hash>`), upserts the
  `acp_discovered_agents` row, and prunes tools whose names no longer appear in the agent set.
- `executeRun()` supports `AcpRunMode.SYNC` (poll up to 60 × 1s), `ASYNC` (return run_id
  immediately), and `AWAITING` handling with `await_policy` (SURFACE_TO_USER | AUTO_RESUME |
  FAIL). `createRunStreaming()` returns an `AsyncIterable<AcpEvent>` parsed via an SSE handler.
- Event ledger emits `acp.invoke.succeeded`, `acp.invoke.failed`, `acp.reload.succeeded`, and
  `acp.reload.failed` for observability; prometheus metrics
  (`nexus_acp_invoke_duration_seconds`, `nexus_acp_invoke_total`) cover invocation.

**HTTP Client (Transport)**
- `AcpHttpClient` (`acp-http.client.ts`): REST endpoints for `ping`, `listAgents(limit?, offset?)`,
  `getAgent(name)`, `createRun`, `createRunStreaming` (SSE), `getRun`, `resumeRun`, `cancelRun`,
  `listRunEvents`, `getSession`. Uses shared HTTP utilities (`common/http/http-client.utils.ts`)
  and an `AcpAuthType → HttpAuthType` mapping. URL building uses `encodeURIComponent` for agent
  names; query strings built via `buildUrl(... , params)`.

**Domain Models & Persistence**
- `AcpServer` entity (`acp_servers` table) with indexes on `enabled` and `last_status`. Columns
  cover: `id`, `name` (unique), `enabled`, `url`, `auth_type` (enum), `auth_token` (text,
  nullable), `auth_secret_id` (uuid, nullable), `headers` (jsonb), `headers_secret_id` (uuid,
  nullable), `timeout_ms`, `connect_timeout_ms`, `max_retries`, `retry_backoff_ms`,
  `default_run_mode`, `await_policy`, `include_agents`, `exclude_agents`, plus `last_status`,
  `last_error`, `last_connected_at`, `last_discovered_at`, `last_discovered_agent_count`,
  `created_at`, `updated_at`.
- `AcpDiscoveredAgent` entity (`acp_discovered_agents`) with FK to `AcpServer` (CASCADE on
  delete), indexes on `server_id` and `registry_tool_name`, and unique constraint on
  `registry_tool_name`.
- `AcpServerRepository` / `AcpDiscoveredAgentRepository` provide `findAll`/`findEnabled`/
  `findById`/`create`/`update`/`remove` and `findByServerId`/`findByRegistryToolName`/
  `findRegisteredByServerId`/`upsertByServerAndAgentName`/`deleteByServerId`/
  `updateRegistrationStatus`. The repositories are wired into `DatabaseModule` and re-exported
  via `database/entities/index.ts` and `database/repositories/index.ts`.
- Migration `20260604010718-add-secret-references-to-mcp-acp-servers.ts` adds the
  `auth_secret_id` / `headers_secret_id` columns and indexes to `acp_servers`; pre-existing
  baseline migration `20260517000000-api-post-cutover-baseline.ts` creates the
  `acp_servers` / `acp_discovered_agents` tables and their enums.

**Security Integration**
- `SecretReferenceResolver` (`security/secret-reference-resolver.service.ts`) is invoked by
  `AcpService` to: `assertSecretExists(secretId, purpose)` on create/update, `resolveString`
  for the outgoing `auth_token`, and `resolveMap` for the outgoing `headers`. Service responses
  pass through `redactServer` to drop plaintext values whenever the secret FK is set.
- `SecuritySecretUsageLookup` (`security/secret-usage-lookup.service.ts`) treats ACP servers as
  `'acp_server'` references for orphan-secret detection.

**Capability/Plugin-Runtime Integration**
- `buildAcpRegistrySchema()` (`acp-schema.utils.ts`) and the shared
  `common/plugin-runtime/plugin-schema.utils.ts` produce registry schemas with an
  `x-nexus-acp` extension (server_id, server_name, agent_name, registry_tool_name) and
  normalize input content types via `normalizeAcpInputSchema`.
- `CapabilityRegistrarService.registerToolProjection` is called with
  `source: 'external_acp'` (the `CanonicalCapabilitySource` variant declared in
  `capability-infra/canonical-capability.types.ts`) and `sourceMetadata: { server_id,
  agent_name }`. The tool is registered with the bridge stub code
  `ACP_TOOL_BRIDGE_TYPESCRIPT_CODE` (no-op) and an `api_callback` of
  `POST /api/acp/servers/{serverId}/agents/{agentName}/invoke` (built via
  `buildAcpInvokePath` from `common/plugin-runtime/plugin-tool-name.utils.ts`).

**Module Wiring**
- `AcpModule` imports `AuthorizationModule`, `DatabaseModule`, `ToolRegistryModule`; declares
  `AcpController` and providers `AcpService` + `AcpRuntimeManagerService`; exports the
  service pair.
- `apps/api/src/app.module.ts` registers `AcpModule` in the root imports.

**Shared Type Contracts & Validation**
- `packages/core/src/interfaces/acp.types.ts`: enums `AcpTransportType`, `AcpServerStatus`,
  `AcpRunStatus`, `AcpRunMode`, `AcpAuthType`, `AcpAwaitPolicy`; interfaces for `IAcpServer`,
  `IAcpDiscoveredAgent`, `IAcpServerTestResult`, `IAcpReloadResult`, `IAcpReloadServerResult`,
  `IAcpInvokeAgentResult`, `IAcpRunResult`, `AcpMessage`, `AcpAgentManifest`, `AcpRun`,
  `AcpRunCreateRequest`, `AcpRunResumeRequest`, `AcpEvent`, `AcpSession`, `AcpError`.
- `packages/core/src/schemas/acp/acp-server.schema.ts`: Zod schemas `CreateAcpServerSchema`,
  `UpdateAcpServerSchema` (partial of create), `InvokeAcpAgentSchema`; UUID-validated
  `SecretIdSchema` for `auth_secret_id` / `headers_secret_id`. Re-exported through
  `packages/core/src/schemas/index.ts` and the ACP `index.ts`.

**Web UI Integration**
- `apps/web/src/hooks/useAcpServers.ts`: React Query hooks `useAcpServers`,
  `useCreateAcpServer`, `useUpdateAcpServer`, `useDeleteAcpServer`, `useTestAcpServer`,
  `useReloadAcpServer`, `useReloadAcpServers`, `useAcpDiscoveredAgents`.
- `apps/web/src/pages/settings/AcpServerFormDialog.tsx` and `AcpServersCard.tsx` provide a
  create/edit modal and a tab in the settings page (`pages/Settings.tsx` adds the
  `<TabsTrigger value="acp">ACP Servers</TabsTrigger>`).

## Health Findings

**Test Coverage** (4 spec files co-located in `apps/api/src/acp/__tests__/`)
- ✅ `acp.controller.spec.ts` — covers listServers, createServer, updateServer, deleteServer,
  testServer, reloadServer, reloadAllServers, listDiscoveredAgents, getAgentManifest, and
  invokeAgent (including the `run_mode` override path). All controller methods are
  validated end-to-end through their service mocks.
- ✅ `acp.service.spec.ts` — covers list/create/update/delete server, includes negative paths
  (`BadRequestException` for blank name/url, `NotFoundException` for unknown server/agent),
  the `auth_secret_id` / `headers_secret_id` validation and redaction paths, and the
  `resolveAuthTokenForServer` / `resolveHeadersForServer` delegations.
- ✅ `acp-runtime-manager.service.spec.ts` — covers `reloadAllServers` (success, disabled
  prune), `reloadServer` (success, not-found), `testServer` (success, failure), `invokeAgent`
  (success, disabled-server rejection, run-mode override), `removeAgentsForServer`, and the
  include/exclude filter pass-through to `discoverItemsWithRetry`.
- ✅ `acp-http.client.spec.ts` — covers `ping`, `listAgents` (with/without pagination), `getAgent`
  (incl. URL encoding of `test/agent`), `createRun`, `getRun`, `resumeRun`, `cancelRun`,
  `listRunEvents`, `getSession`, all three auth types (BEARER/API_KEY/NONE), custom-header
  merge, timeout enforcement, and SSE parse paths.

**Strengths**
- Follows the same architectural pattern as the MCP scope (controller → service → runtime
  manager → transport), enabling shared base classes (`BasePluginRuntimeManagerService`) and
  shared `plugin-runtime` utilities (`plugin-schema.utils.ts`, `plugin-tool-name.utils.ts`,
  `plugin-filter.utils.ts`, `plugin-transport.interface.ts`).
- TypeORM entities use `ManyToOne(... onDelete: 'CASCADE')` to keep discovered-agent rows
  consistent with their parent server.
- Secret-by-reference contract is uniform with the MCP scope (same `AddSecretReferences...`
  migration and the shared `SecretReferenceResolver`), preventing plaintext leak via API
  responses via `redactServer`.
- Streaming support (`createRunStreaming` + SSE parser) is present even though the
  controller does not yet expose a `mode: 'stream'` invoke variant.
- Capability governance is integrated (`source: 'external_acp'`) so the discovered agents
  appear alongside other tools in the registry.

**Gaps / Churn Signals**
- `acp-message.utils.ts` and `acp-filter.utils.ts` are exercised indirectly but have no
  dedicated unit spec files; edge cases (regex wildcard, empty include/exclude,
  multi-line message content) are not explicitly covered.
- `acp-schema.utils.ts` and `acp-tool-name.utils.ts` likewise have no spec files; the
  sanitization/hashing/registry-path logic is exercised only via higher-level tests.
- `acp-server.repository.ts` and `acp-discovered-agent.repository.ts` have no spec files;
  the TypeORM behaviour is currently only covered through service-level mocks.
- No E2E or integration tests for ACP found in `apps/api/test/` or
  `packages/e2e-tests/src/` (e.g. scenarios that spin up a fake ACP HTTP server and verify
  end-to-end reload + invoke).
- The codebase-health note (`docs/project-context/CODEBASE_HEALTH.md`) previously marked ACP
  as "not yet probed (NEW)"; this probe replaces that marker with a fully assessed status.
- `auth_token` and `headers` columns are still persisted alongside the secret FK columns
  rather than being dropped; the redaction contract keeps them out of API responses but they
  remain in the DB schema.
- Streaming invoke is implemented at the HTTP-client layer (`createRunStreaming`) but the
  controller/service currently expose only `async`/`sync` paths. No invocation of the SSE
  iterator is wired through.

## Open Questions

1. **Streaming invoke path**: `AcpHttpClient.createRunStreaming` exists and parses SSE, but the
   service/controller only forward `AcpRunMode.SYNC`/`ASYNC`. Is the streaming invoke path
   intentionally deferred, or is there a planned route (e.g. a `runMode === 'stream'`
   controller variant that returns an `AsyncIterable` over WebSocket / SSE)?
2. **Local process transport**: `apps/api/src/common/plugin-runtime/plugin-transport.interface.ts`
   documents an ACP local/STDIO transport as a future possibility and the `AcpTransportType`
   enum currently only declares `HTTP`. Is the local/stdio code path planned but not yet
   implemented, or is the transport permanently HTTP-only?
3. **MCP bridge**: `docs/architecture/acp.md` mentions "MCP Bridge" as a kind of ACP server
   (translating MCP to ACP), but no concrete class implements this translation. Is this
   still on the roadmap?
4. **Repository test coverage**: `acp-server.repository.ts` and `acp-discovered-agent.repository.ts`
   have no spec files; the `upsertByServerAndAgentName` find-then-update logic and the unique
   `registry_tool_name` constraint are not directly tested.
5. **E2E coverage**: No ACP scenarios were found in `apps/api/test/` or
   `packages/e2e-tests/src/`. The closest comparable scope (MCP) also has no e2e scenarios
   according to the e2e-tests probe; should the parent workflow add a fake ACP server
   fixture?
6. **Schema/tool-name utility unit tests**: `acp-schema.utils.ts`, `acp-tool-name.utils.ts`,
   `acp-filter.utils.ts`, and `acp-message.utils.ts` are currently covered transitively.
   Explicit unit tests would help with regression coverage on registry-name collisions
   and schema-extension fields.
7. **ACP bridge stub behaviour**: `ACP_TOOL_BRIDGE_TYPESCRIPT_CODE` returns `{ ok: true }` as a
   no-op. Is there an explicit plan for the runtime to dispatch the real ACP call when the
   projected tool is invoked, and how is the caller's `params` mapped onto the `message`
   payload?
