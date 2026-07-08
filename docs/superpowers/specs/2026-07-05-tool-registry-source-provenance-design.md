# Tool Registry Source Provenance — Design

## Problem

The Tools page (`apps/web/src/pages/tools/`) renders every row from the `tool_registry`
table identically, whether it's a built-in capability (backed by a TS handler class
compiled into the API), a tool synced from an MCP/ACP server, or a genuinely
user-created custom tool. Opening any built-in tool in the edit dialog shows a
hardcoded placeholder TypeScript snippet (`DEFAULT_TS_SNIPPET`,
`apps/api/src/capability-infra/shared-capability-constants.ts`) that has no
relationship to the tool's real implementation. Editing and saving that snippet
has no effect — the tool still executes its real handler — which is confusing at
best and could lead someone to believe they've changed behavior they haven't.

There is no field on `tool_registry` / `IToolRegistry` that distinguishes how a
tool originated, so the web UI has no way to tell built-in from custom.

## Root cause

A `source` concept already exists in the backend
(`CanonicalCapabilitySource` in `apps/api/src/capability-infra/canonical-capability.types.ts`:
`'decorator_provider' | 'internal_tool_handler' | 'external_mcp' | 'external_acp' | 'manual'`)
and is computed correctly at registration time for every tool — but it is discarded
before reaching the database in two places:

1. `mapCapabilityEntryToToolRegistryPayload` (`apps/api/src/capability-infra/capability-manifest-to-tool-registry.mapper.ts`)
   takes a `CapabilityManifestEntry`, which doesn't carry `source` at all (the
   wrapping `CanonicalCapabilityDefinition` does, but it's unwrapped before this call).
2. `CapabilityRegistrarService.registerToolProjection()` (`apps/api/src/tool-registry/capability-registrar.service.ts`)
   receives a full `ToolProjectionRegistrationRequest { tool, source, sourceMetadata }`
   but only forwards `tool` to `ToolRegistryService.upsertTool()`.

Both the built-in seeding path (`tool-seeder.service.ts`) and the MCP/ACP sync paths
(`apps/mcp/mcp-runtime-manager.service.ts`, `apps/acp/acp-runtime-manager.service.ts`)
flow through `registerToolProjection()`, so fixing point 2 repairs all three
non-manual sources at once. The user-facing `POST /tools` create path
(`tool.controller.ts` → `ToolRegistryService.createTool()`) never had a `source`
concept — every API-created tool is implicitly manual today.

## Design

### 1. Data model

- New column on `tool_registry`: `source varchar(32) NOT NULL DEFAULT 'manual'`,
  values restricted to `CanonicalCapabilitySource`. Migration modeled on
  `apps/api/src/database/migrations/20260522152657-add-tool-registry-metadata.ts`
  (raw `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` / matching `DROP COLUMN IF EXISTS`
  in `down()`), registered in `registered-migrations.ts`, with a paired `.spec.ts`.
- `DEFAULT 'manual'` covers existing rows safely: genuinely custom tools are
  correctly manual, and built-in/MCP/ACP rows will be corrected to their real
  source automatically the next time each owning process reconciles (seeder
  re-upserts built-ins at every boot; MCP/ACP sync runs on its existing cycle).
  No manual data backfill script needed.
- Add `source: CanonicalCapabilitySource` to `IToolRegistry`
  (`packages/core/src/interfaces/workflow-legacy.types.ts`) as a server-set,
  read-only field. It must **not** be added to `createToolSchema` /
  `upsertToolSchema` (`packages/core/src/schemas/tools/tool-management-requests.schema.ts`)
  as writable input — a client must never be able to self-declare a tool as
  built-in.

### 2. Backend threading

- `mapCapabilityEntryToToolRegistryPayload`: change its input type from
  `CapabilityManifestEntry` to `CanonicalCapabilityDefinition` (the entry is
  already available at every call site) and include `source` in the returned
  payload.
- `CapabilityRegistrarService.registerToolProjection()`: stop discarding
  `source`/`sourceMetadata` — merge `source` onto the payload passed to
  `ToolRegistryService.upsertTool()`. (`sourceMetadata` is not persisted in this
  change; only `source` is needed for the UI distinction. Revisit if a future
  need for structured provenance metadata arises.)
- `ToolRegistryService.createTool()`: force `source: 'manual'` on every row it
  creates, ignoring any `source` present on the inbound DTO (there won't be one,
  since it's not in the schema, but the service must not trust a payload that
  somehow includes it either).

### 3. Frontend

- `Tool` type (`apps/web/src/lib/api/types.ts`, re-exporting `IToolRegistry`)
  picks up `source` automatically.
- `ToolsListSection.tsx`: add a badge column mapping `source` →
  - `manual` → "Custom"
  - `decorator_provider` / `internal_tool_handler` → "Built-in"
  - `external_mcp` → "MCP"
  - `external_acp` → "ACP"
- Row click / row actions: `manual` tools keep today's behavior unchanged
  (opens `EditToolDialog` → editable `ToolForm`). Non-`manual` tools open a new
  **read-only view** instead — same field layout, but rendered inert, and the
  code section replaced with a short note instead of the fake snippet:
  - `decorator_provider` / `internal_tool_handler` → "Implemented in code."
  - `external_mcp` → "Synced from MCP server: `<mcp_server_id>`."
  - `external_acp` → "Synced from ACP server."
    `CreateToolDialog` is unaffected — it only ever creates `manual` tools.

### 4. Testing

- Backend: unit tests for `mapCapabilityEntryToToolRegistryPayload` (source
  passed through), `registerToolProjection` (source no longer dropped, covers
  built-in/MCP/ACP call shapes), `ToolRegistryService.createTool()` (always
  stamps `manual` regardless of input), and the migration's `up`/`down` SQL.
- Frontend: `ToolsListSection` badge rendering per `source` value; tool detail
  view renders read-only for non-`manual` and editable for `manual`.

## Out of scope

- No change to how built-in tools execute — `typescript_code` continues to hold
  the placeholder for non-`manual` rows; the UI simply stops surfacing it as
  editable/authoritative.
- No retroactive backfill script; relies on existing reconciliation cycles.
- No persistence of `sourceMetadata` in this change.
