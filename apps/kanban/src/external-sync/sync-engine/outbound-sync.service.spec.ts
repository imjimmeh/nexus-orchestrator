import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KanbanExternalConnectionEntity } from "../../database/entities/kanban-external-connection.entity.js";
import type { KanbanWorkItemEntity } from "../../database/entities/kanban-work-item.entity.js";
import { KanbanExternalConnectionRepository } from "../../database/repositories/kanban-external-connection.repository.js";
import { KanbanSyncOperationLogRepository } from "../../database/repositories/kanban-sync-operation-log.repository.js";
import { KanbanWorkItemRepository } from "../../database/repositories/kanban-work-item.repository.js";
import type { IExternalTicketProvider } from "../providers/external-ticket-provider.types.js";
import { FieldMapperService } from "./field-mapper.service.js";
import { ProviderRegistryService } from "../providers/provider-registry.service.js";
import { OutboundSyncService } from "./outbound-sync.service.js";

const PROJECT_ID = "550e8400-e29b-41d4-a716-446655440000";
const CONNECTION_ID = "660e8400-e29b-41d4-a716-446655440001";
const WORK_ITEM_ID = "770e8400-e29b-41d4-a716-446655440002";
const EXTERNAL_ID = "EXT-1";

function buildConnection(
  overrides: Partial<KanbanExternalConnectionEntity> = {},
): KanbanExternalConnectionEntity {
  return {
    id: CONNECTION_ID,
    project_id: PROJECT_ID,
    provider_type: "test-provider",
    name: "Test Connection",
    status: "active",
    sync_mode: "bidirectional",
    sync_transport: "manual",
    config: {},
    field_mapping: {},
    webhook_secret_ref: null,
    poll_interval_seconds: null,
    last_sync_at: null,
    last_sync_error: null,
    created_at: new Date("2026-06-01T00:00:00.000Z"),
    updated_at: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides,
  };
}

function buildWorkItem(
  overrides: Partial<KanbanWorkItemEntity> = {},
): KanbanWorkItemEntity {
  return {
    id: WORK_ITEM_ID,
    project_id: PROJECT_ID,
    title: "Test Work Item",
    description: "A description",
    status: "in-progress",
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
        provider_type: "test-provider",
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
    findByProjectAndId: vi.fn(),
    findByproject_id: vi.fn(),
    save: vi.fn(),
  };
  const connectionRepo = {
    findByProjectAndId: vi.fn(),
    findById: vi.fn(),
  };
  const operationLogRepo = {
    createOperation: vi.fn(),
    completeOperation: vi.fn(),
  };
  const providerRegistry = {
    resolve: vi.fn(),
  };
  const fieldMapper = {
    mapWorkItemToExternalTicket: vi.fn(),
  };

  const service = new OutboundSyncService(
    workItemRepo as unknown as KanbanWorkItemRepository,
    connectionRepo as unknown as KanbanExternalConnectionRepository,
    operationLogRepo as unknown as KanbanSyncOperationLogRepository,
    providerRegistry as unknown as ProviderRegistryService,
    fieldMapper as unknown as FieldMapperService,
  );

  return {
    connectionRepo,
    fieldMapper,
    operationLogRepo,
    providerRegistry,
    service,
    workItemRepo,
  };
}

describe("OutboundSyncService", () => {
  describe("pushStatusChange", () => {
    it("skips if work item has no metadata.external_sync", async () => {
      const { service, workItemRepo, connectionRepo } = createService();
      workItemRepo.findByProjectAndId.mockResolvedValue(
        buildWorkItem({ metadata: null }),
      );

      await service.pushStatusChange({
        projectId: PROJECT_ID,
        workItemId: WORK_ITEM_ID,
        status: "in-progress",
        previousStatus: "todo",
      });

      expect(connectionRepo.findByProjectAndId).not.toHaveBeenCalled();
    });

    it("skips if connection not found", async () => {
      const { service, workItemRepo, connectionRepo } = createService();
      workItemRepo.findByProjectAndId.mockResolvedValue(buildWorkItem());
      connectionRepo.findByProjectAndId.mockResolvedValue(null);

      await service.pushStatusChange({
        projectId: PROJECT_ID,
        workItemId: WORK_ITEM_ID,
        status: "in-progress",
        previousStatus: "todo",
      });

      expect(connectionRepo.findByProjectAndId).toHaveBeenCalledWith(
        PROJECT_ID,
        CONNECTION_ID,
      );
    });

    it("skips if connection is inactive (paused)", async () => {
      const { service, workItemRepo, connectionRepo, providerRegistry } =
        createService();
      workItemRepo.findByProjectAndId.mockResolvedValue(buildWorkItem());
      connectionRepo.findByProjectAndId.mockResolvedValue(
        buildConnection({ status: "paused" }),
      );

      await service.pushStatusChange({
        projectId: PROJECT_ID,
        workItemId: WORK_ITEM_ID,
        status: "in-progress",
        previousStatus: "todo",
      });

      expect(providerRegistry.resolve).not.toHaveBeenCalled();
    });

    it("skips if connection is in error state", async () => {
      const { service, workItemRepo, connectionRepo, providerRegistry } =
        createService();
      workItemRepo.findByProjectAndId.mockResolvedValue(buildWorkItem());
      connectionRepo.findByProjectAndId.mockResolvedValue(
        buildConnection({ status: "error" }),
      );

      await service.pushStatusChange({
        projectId: PROJECT_ID,
        workItemId: WORK_ITEM_ID,
        status: "in-progress",
        previousStatus: "todo",
      });

      expect(providerRegistry.resolve).not.toHaveBeenCalled();
    });

    it("skips if sync_mode is inbound only", async () => {
      const { service, workItemRepo, connectionRepo, providerRegistry } =
        createService();
      workItemRepo.findByProjectAndId.mockResolvedValue(buildWorkItem());
      connectionRepo.findByProjectAndId.mockResolvedValue(
        buildConnection({ sync_mode: "inbound" }),
      );

      await service.pushStatusChange({
        projectId: PROJECT_ID,
        workItemId: WORK_ITEM_ID,
        status: "in-progress",
        previousStatus: "todo",
      });

      expect(providerRegistry.resolve).not.toHaveBeenCalled();
    });

    it("skips if provider does not support updates", async () => {
      const { service, workItemRepo, connectionRepo, providerRegistry } =
        createService();
      workItemRepo.findByProjectAndId.mockResolvedValue(buildWorkItem());
      connectionRepo.findByProjectAndId.mockResolvedValue(buildConnection());
      const provider = {
        providerType: "test-provider",
        capabilities: { supportsUpdate: false },
      } as unknown as IExternalTicketProvider;
      providerRegistry.resolve.mockReturnValue(provider);

      await service.pushStatusChange({
        projectId: PROJECT_ID,
        workItemId: WORK_ITEM_ID,
        status: "in-progress",
        previousStatus: "todo",
      });

      expect(providerRegistry.resolve).toHaveBeenCalledWith("test-provider");
    });

    it("calls updateTicket on valid work item and logs operation", async () => {
      const {
        connectionRepo,
        fieldMapper,
        operationLogRepo,
        providerRegistry,
        service,
        workItemRepo,
      } = createService();

      const workItem = buildWorkItem();
      workItemRepo.findByProjectAndId.mockResolvedValue(workItem);
      connectionRepo.findByProjectAndId.mockResolvedValue(buildConnection());

      const updateTicketMock = vi.fn().mockResolvedValue({ id: EXTERNAL_ID });
      const provider = {
        providerType: "test-provider",
        capabilities: { supportsUpdate: true },
        updateTicket: updateTicketMock,
      } as unknown as IExternalTicketProvider;
      providerRegistry.resolve.mockReturnValue(provider);

      fieldMapper.mapWorkItemToExternalTicket.mockReturnValue({
        title: "Test Work Item",
        status: "in-progress",
      });

      operationLogRepo.createOperation.mockResolvedValue({ id: "log-1" });
      operationLogRepo.completeOperation.mockResolvedValue({ id: "log-1" });

      await service.pushStatusChange({
        projectId: PROJECT_ID,
        workItemId: WORK_ITEM_ID,
        status: "in-progress",
        previousStatus: "todo",
      });

      expect(fieldMapper.mapWorkItemToExternalTicket).toHaveBeenCalledWith(
        {
          title: workItem.title,
          description: workItem.description ?? undefined,
          status: workItem.status,
          priority: workItem.priority,
        },
        {},
      );

      expect(updateTicketMock).toHaveBeenCalledWith(
        EXTERNAL_ID,
        expect.objectContaining({
          title: "Test Work Item",
          status: "in-progress",
        }),
      );

      expect(operationLogRepo.createOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          connection_id: CONNECTION_ID,
          project_id: PROJECT_ID,
          work_item_id: WORK_ITEM_ID,
          external_id: EXTERNAL_ID,
          direction: "outbound",
          operation: "status_change",
          status: "pending",
        }),
      );

      expect(operationLogRepo.completeOperation).toHaveBeenCalledWith(
        "log-1",
        "success",
        expect.stringContaining("outbound sync for ticket"),
        expect.objectContaining({
          action: "status_change",
          externalId: EXTERNAL_ID,
          status: "in-progress",
        }),
      );
    });

    it("logs failure on provider error", async () => {
      const {
        connectionRepo,
        fieldMapper,
        operationLogRepo,
        providerRegistry,
        service,
        workItemRepo,
      } = createService();

      workItemRepo.findByProjectAndId.mockResolvedValue(buildWorkItem());
      connectionRepo.findByProjectAndId.mockResolvedValue(buildConnection());

      const updateError = new Error("Provider update failed");
      const provider = {
        providerType: "test-provider",
        capabilities: { supportsUpdate: true },
        updateTicket: vi.fn().mockRejectedValue(updateError),
      } as unknown as IExternalTicketProvider;
      providerRegistry.resolve.mockReturnValue(provider);

      fieldMapper.mapWorkItemToExternalTicket.mockReturnValue({
        title: "Test Work Item",
        status: "in-progress",
      });

      operationLogRepo.createOperation.mockResolvedValue({ id: "log-1" });
      operationLogRepo.completeOperation.mockResolvedValue({ id: "log-1" });

      await service.pushStatusChange({
        projectId: PROJECT_ID,
        workItemId: WORK_ITEM_ID,
        status: "in-progress",
        previousStatus: "todo",
      });

      expect(operationLogRepo.completeOperation).toHaveBeenCalledWith(
        "log-1",
        "failed",
        expect.stringContaining("Provider update failed"),
        expect.objectContaining({
          action: "status_change",
          error: "Provider update failed",
        }),
      );
    });

    it("does not throw when provider fails (fire-and-forget)", async () => {
      const {
        connectionRepo,
        fieldMapper,
        operationLogRepo,
        providerRegistry,
        service,
        workItemRepo,
      } = createService();

      workItemRepo.findByProjectAndId.mockResolvedValue(buildWorkItem());
      connectionRepo.findByProjectAndId.mockResolvedValue(buildConnection());

      const provider = {
        providerType: "test-provider",
        capabilities: { supportsUpdate: true },
        updateTicket: vi.fn().mockRejectedValue(new Error("boom")),
      } as unknown as IExternalTicketProvider;
      providerRegistry.resolve.mockReturnValue(provider);

      fieldMapper.mapWorkItemToExternalTicket.mockReturnValue({
        title: "Test Work Item",
        status: "in-progress",
      });

      operationLogRepo.createOperation.mockResolvedValue({ id: "log-1" });
      operationLogRepo.completeOperation.mockResolvedValue({ id: "log-1" });

      await expect(
        service.pushStatusChange({
          projectId: PROJECT_ID,
          workItemId: WORK_ITEM_ID,
          status: "in-progress",
          previousStatus: "todo",
        }),
      ).resolves.toBeUndefined();
    });

    it("permits outbound sync for bidirectional mode", async () => {
      const {
        connectionRepo,
        fieldMapper,
        operationLogRepo,
        providerRegistry,
        service,
        workItemRepo,
      } = createService();

      workItemRepo.findByProjectAndId.mockResolvedValue(buildWorkItem());
      connectionRepo.findByProjectAndId.mockResolvedValue(
        buildConnection({ sync_mode: "bidirectional" }),
      );

      const updateTicketMock = vi.fn().mockResolvedValue({ id: EXTERNAL_ID });
      const provider = {
        providerType: "test-provider",
        capabilities: { supportsUpdate: true },
        updateTicket: updateTicketMock,
      } as unknown as IExternalTicketProvider;
      providerRegistry.resolve.mockReturnValue(provider);
      fieldMapper.mapWorkItemToExternalTicket.mockReturnValue({ title: "X" });
      operationLogRepo.createOperation.mockResolvedValue({ id: "log-1" });
      operationLogRepo.completeOperation.mockResolvedValue({ id: "log-1" });

      await service.pushStatusChange({
        projectId: PROJECT_ID,
        workItemId: WORK_ITEM_ID,
        status: "done",
        previousStatus: "in-progress",
      });

      expect(updateTicketMock).toHaveBeenCalled();
    });

    it("permits outbound sync for outbound mode", async () => {
      const {
        connectionRepo,
        fieldMapper,
        operationLogRepo,
        providerRegistry,
        service,
        workItemRepo,
      } = createService();

      workItemRepo.findByProjectAndId.mockResolvedValue(buildWorkItem());
      connectionRepo.findByProjectAndId.mockResolvedValue(
        buildConnection({ sync_mode: "outbound" }),
      );

      const updateTicketMock = vi.fn().mockResolvedValue({ id: EXTERNAL_ID });
      const provider = {
        providerType: "test-provider",
        capabilities: { supportsUpdate: true },
        updateTicket: updateTicketMock,
      } as unknown as IExternalTicketProvider;
      providerRegistry.resolve.mockReturnValue(provider);
      fieldMapper.mapWorkItemToExternalTicket.mockReturnValue({ title: "X" });
      operationLogRepo.createOperation.mockResolvedValue({ id: "log-1" });
      operationLogRepo.completeOperation.mockResolvedValue({ id: "log-1" });

      await service.pushStatusChange({
        projectId: PROJECT_ID,
        workItemId: WORK_ITEM_ID,
        status: "done",
        previousStatus: "in-progress",
      });

      expect(updateTicketMock).toHaveBeenCalled();
    });
  });

  describe("exportWorkItems", () => {
    it("returns empty counts when no work items have external_sync metadata", async () => {
      const { service, workItemRepo } = createService();
      workItemRepo.findByproject_id.mockResolvedValue([
        buildWorkItem({ metadata: null }),
      ]);

      const result = await service.exportWorkItems(PROJECT_ID, CONNECTION_ID);

      expect(result).toEqual({
        processed: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
      });
    });

    it("returns empty counts when no work items match the given connection_id", async () => {
      const { service, workItemRepo } = createService();
      const wi = buildWorkItem({
        metadata: {
          external_sync: {
            connection_id: "other-connection",
            external_id: EXTERNAL_ID,
          },
        },
      });
      workItemRepo.findByproject_id.mockResolvedValue([wi]);

      const result = await service.exportWorkItems(PROJECT_ID, CONNECTION_ID);

      expect(result).toEqual({
        processed: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
      });
    });

    it("exports eligible work items and returns counts", async () => {
      const {
        connectionRepo,
        fieldMapper,
        operationLogRepo,
        providerRegistry,
        service,
        workItemRepo,
      } = createService();

      const wi1 = buildWorkItem({ id: "wi-1" });
      const wi2 = buildWorkItem({
        id: "wi-2",
        metadata: {
          external_sync: {
            connection_id: CONNECTION_ID,
            external_id: "EXT-2",
          },
        },
      });
      workItemRepo.findByproject_id.mockResolvedValue([wi1, wi2]);

      connectionRepo.findByProjectAndId.mockResolvedValue(buildConnection());

      const provider = {
        providerType: "test-provider",
        capabilities: { supportsCreate: true, supportsUpdate: true },
        createTicket: vi.fn().mockResolvedValue({ id: "EXT-1" }),
        updateTicket: vi.fn().mockResolvedValue({ id: EXTERNAL_ID }),
      } as unknown as IExternalTicketProvider;
      providerRegistry.resolve.mockReturnValue(provider);

      fieldMapper.mapWorkItemToExternalTicket.mockReturnValue({
        title: "Test Work Item",
        status: "in-progress",
      });

      operationLogRepo.createOperation.mockResolvedValue({ id: "log-1" });
      operationLogRepo.completeOperation.mockResolvedValue({ id: "log-1" });

      const result = await service.exportWorkItems(PROJECT_ID, CONNECTION_ID);

      expect(result.processed).toBe(2);
      expect(result.created).toBe(0);
      expect(result.updated).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
    });

    it("skips work items whose external_sync connection does not match", async () => {
      const { service, workItemRepo } = createService();

      const wi = buildWorkItem({
        metadata: {
          external_sync: {
            connection_id: "other-conn-id",
            external_id: "EXT-1",
          },
        },
      });
      workItemRepo.findByproject_id.mockResolvedValue([wi]);

      const result = await service.exportWorkItems(PROJECT_ID, CONNECTION_ID);

      expect(result).toEqual({
        processed: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
      });
    });

    it("handles provider errors gracefully and includes failures in count", async () => {
      const {
        connectionRepo,
        fieldMapper,
        operationLogRepo,
        providerRegistry,
        service,
        workItemRepo,
      } = createService();

      const wi = buildWorkItem();
      workItemRepo.findByproject_id.mockResolvedValue([wi]);
      connectionRepo.findByProjectAndId.mockResolvedValue(buildConnection());

      const provider = {
        providerType: "test-provider",
        capabilities: { supportsCreate: true },
        createTicket: vi.fn().mockRejectedValue(new Error("Export failed")),
      } as unknown as IExternalTicketProvider;
      providerRegistry.resolve.mockReturnValue(provider);
      fieldMapper.mapWorkItemToExternalTicket.mockReturnValue({ title: "X" });
      operationLogRepo.createOperation.mockResolvedValue({ id: "log-1" });
      operationLogRepo.completeOperation.mockResolvedValue({ id: "log-1" });

      const result = await service.exportWorkItems(PROJECT_ID, CONNECTION_ID);

      expect(result.processed).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.created).toBe(0);
    });
  });
});
