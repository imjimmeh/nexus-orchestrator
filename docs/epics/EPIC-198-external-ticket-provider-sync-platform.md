# EPIC-198: External Ticket Provider Sync Platform

**Status:** Proposed
**Priority:** P1
**Created:** 2026-06-02
**Updated:** 2026-06-02
**Owner:** Kanban Domain
**Parent:** None
**Depends on:** None
**Related:** EPIC-188 (Plugin Platform — future migration path for provider adapters), EPIC-167 (Kanban Orchestration)

## Summary

Build a provider-adapter-based external ticket sync platform in the kanban service that supports bidirectional synchronization of work items with external issue trackers (Jira, GitHub Issues, Linear, etc.). The system provides a pure abstraction layer with no concrete provider implementations in this epic, enabling future providers to be added by implementing a well-defined interface.

## Problem Statement

Nexus kanban work items exist in isolation. Teams using external issue trackers (Jira, GitHub, Linear) must manually duplicate or migrate tickets, leading to stale data, lost context, and operational overhead. There is no mechanism to:

- Import tickets from external systems into Nexus work items
- Push Nexus work item changes back to external systems
- Keep both systems in sync in real time via webhooks or polling
- Configure per-project connections to multiple external providers

## Goals

- Design and implement a provider-agnostic adapter interface (`IExternalTicketProvider`) for external ticket systems
- Support bidirectional sync (inbound: external → Nexus, outbound: Nexus → external) with configurable sync mode per connection
- Support both webhook-driven and polling-based inbound sync with automatic fallback
- Implement external-wins conflict resolution as the default strategy
- Map synced external tickets to native kanban work items with an external reference in metadata
- Provide REST API for managing connections, triggering manual import/export, and monitoring sync status
- Maintain a full audit trail of all sync operations
- Support per-project connections with independent configuration

## Non-Goals

- Implementing any concrete provider (Jira, GitHub Issues, Linear) in this epic
- Public marketplace or plugin registry for providers
- Real-time streaming sync (webhook and polling intervals are sufficient)
- Syncing comments, attachments, or time tracking in this epic
- Multi-tenant or cross-project ticket relationships
- Migrating providers to the plugin platform (EPIC-188) in this epic

## Architecture

### Module Location

New dedicated NestJS module: `apps/kanban/src/external-sync/`

This module depends on `WorkItemModule` (for work item CRUD), `DatabaseModule` (for entities and repositories), and `KanbanRedisModule` (for BullMQ scheduling).

### Directory Structure

```
external-sync/
  providers/
    external-ticket-provider.interface.ts   // IExternalTicketProvider + types
    provider-registry.service.ts            // resolves provider_type → adapter
    null-provider.ts                        // testing / no-op fallback
  sync-engine/
    sync-coordinator.service.ts             // top-level sync orchestration
    inbound-sync.service.ts                 // external → nexus work items
    outbound-sync.service.ts                // nexus work items → external
    conflict-resolver.service.ts            // external-wins default strategy
    field-mapper.service.ts                 // maps fields via connection config
  transport/
    webhook-receiver.controller.ts          // POST webhook endpoint
    polling-scheduler.service.ts            // BullMQ repeatable jobs
  external-sync.module.ts
  external-sync.controller.ts              // CRUD + manual import/export
```

### Data Model

**`kanban_external_connections`** — one row per project-provider link:

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | Connection identifier |
| `project_id` | UUID | FK → kanban_projects |
| `provider_type` | varchar(64) | "jira", "github", "linear", etc. |
| `display_name` | varchar(255) | Human-readable name |
| `config` | JSONB | Provider-specific config (host, project key, board ID, etc.) |
| `credentials_secret_id` | varchar nullable | Reference to core API secret_store |
| `sync_mode` | varchar(32) | "bidirectional", "inbound", "outbound" |
| `sync_transport` | varchar(32) | "webhook", "polling", "both" |
| `polling_interval_seconds` | integer nullable | Polling cadence |
| `webhook_secret` | varchar nullable | For verifying inbound webhook signatures |
| `field_mapping` | JSONB nullable | External field → work item field mapping |
| `status_mapping` | JSONB nullable | External status → kanban status mapping |
| `is_active` | boolean | Whether sync is currently active |
| `last_sync_at` | timestamp nullable | Last successful sync timestamp |
| `last_sync_error` | text nullable | Last error message |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

**`kanban_sync_operation_log`** — audit trail:

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | |
| `connection_id` | UUID | FK → kanban_external_connections |
| `project_id` | UUID | Denormalized for query efficiency |
| `direction` | varchar(16) | "inbound", "outbound" |
| `operation` | varchar(32) | "create", "update", "delete", "link" |
| `external_id` | varchar(255) | Ticket ID in the external system |
| `work_item_id` | UUID nullable | Linked kanban work item |
| `status` | varchar(32) | "pending", "completed", "failed", "conflict_resolved" |
| `error_detail` | text nullable | Error message on failure |
| `created_at` | timestamp | |

**Work item metadata** — synced work items carry sync state in their existing `metadata` JSONB column under an `external_sync` key:

```json
{
  "external_sync": {
    "connection_id": "uuid",
    "provider_type": "jira",
    "external_id": "PROJ-123",
    "external_url": "https://jira.example.com/browse/PROJ-123",
    "external_updated_at": "2026-06-01T12:00:00Z",
    "last_synced_at": "2026-06-02T10:00:00Z"
  }
}
```

No migration needed on `kanban_work_items`.

### Provider Adapter Interface

The core abstraction is `IExternalTicketProvider`:

```ts
interface ProviderCapabilities {
  supportsWebhooks: boolean;
  supportsPolling: boolean;
  supportsCreate: boolean;
  supportsUpdate: boolean;
  supportsDelete: boolean;
  supportsComments: boolean;
  supportsAttachments: boolean;
}

interface ExternalTicket {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  assignee: string | null;
  labels: string[];
  url: string | null;
  updatedAt: string;
  rawFields: Record<string, unknown>;
}

interface ExternalTicketChangeEvent {
  connectionId: string;
  externalId: string;
  action: "created" | "updated" | "deleted";
  ticket: ExternalTicket | null;
  timestamp: string;
  rawPayload: unknown;
}

interface PaginatedResult<T> {
  items: T[];
  hasMore: boolean;
  cursor: string | null;
}

interface IExternalTicketProvider {
  readonly providerType: string;
  getCapabilities(): ProviderCapabilities;

  fetchTickets(config: ProviderConfig, options: FetchOptions): Promise<PaginatedResult<ExternalTicket>>;
  fetchTicket(config: ProviderConfig, externalId: string): Promise<ExternalTicket | null>;

  createTicket(config: ProviderConfig, ticket: OutboundTicket): Promise<ExternalTicket>;
  updateTicket(config: ProviderConfig, externalId: string, patch: Partial<OutboundTicket>): Promise<ExternalTicket>;
  deleteTicket(config: ProviderConfig, externalId: string): Promise<void>;

  validateWebhookSignature(config: ProviderConfig, payload: unknown, signature: string): boolean;
  parseWebhookEvents(config: ProviderConfig, payload: unknown): ExternalTicketChangeEvent[];

  validateConfig(config: ProviderConfig): Promise<ConfigValidationResult>;
}
```

Concrete providers register via the NestJS injection token `EXTERNAL_TICKET_PROVIDER`. A `ProviderRegistry` service resolves `provider_type` string to the registered adapter instance.

### Sync Flows

#### Inbound (External → Nexus)

**Webhook path:**
1. `WebhookReceiverController` receives `POST /external-sync/webhook/:connectionId`
2. Loads connection config, resolves provider via `ProviderRegistry`
3. Validates signature via `IExternalTicketProvider.validateWebhookSignature()`
4. Parses events via `IExternalTicketProvider.parseWebhookEvents()`
5. Feeds events to `InboundSyncService.processInboundEvent()`

**Polling path:**
1. `PollingSchedulerService` creates BullMQ repeatable jobs per active connection
2. Each job loads config, resolves provider, calls `fetchTickets()` with last-sync cursor
3. Feeds results to `InboundSyncService`

**InboundSyncService:**
1. Looks up existing work item by `external_sync.external_id` in metadata
2. If not found: creates new work item via `WorkItemService.createWorkItem()` with sync metadata
3. If found: applies field mapping, runs conflict resolution, updates via `WorkItemService.updateWorkItem()`
4. For deletes: removes the work item or marks it (configurable)
5. Logs operation to `kanban_sync_operation_log`

#### Outbound (Nexus → External)

1. `OutboundSyncService` subscribes to `KanbanLifecycleEventPublisher` status-changed events
2. Checks if the changed work item has `external_sync` metadata
3. Resolves provider, calls `IExternalTicketProvider.updateTicket()` with mapped fields
4. Logs operation to `kanban_sync_operation_log`

#### Conflict Resolution

Default strategy: **external-wins**. When both systems modified the same field:
1. Compare Nexus `updated_at` with external `updatedAt`
2. If external timestamp is newer, external value wins
3. Log as `status: "conflict_resolved"` in sync operation log with details

### REST API

All endpoints on kanban service (port 3012):

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/projects/:projectId/external-connections` | Create connection |
| `GET` | `/projects/:projectId/external-connections` | List connections |
| `GET` | `/projects/:projectId/external-connections/:id` | Get connection |
| `PATCH` | `/projects/:projectId/external-connections/:id` | Update connection |
| `DELETE` | `/projects/:projectId/external-connections/:id` | Delete connection |
| `POST` | `/projects/:projectId/external-connections/:id/test` | Validate config + credentials |
| `POST` | `/projects/:projectId/external-connections/:id/sync` | Trigger manual full sync |
| `POST` | `/projects/:projectId/external-connections/:id/import` | One-time bulk import |
| `POST` | `/projects/:projectId/external-connections/:id/export` | One-time bulk export |
| `POST` | `/projects/:projectId/external-connections/:id/pause` | Pause sync |
| `POST` | `/projects/:projectId/external-connections/:id/resume` | Resume sync |
| `GET` | `/projects/:projectId/external-connections/:id/operations` | Get sync operation log |
| `POST` | `/external-sync/webhook/:connectionId` | Webhook receiver (signature-validated) |

### Error Handling

- Provider API failures: logged to `kanban_sync_operation_log` with `status: "failed"`, connection `last_sync_error` updated, no service crash
- Webhook signature validation failure: 401 response, logged as warning
- Rate limiting: providers expose rate limit headers; `SyncCoordinator` applies exponential backoff
- Credential expiry: `test` endpoint validates credentials; auth errors during sync flag the connection
- All provider calls wrapped in try/catch with configurable timeout

### Module Wiring

`ExternalSyncModule` imports:
- `WorkItemModule` (for work item CRUD)
- `DatabaseModule` (entities and repositories)
- `KanbanRedisModule` (BullMQ for polling scheduler)

`ExternalSyncModule` exports:
- `ExternalSyncService` (for other modules to trigger sync programmatically)
- `ProviderRegistry` (for future MCP tool integration)

`AppModule` registers `ExternalSyncModule` alongside existing modules.

## Implementation Phases

### Phase 1: Foundation — Provider Interface and Registry

- Define `IExternalTicketProvider` interface and all associated types
- Implement `ProviderRegistry` service with NestJS multi-provider injection
- Implement `NullProvider` for testing
- Write comprehensive unit tests for registry resolution

### Phase 2: Data Layer — Entities, Repositories, Migration

- Create `KanbanExternalConnectionEntity` and `KanbanSyncOperationLogEntity`
- Create corresponding repositories
- Register entities and repositories in `DatabaseModule`
- Write TypeORM migration

### Phase 3: Connection Management API

- Implement `ExternalSyncController` with connection CRUD endpoints
- Zod validation on all DTOs
- Connection test endpoint
- Unit and integration tests

### Phase 4: Inbound Sync Engine

- Implement `InboundSyncService` (create/update/delete work items from external tickets)
- Implement `FieldMapperService` (maps external fields to work item fields via connection config)
- Implement `ConflictResolverService` (external-wins strategy)
- Implement `SyncCoordinatorService` (orchestrates inbound flows)
- Unit tests with mock provider

### Phase 5: Webhook Transport

- Implement `WebhookReceiverController` with signature validation
- Wire to `InboundSyncService`
- Integration tests with mock payloads

### Phase 6: Polling Transport

- Implement `PollingSchedulerService` using BullMQ repeatable jobs
- Schedule/pause/resume polling per connection
- Wire to `InboundSyncService`
- Unit tests

### Phase 7: Outbound Sync Engine

- Implement `OutboundSyncService`
- Subscribe to `KanbanLifecycleEventPublisher` events
- Filter for work items with `external_sync` metadata
- Push changes to external provider via adapter
- Unit tests

### Phase 8: Manual Import and Export

- Bulk import: fetch all tickets from provider, create work items in batches
- Bulk export: push all project work items to external provider
- Manual sync trigger: full bidirectional reconciliation
- Integration tests

## Acceptance Criteria

- `IExternalTicketProvider` interface is defined with all required methods and types
- `ProviderRegistry` resolves `provider_type` strings to registered adapter instances
- `NullProvider` passes all interface contract tests
- Connection CRUD API supports create, read, update, delete, test, pause, resume
- Inbound sync creates, updates, and deletes work items based on external ticket changes
- Outbound sync pushes work item changes to external providers when lifecycle events fire
- Webhook receiver validates signatures and parses provider-specific payloads via adapter
- Polling scheduler runs per-connection BullMQ jobs at configured intervals
- Conflict resolution applies external-wins strategy and logs resolution details
- Field mapping translates external statuses and fields to kanban equivalents
- All sync operations are logged to `kanban_sync_operation_log`
- Bulk import and export endpoints work end-to-end with mock provider
- All endpoints have Zod-validated DTOs
- Test coverage > 90% for sync engine, transport, and controller layers

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Provider interface is too narrow for real providers | Design based on common denominator across Jira, GitHub, Linear. `rawFields` and `rawPayload` escape hatches for provider-specific data. |
| Sync loops (outbound change triggers inbound webhook) | Track sync actor in metadata; skip inbound events that originated from outbound sync. |
| Large imports overwhelm the system | Batch processing with configurable batch size; rate limiting on import endpoints. |
| Webhook endpoint becomes abuse vector | Signature validation mandatory; connection-scoped webhooks; rate limiting. |
| Provider adapters need plugin platform integration later | Interface is self-contained; migration to plugin-contributed adapters is a future non-breaking change. |

## Future Work

- Concrete provider implementations (Jira, GitHub Issues, Linear)
- Comment and attachment sync
- Plugin platform integration (EPIC-188)
- Web UI for connection management
- MCP tools for external sync operations
- Advanced conflict resolution strategies (field-level merge, manual resolution queue)
- Bi-directional label/tag sync
