import { describe, expect, it, vi } from "vitest";
import type { KanbanExternalConnectionEntity } from "../../database/entities/kanban-external-connection.entity.js";
import type { KanbanWorkItemEntity } from "../../database/entities/kanban-work-item.entity.js";
import { KanbanSyncOperationLogRepository } from "../../database/repositories/kanban-sync-operation-log.repository.js";
import { KanbanWorkItemRepository } from "../../database/repositories/kanban-work-item.repository.js";
import type { ExternalTicketChangeEvent } from "../providers/external-ticket-provider.types.js";
import { ConflictResolverService } from "./conflict-resolver.service.js";
import { FieldMapperService } from "./field-mapper.service.js";
import { InboundSyncService } from "./inbound-sync.service.js";

const PROJECT_ID = "550e8400-e29b-41d4-a716-446655440000";
const CONNECTION_ID = "660e8400-e29b-41d4-a716-446655440001";
const EXTERNAL_ID = "EXT-1";

function buildConnection(): KanbanExternalConnectionEntity {
  return {
    id: CONNECTION_ID,
    project_id: PROJECT_ID,
    provider_type: "null",
    name: "Null",
    status: "active",
    sync_mode: "inbound",
    sync_transport: "manual",
    config: {},
    field_mapping: {},
    webhook_secret_ref: null,
    poll_interval_seconds: null,
    last_sync_at: null,
    last_sync_error: null,
    created_at: new Date("2026-06-01T00:00:00.000Z"),
    updated_at: new Date("2026-06-01T00:00:00.000Z"),
  };
}

function buildWorkItem(
  overrides: Partial<KanbanWorkItemEntity> = {},
): KanbanWorkItemEntity {
  return {
    id: "item-1",
    project_id: PROJECT_ID,
    title: "Old title",
    description: "Old description",
    status: "todo",
    priority: "p2",
    scope: "standard",
    assigned_agent_id: null,
    token_spend: 0,
    current_execution_id: null,
    waiting_for_input: false,
    execution_config: null,
    metadata: {
      external_sync: {
        connection_id: CONNECTION_ID,
        external_id: EXTERNAL_ID,
      },
    },
    linked_run_id: null,
    created_at: new Date("2026-06-01T00:00:00.000Z"),
    updated_at: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides,
  };
}

function createService() {
  const workItemRepo = {
    findByExternalSyncRef: vi.fn(),
    save: vi.fn(),
  };
  const operationLogRepo = {
    createOperation: vi.fn(),
    completeOperation: vi.fn(),
  };
  const fieldMapper = {
    mapExternalTicketToWorkItemInput: vi.fn(),
  };
  const conflictResolver = {
    resolveExternalUpdate: vi.fn(),
  };

  const service = new InboundSyncService(
    workItemRepo as unknown as KanbanWorkItemRepository,
    operationLogRepo as unknown as KanbanSyncOperationLogRepository,
    fieldMapper as unknown as FieldMapperService,
    conflictResolver as unknown as ConflictResolverService,
  );

  operationLogRepo.createOperation.mockResolvedValue({ id: "op-1" });
  operationLogRepo.completeOperation.mockResolvedValue({ id: "op-1" });

  return {
    conflictResolver,
    fieldMapper,
    operationLogRepo,
    service,
    workItemRepo,
  };
}

describe("InboundSyncService", () => {
  it("creates a native work item for a new external ticket and logs success", async () => {
    const { fieldMapper, operationLogRepo, service, workItemRepo } =
      createService();
    const mapped = {
      title: "External title",
      description: "External description",
      status: "todo",
      priority: "p1",
      metadata: {
        external_sync: {
          connection_id: CONNECTION_ID,
          external_id: EXTERNAL_ID,
        },
      },
    };
    fieldMapper.mapExternalTicketToWorkItemInput.mockReturnValue(mapped);
    workItemRepo.findByExternalSyncRef.mockResolvedValue(null);
    workItemRepo.save.mockResolvedValue(
      buildWorkItem({ id: "item-1", ...mapped }),
    );

    const result = await service.processTicket(
      buildConnection(),
      {
        id: EXTERNAL_ID,
        title: "External title",
        updatedAt: "2026-06-02T00:00:00.000Z",
      },
      "import",
    );

    expect(result).toEqual({ action: "created", status: "success" });
    expect(workItemRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: PROJECT_ID,
        title: mapped.title,
        description: mapped.description,
        status: mapped.status,
        priority: mapped.priority,
        metadata: mapped.metadata,
      }),
    );
    expect(operationLogRepo.createOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        connection_id: CONNECTION_ID,
        project_id: PROJECT_ID,
        external_id: EXTERNAL_ID,
        direction: "inbound",
        operation: "import",
        status: "pending",
      }),
    );
    expect(operationLogRepo.completeOperation).toHaveBeenCalledWith(
      "op-1",
      "success",
      "Created work item item-1 from external ticket EXT-1",
      expect.objectContaining({ action: "created" }),
    );
  });

  it("updates an existing work item when the resolver applies the external ticket", async () => {
    const {
      conflictResolver,
      fieldMapper,
      operationLogRepo,
      service,
      workItemRepo,
    } = createService();
    const existing = buildWorkItem();
    const mapped = {
      title: "New title",
      description: "New description",
      status: "in-progress",
      priority: "p0",
      metadata: {
        external_sync: {
          connection_id: CONNECTION_ID,
          external_id: EXTERNAL_ID,
        },
      },
    };
    fieldMapper.mapExternalTicketToWorkItemInput.mockReturnValue(mapped);
    workItemRepo.findByExternalSyncRef.mockResolvedValue(existing);
    workItemRepo.save.mockResolvedValue(existing);
    conflictResolver.resolveExternalUpdate.mockReturnValue({
      decision: "apply_external",
      reason: "external newer",
      details: { externalId: EXTERNAL_ID },
    });

    const result = await service.processTicket(
      buildConnection(),
      {
        id: EXTERNAL_ID,
        title: "New title",
        updatedAt: "2026-06-02T00:00:00.000Z",
      },
      "sync",
    );

    expect(result).toEqual({ action: "updated", status: "success" });
    expect(workItemRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: existing.id,
        title: mapped.title,
        description: mapped.description,
        status: mapped.status,
        priority: mapped.priority,
        metadata: mapped.metadata,
      }),
    );
    expect(operationLogRepo.completeOperation).toHaveBeenCalledWith(
      "op-1",
      "success",
      "Updated work item item-1 from external ticket EXT-1",
      expect.objectContaining({
        action: "updated",
        conflict: { externalId: EXTERNAL_ID },
      }),
    );
  });

  it("logs skipped conflict decisions without mutating the work item", async () => {
    const {
      conflictResolver,
      fieldMapper,
      operationLogRepo,
      service,
      workItemRepo,
    } = createService();
    const existing = buildWorkItem();
    fieldMapper.mapExternalTicketToWorkItemInput.mockReturnValue({
      title: "New title",
      description: null,
      status: "todo",
      priority: "p2",
      metadata: {},
    });
    workItemRepo.findByExternalSyncRef.mockResolvedValue(existing);
    conflictResolver.resolveExternalUpdate.mockReturnValue({
      decision: "skip_external",
      reason: "local newer",
      details: { externalId: EXTERNAL_ID },
    });

    const result = await service.processTicket(
      buildConnection(),
      {
        id: EXTERNAL_ID,
        title: "New title",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
      "sync",
    );

    expect(result).toEqual({ action: "skipped", status: "skipped" });
    expect(workItemRepo.save).not.toHaveBeenCalled();
    expect(operationLogRepo.completeOperation).toHaveBeenCalledWith(
      "op-1",
      "skipped",
      "Skipped external ticket EXT-1: local newer",
      expect.objectContaining({
        action: "skipped",
        conflict: { externalId: EXTERNAL_ID },
      }),
    );
  });

  it("marks deleted external events in metadata instead of deleting work items", async () => {
    const { operationLogRepo, service, workItemRepo } = createService();
    const existing = buildWorkItem();
    workItemRepo.findByExternalSyncRef.mockResolvedValue(existing);
    workItemRepo.save.mockResolvedValue(existing);

    const event: ExternalTicketChangeEvent = {
      externalId: EXTERNAL_ID,
      action: "deleted",
      timestamp: "2026-06-02T00:00:00.000Z",
    };

    const result = await service.processDeletedEvent(
      buildConnection(),
      event,
      "sync",
    );

    expect(result).toEqual({ action: "deleted", status: "success" });
    expect(workItemRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: existing.id,
        metadata: expect.objectContaining({
          external_sync: expect.objectContaining({
            deleted_at: "2026-06-02T00:00:00.000Z",
            deletion_seen: true,
          }),
        }),
      }),
    );
    expect(operationLogRepo.completeOperation).toHaveBeenCalledWith(
      "op-1",
      "success",
      "Marked work item item-1 for deleted external ticket EXT-1",
      expect.objectContaining({ action: "deleted" }),
    );
  });
});
