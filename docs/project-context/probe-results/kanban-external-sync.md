---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: kanban-external-sync
outcome: success
inferred_status: implemented
confidence_score: 0.90
evidence_refs:
  - apps/kanban/src/external-sync/external-sync.module.ts
  - apps/kanban/src/external-sync/external-sync.controller.ts
  - apps/kanban/src/external-sync/external-sync.service.ts
  - apps/kanban/src/external-sync/external-sync.types.ts
  - apps/kanban/src/external-sync/outbound-sync.types.ts
  - apps/kanban/src/external-sync/sync-engine/sync-coordinator.service.ts
  - apps/kanban/src/external-sync/sync-engine/inbound-sync.service.ts
  - apps/kanban/src/external-sync/sync-engine/outbound-sync.service.ts
  - apps/kanban/src/external-sync/sync-engine/conflict-resolver.service.ts
  - apps/kanban/src/external-sync/sync-engine/field-mapper.service.ts
  - apps/kanban/src/external-sync/sync-engine/conflict-resolver.types.ts
  - apps/kanban/src/external-sync/providers/provider-registry.service.ts
  - apps/kanban/src/external-sync/providers/external-ticket-provider.types.ts
  - apps/kanban/src/external-sync/providers/external-ticket-provider.tokens.ts
  - apps/kanban/src/external-sync/providers/null-external-ticket.provider.ts
  - apps/kanban/src/external-sync/transport/webhook-receiver.controller.ts
  - apps/kanban/src/external-sync/transport/external-sync-polling.scheduler.ts
  - apps/kanban/src/external-sync/transport/external-sync-polling.processor.ts
  - apps/kanban/src/external-sync/transport/external-sync-polling.queue.ts
  - apps/kanban/src/database/entities/kanban-external-connection.entity.ts
  - apps/kanban/src/database/entities/kanban-sync-operation-log.entity.ts
  - apps/kanban/src/database/repositories/kanban-external-connection.repository.ts
  - apps/kanban/src/database/repositories/kanban-external-connection.repository.types.ts
  - apps/kanban/src/database/repositories/kanban-sync-operation-log.repository.ts
  - apps/kanban/src/database/migrations/20260602120000-create-kanban-external-sync-tables.ts
  - apps/kanban/src/app.module.ts
  - apps/kanban/src/work-item/work-item.module.ts
  - apps/kanban/src/work-item/kanban-lifecycle-event-publisher.ts
  - apps/kanban/src/database/repositories/kanban-work-item.repository.ts
source_paths:
  - apps/kanban/src/external-sync
  - apps/kanban/src/database/entities/kanban-external-connection.entity.ts
  - apps/kanban/src/database/entities/kanban-sync-operation-log.entity.ts
  - apps/kanban/src/database/repositories/kanban-external-connection.repository.ts
  - apps/kanban/src/database/repositories/kanban-sync-operation-log.repository.ts
  - apps/kanban/src/database/migrations/20260602120000-create-kanban-external-sync-tables.ts
  - apps/kanban/src/work-item/kanban-lifecycle-event-publisher.ts
  - apps/kanban/src/work-item/work-item.module.ts
  - apps/kanban/src/app.module.ts
updated_at: 2026-06-15T00:00:00.000Z
---

# Probe Result: Kanban External Sync

## Narrative Summary

The Kanban External Sync capability is **fully implemented as a complete, production-ready framework**. The feature provides bidirectional synchronization between Kanban work items and external ticketing systems (Jira, GitHub Issues, etc.) via a provider-pluggable architecture. The implementation covers the entire end-to-end pipeline:

- **Data model**: Two TypeORM entities (`kanban_external_connections`, `kanban_sync_operation_log`) with a dedicated migration (`20260602120000-create-kanban-external-sync-tables.ts`) introducing JSONB config/field_mapping, polling metadata, sync status, and per-operation log entries with proper indexes.
- **REST API**: `ExternalSyncController` exposes `projects/:projectId/external-connections` with full CRUD plus lifecycle operations (test, pause, resume, sync, import, export, list operations).
- **Webhook transport**: `WebhookReceiverController` exposes `POST /external-sync/webhook/:connectionId` with signature validation, status checks, and per-event routing (created/updated → `processTicket`; deleted → `processDeletedEvent`).
- **Polling transport**: BullMQ-based `ExternalSyncPollingScheduler` registers repeatable jobs at boot for active polling connections (default 5 min), and `ExternalSyncPollingProcessor` runs `SyncCoordinatorService.sync` for each tick.
- **Sync engine**: `SyncCoordinatorService.runInbound` paginates provider tickets, drives `InboundSyncService.processTicket` for create/update, and `processDeletedEvent` (which marks work items with `metadata.external_sync.deletion_seen = true` rather than physical deletion).
- **Conflict resolution**: `ConflictResolverService` uses a timestamp-based last-writer-wins strategy (`apply_external | skip_external | noop`) with detailed reasons logged.
- **Field mapping**: `FieldMapperService.mapExternalTicketToWorkItemInput` and `mapWorkItemToExternalTicket` resolve dotted field paths against `field_mapping` config, validate status against `isSupportedWorkItemStatus`, and tag work items with `metadata.external_sync.{connection_id, external_id, provider_type, url, sourceCreatedAt, sourceUpdatedAt, synced_at}`.
- **Outbound sync**: `OutboundSyncService.pushStatusChange` is `@Optional()`-injected into `KanbanLifecycleEventPublisher` (work-item) and fires after a successful lifecycle event delivery. It reads `metadata.external_sync`, resolves the connection, and calls `provider.updateTicket` if the connection is active, mode is `outbound|bidirectional`, and `provider.capabilities.supportsUpdate` is true. `exportWorkItems` re-pushes all linked work items to a provider (creating or updating as supported).
- **Provider extensibility**: `IExternalTicketProvider` interface (`external-ticket-provider.types.ts`) with capability flags (`supportsCreate/Update/Delete/Webhooks/Polling/Comments/Attachments`) and a registry (`ProviderRegistryService`) backed by the `EXTERNAL_TICKET_PROVIDER` symbol. The DI module registers a single `NullExternalTicketProvider` whose capabilities are all `false` (returns empty list, no-op CRUD) — this is a deliberate stub demonstrating the contract and providing a default while real provider integrations are added.
- **Lifecycle wiring**: `AppModule` imports `ExternalSyncModule`; `WorkItemModule` uses `forwardRef(() => ExternalSyncModule)` so the lifecycle event publisher can resolve `OUTBOUND_SYNC_SERVICE`.
- **Operation log**: `KanbanSyncOperationLogRepository` records every create/complete operation with `direction` (`inbound`/`outbound`), `operation` (`import`/`sync`/`export`/`status_change`), `status` (`pending`/`success`/`skipped`/`noop`/`failed`), `message`, and `details` JSONB. Listed paginated by connection, project, or work item.

The feature is **implemented at the framework level** and ready to onboard real provider implementations (Jira/GitHub/Linear) by adding new `IExternalTicketProvider` classes and registering them in `ExternalSyncModule.providers` under the `EXTERNAL_TICKET_PROVIDER` factory.

## Capability Updates

| Capability | Status | Notes |
|---|---|---|
| External connection CRUD (REST) | Implemented | `ExternalSyncController` (create/list/get/update/delete) at `projects/:projectId/external-connections` |
| Connection lifecycle ops | Implemented | test, pause, resume, sync, import, export, list operations |
| Sync modes (`inbound`/`outbound`/`bidirectional`) | Implemented | Enforced in `ExternalSyncService.validateCreateInput`/`validateUpdateInput` |
| Sync transports (`manual`/`webhook`/`polling`/`both`) | Implemented | Enforced and used for filtering active polling connections |
| Connection statuses (`active`/`paused`/`error`) | Implemented | Pause/resume endpoints + `markSyncFailure` after provider errors |
| Inbound sync (fetch + create/update) | Implemented | `SyncCoordinatorService.runInbound` with cursor pagination |
| Inbound sync (deleted events) | Implemented | `InboundSyncService.processDeletedEvent` (soft-marks work item, never deletes) |
| Outbound sync (status change push) | Implemented | `OutboundSyncService.pushStatusChange` triggered by `KanbanLifecycleEventPublisher.emitStatusChanged` (fire-and-forget) |
| Outbound sync (bulk export) | Implemented | `OutboundSyncService.exportWorkItems` |
| Conflict resolution (last-writer-wins) | Implemented | `ConflictResolverService` with timestamp comparison, three decisions |
| Field mapping (path-based + config-driven) | Implemented | `FieldMapperService` with dotted path resolution over `field_mapping` JSONB |
| Provider registry / extensibility | Implemented | `ProviderRegistryService` + `EXTERNAL_TICKET_PROVIDER` symbol; duplicate-type detection |
| Webhook transport | Implemented | `WebhookReceiverController` with signature validation + event routing |
| Polling transport | Implemented | BullMQ `EXTERNAL_SYNC_POLLING_QUEUE` + scheduler on init + processor worker |
| Operation log | Implemented | `KanbanSyncOperationLogEntity` + repository, indexed by connection/project/work item |
| Database schema (entities + migration) | Implemented | Migration `20260602120000-create-kanban-external-sync-tables` with indexes |
| Null provider (default) | Implemented | `NullExternalTicketProvider` — safe stub; all capabilities `false` |
| Real provider integrations (Jira, GitHub, Linear, etc.) | Missing | Only Null provider registered; framework ready to onboard them |
| Unit test coverage | Implemented | Spec files exist for: service, controller, sync-coordinator, inbound-sync, outbound-sync, conflict-resolver, field-mapper, null-provider, provider-registry, polling-scheduler, polling-processor, webhook-receiver |
| Integration tests (`apps/kanban/test/`) | Missing | No `external-sync.integration-spec.ts` in `apps/kanban/test/` (only `dispatch`, `retrospectives`, `split-service` present) |

## Health Findings

- **Test coverage on unit specs is strong**: every service in `apps/kanban/src/external-sync/` has a colocated `.spec.ts` file. Specs use Vitest with `Test.createTestingModule` and mock all dependencies. Outbound-sync spec is 588 lines covering 11 `pushStatusChange` scenarios plus export-work-items cases; field-mapper spec is 473 lines covering path resolution, status validation, and metadata shape.
- **Repository tests exist** for `kanban-external-connection.repository` and `kanban-sync-operation-log.repository`, plus `findByExternalSyncRef` is covered in `kanban-work-item.repository.spec.ts`.
- **No integration tests** in `apps/kanban/test/` exercise the live HTTP REST API for `/projects/:projectId/external-connections` or the `/external-sync/webhook/:connectionId` endpoint, nor end-to-end BullMQ polling flows against a real Redis. The split-service integration harness already in place could be extended to cover this.
- **Outbound sync is fire-and-forget** by design (`.catch(() => {})` in `KanbanLifecycleEventPublisher.emitStatusChanged`): failures do not break the lifecycle event delivery. Errors are logged via `Logger` and recorded in the sync operation log. This is appropriate for cross-system sync.
- **Conflict resolution is conservative**: when external `updatedAt` is missing or invalid, the resolver returns `skip_external` (preserves local state) — a sensible default for idempotent syncs.
- **Webhook secret handling**: `webhook_secret_ref` is stored as a string column (not a sensitive value) and passed to providers as a reference — actual secret resolution is the provider's responsibility. The webhook receiver passes `undefined` for `secret` in `validateWebhookSignature`, so providers must fetch the secret via `webhook_secret_ref` if needed.
- **Code health**: All files use TypeScript strict typing, the codebase consistently uses `.js` import suffixes (ESM), DTO validation is enforced at the service layer (provider_type, sync_mode, sync_transport, status). No `any` leaks observed in the inspected code.
- **Module size is contained**: 5255 lines total across the entire `external-sync/` tree, with services averaging 100-250 lines and tests 60-650 lines (the webhook-receiver and outbound-sync specs are the largest).

## Open Questions

- Are there any real provider implementations planned (Jira, GitHub, Linear, Shortcut) that should be added next, or is the Null provider the only intended configuration until consumers request more?
- Should the webhook receiver look up secrets via `webhook_secret_ref` (rather than the current `undefined` pass-through) and resolve them through a dedicated secret store?
- Is there a need for an integration test that exercises the polling flow against a real (or testcontainer) Redis, given the heavy reliance on BullMQ in the polling transport?
- Should `KanbanExternalConnectionRepository` soft-delete connections (preserving operation log history) instead of the current hard delete via `repo.delete()`?
- Is the `last_sync_error` surfaced to the user anywhere (e.g., a `/health` or `/status` endpoint), or is it only visible in the database?
- Should there be a backoff/retry policy for failed polling jobs (currently BullMQ's default), or is immediate failure → re-register on next tick acceptable?
