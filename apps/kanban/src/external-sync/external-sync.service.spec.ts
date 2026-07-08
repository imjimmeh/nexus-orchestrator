import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanExternalConnectionRepository } from "../database/repositories/kanban-external-connection.repository.js";
import { KanbanSyncOperationLogRepository } from "../database/repositories/kanban-sync-operation-log.repository.js";
import { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository.js";
import { ExternalSyncService } from "./external-sync.service.js";
import { ExternalSyncModule } from "./external-sync.module.js";
import { OutboundSyncService } from "./sync-engine/outbound-sync.service.js";
import { ProviderRegistryService } from "./providers/provider-registry.service.js";
import { SyncCoordinatorService } from "./sync-engine/sync-coordinator.service.js";
import type {
  ExternalConnectionRecord,
  ExternalConnectionCreateInput,
  ExternalConnectionUpdateInput,
} from "./external-sync.types.js";

const PROJECT_ID = "550e8400-e29b-41d4-a716-446655440000";
const CONNECTION_ID = "660e8400-e29b-41d4-a716-446655440001";

const now = new Date("2026-06-01T00:00:00.000Z");
const nowIso = now.toISOString();

function buildConnection(
  overrides: Partial<ExternalConnectionRecord> = {},
): ExternalConnectionRecord {
  return {
    id: CONNECTION_ID,
    project_id: PROJECT_ID,
    provider_type: "null",
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
    created_at: nowIso,
    updated_at: nowIso,
    ...overrides,
  };
}

function buildOperation(overrides: Record<string, unknown> = {}) {
  return {
    id: "op-1",
    connection_id: CONNECTION_ID,
    project_id: PROJECT_ID,
    work_item_id: null,
    external_id: null,
    direction: "outbound",
    operation: "create",
    status: "success",
    message: null,
    details: {},
    started_at: now,
    completed_at: now,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("ExternalSyncService", () => {
  let service: ExternalSyncService;
  let connectionRepo: {
    create: ReturnType<typeof vi.fn>;
    findByProjectAndId: ReturnType<typeof vi.fn>;
    listByProject: ReturnType<typeof vi.fn>;
    updateByProjectAndId: ReturnType<typeof vi.fn>;
    deleteByProjectAndId: ReturnType<typeof vi.fn>;
  };
  let operationLogRepo: {
    listByConnection: ReturnType<typeof vi.fn>;
  };
  let providerRegistry: {
    resolve: ReturnType<typeof vi.fn>;
  };
  let syncCoordinator: {
    importTickets: ReturnType<typeof vi.fn>;
    sync: ReturnType<typeof vi.fn>;
  };
  let mockOutboundSync: {
    exportWorkItems: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    connectionRepo = {
      create: vi.fn(),
      findByProjectAndId: vi.fn(),
      listByProject: vi.fn(),
      updateByProjectAndId: vi.fn(),
      deleteByProjectAndId: vi.fn(),
    };
    operationLogRepo = {
      listByConnection: vi.fn(),
    };
    providerRegistry = {
      resolve: vi.fn(),
    };
    syncCoordinator = {
      importTickets: vi.fn(),
      sync: vi.fn(),
    };

    mockOutboundSync = {
      exportWorkItems: vi.fn(),
    };

    service = new ExternalSyncService(
      connectionRepo as unknown as KanbanExternalConnectionRepository,
      operationLogRepo as unknown as KanbanSyncOperationLogRepository,
      providerRegistry as unknown as ProviderRegistryService,
      syncCoordinator as unknown as SyncCoordinatorService,
      mockOutboundSync as never,
    );
  });

  describe("create", () => {
    const createInput: ExternalConnectionCreateInput = {
      provider_type: "null",
      name: "My Connection",
      sync_mode: "inbound",
      sync_transport: "polling",
      config: { apiKey: "test" },
    };

    it("creates a connection when provider and config are valid", async () => {
      const mockProvider = {
        validateConfig: vi.fn().mockReturnValue(true),
        providerType: "null",
      };
      providerRegistry.resolve.mockReturnValue(mockProvider);
      const saved = buildConnection({
        id: "new-id",
        name: "My Connection",
        sync_mode: "inbound",
        sync_transport: "polling",
        config: { apiKey: "test" },
      });
      connectionRepo.create.mockResolvedValue({
        ...saved,
        created_at: now,
        updated_at: now,
        last_sync_at: null,
        last_sync_error: null,
      });

      const result = await service.create(PROJECT_ID, createInput);

      expect(providerRegistry.resolve).toHaveBeenCalledWith("null");
      expect(mockProvider.validateConfig).toHaveBeenCalledWith({
        apiKey: "test",
      });
      expect(connectionRepo.create).toHaveBeenCalledWith({
        project_id: PROJECT_ID,
        provider_type: "null",
        name: "My Connection",
        sync_mode: "inbound",
        sync_transport: "polling",
        config: { apiKey: "test" },
        field_mapping: {},
        webhook_secret_ref: null,
        poll_interval_seconds: null,
      });
      expect(result.name).toBe("My Connection");
      expect(result.created_at).toBe(nowIso);
    });

    it("throws BadRequestException when provider_type is missing", async () => {
      await expect(
        service.create(PROJECT_ID, { provider_type: "", name: "X" }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("throws BadRequestException when name is missing", async () => {
      await expect(
        service.create(PROJECT_ID, { provider_type: "null", name: "" }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("throws BadRequestException when provider config is invalid", async () => {
      const mockProvider = {
        validateConfig: vi.fn().mockReturnValue(false),
        providerType: "null",
      };
      providerRegistry.resolve.mockReturnValue(mockProvider);

      await expect(
        service.create(PROJECT_ID, {
          provider_type: "null",
          name: "X",
          config: { bad: true },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("throws BadRequestException when sync_mode is invalid", async () => {
      await expect(
        service.create(PROJECT_ID, {
          provider_type: "null",
          name: "X",
          sync_mode: "invalid" as never,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("throws BadRequestException when sync_transport is invalid", async () => {
      await expect(
        service.create(PROJECT_ID, {
          provider_type: "null",
          name: "X",
          sync_transport: "ftp" as never,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("accepts valid sync_mode values", async () => {
      const makeEntity = (sync_mode: string) => ({
        ...buildConnection({ sync_mode: sync_mode as never }),
        created_at: now,
        updated_at: now,
        last_sync_at: null,
        last_sync_error: null,
      });
      const mockProvider = {
        validateConfig: vi.fn().mockReturnValue(true),
        providerType: "null",
      };
      providerRegistry.resolve.mockReturnValue(mockProvider);
      connectionRepo.create.mockResolvedValueOnce(makeEntity("outbound"));
      connectionRepo.create.mockResolvedValueOnce(makeEntity("inbound"));
      connectionRepo.create.mockResolvedValueOnce(makeEntity("bidirectional"));

      await service.create(PROJECT_ID, {
        provider_type: "null",
        name: "X",
        sync_mode: "outbound",
      });
      await service.create(PROJECT_ID, {
        provider_type: "null",
        name: "X",
        sync_mode: "inbound",
      });
      await service.create(PROJECT_ID, {
        provider_type: "null",
        name: "X",
        sync_mode: "bidirectional",
      });
    });

    it("accepts valid sync_transport values", async () => {
      const makeEntity = (sync_transport: string) => ({
        ...buildConnection({ sync_transport: sync_transport as never }),
        created_at: now,
        updated_at: now,
        last_sync_at: null,
        last_sync_error: null,
      });
      const mockProvider = {
        validateConfig: vi.fn().mockReturnValue(true),
        providerType: "null",
      };
      providerRegistry.resolve.mockReturnValue(mockProvider);
      connectionRepo.create.mockResolvedValueOnce(makeEntity("manual"));
      connectionRepo.create.mockResolvedValueOnce(makeEntity("webhook"));
      connectionRepo.create.mockResolvedValueOnce(makeEntity("polling"));
      connectionRepo.create.mockResolvedValueOnce(makeEntity("both"));

      await service.create(PROJECT_ID, {
        provider_type: "null",
        name: "X",
        sync_transport: "manual",
      });
      await service.create(PROJECT_ID, {
        provider_type: "null",
        name: "X",
        sync_transport: "webhook",
      });
      await service.create(PROJECT_ID, {
        provider_type: "null",
        name: "X",
        sync_transport: "polling",
      });
      await service.create(PROJECT_ID, {
        provider_type: "null",
        name: "X",
        sync_transport: "both",
      });
    });
  });

  describe("listByProject", () => {
    it("returns all connections for a project", async () => {
      const connections = [
        buildConnection(),
        buildConnection({ id: "c2", name: "Second" }),
      ];
      connectionRepo.listByProject.mockResolvedValue(
        connections.map((c) => ({
          ...c,
          created_at: now,
          updated_at: now,
          last_sync_at: null,
          last_sync_error: null,
        })),
      );

      const result = await service.listByProject(PROJECT_ID);

      expect(connectionRepo.listByProject).toHaveBeenCalledWith(PROJECT_ID);
      expect(result).toHaveLength(2);
      expect(result[0].created_at).toBe(nowIso);
    });
  });

  describe("getByProjectAndId", () => {
    it("returns a connection when found", async () => {
      const connection = buildConnection();
      connectionRepo.findByProjectAndId.mockResolvedValue({
        ...connection,
        created_at: now,
        updated_at: now,
        last_sync_at: null,
        last_sync_error: null,
      });

      const result = await service.getByProjectAndId(PROJECT_ID, CONNECTION_ID);

      expect(result.id).toBe(CONNECTION_ID);
      expect(connectionRepo.findByProjectAndId).toHaveBeenCalledWith(
        PROJECT_ID,
        CONNECTION_ID,
      );
    });

    it("throws NotFoundException when not found", async () => {
      connectionRepo.findByProjectAndId.mockResolvedValue(null);

      await expect(
        service.getByProjectAndId(PROJECT_ID, "missing"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("updateByProjectAndId", () => {
    it("updates mutable fields", async () => {
      const existing = buildConnection();
      connectionRepo.findByProjectAndId.mockResolvedValue({
        ...existing,
        created_at: now,
        updated_at: now,
        last_sync_at: null,
        last_sync_error: null,
      });
      const updated = buildConnection({ name: "Renamed", status: "paused" });
      connectionRepo.updateByProjectAndId.mockResolvedValue({
        ...updated,
        created_at: now,
        updated_at: now,
        last_sync_at: null,
        last_sync_error: null,
      });

      const result = await service.updateByProjectAndId(
        PROJECT_ID,
        CONNECTION_ID,
        {
          name: "Renamed",
          status: "paused",
        },
      );

      expect(result.name).toBe("Renamed");
      expect(result.status).toBe("paused");
      expect(connectionRepo.updateByProjectAndId).toHaveBeenCalledWith(
        PROJECT_ID,
        CONNECTION_ID,
        { name: "Renamed", status: "paused" },
      );
    });

    it("validates config with provider when config is updated", async () => {
      const existing = buildConnection();
      connectionRepo.findByProjectAndId.mockResolvedValue({
        ...existing,
        created_at: now,
        updated_at: now,
        last_sync_at: null,
        last_sync_error: null,
      });
      const mockProvider = {
        validateConfig: vi.fn().mockReturnValue(true),
        providerType: "null",
      };
      providerRegistry.resolve.mockReturnValue(mockProvider);
      connectionRepo.updateByProjectAndId.mockResolvedValue({
        ...existing,
        config: { newKey: "val" },
        created_at: now,
        updated_at: now,
        last_sync_at: null,
        last_sync_error: null,
      });

      const result = await service.updateByProjectAndId(
        PROJECT_ID,
        CONNECTION_ID,
        {
          config: { newKey: "val" },
        },
      );

      expect(mockProvider.validateConfig).toHaveBeenCalledWith({
        newKey: "val",
      });
      expect(result.config).toEqual({ newKey: "val" });
    });

    it("throws NotFoundException when connection does not exist", async () => {
      connectionRepo.findByProjectAndId.mockResolvedValue(null);

      await expect(
        service.updateByProjectAndId(PROJECT_ID, "missing", { name: "X" }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("throws BadRequestException when status is invalid", async () => {
      const existing = buildConnection();
      connectionRepo.findByProjectAndId.mockResolvedValue({
        ...existing,
        created_at: now,
        updated_at: now,
        last_sync_at: null,
        last_sync_error: null,
      });

      await expect(
        service.updateByProjectAndId(PROJECT_ID, CONNECTION_ID, {
          status: "bogus" as never,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("throws BadRequestException when sync_mode is invalid in update", async () => {
      const existing = buildConnection();
      connectionRepo.findByProjectAndId.mockResolvedValue({
        ...existing,
        created_at: now,
        updated_at: now,
        last_sync_at: null,
        last_sync_error: null,
      });

      await expect(
        service.updateByProjectAndId(PROJECT_ID, CONNECTION_ID, {
          sync_mode: "nope" as never,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("throws BadRequestException when sync_transport is invalid in update", async () => {
      const existing = buildConnection();
      connectionRepo.findByProjectAndId.mockResolvedValue({
        ...existing,
        created_at: now,
        updated_at: now,
        last_sync_at: null,
        last_sync_error: null,
      });

      await expect(
        service.updateByProjectAndId(PROJECT_ID, CONNECTION_ID, {
          sync_transport: "carrier_pigeon" as never,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("deleteByProjectAndId", () => {
    it("deletes and returns null", async () => {
      connectionRepo.deleteByProjectAndId.mockResolvedValue(true);

      const result = await service.deleteByProjectAndId(
        PROJECT_ID,
        CONNECTION_ID,
      );

      expect(result).toBeNull();
      expect(connectionRepo.deleteByProjectAndId).toHaveBeenCalledWith(
        PROJECT_ID,
        CONNECTION_ID,
      );
    });

    it("throws NotFoundException when not found", async () => {
      connectionRepo.deleteByProjectAndId.mockResolvedValue(false);

      await expect(
        service.deleteByProjectAndId(PROJECT_ID, "missing"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("test", () => {
    it("returns valid result when config is valid", async () => {
      const existing = buildConnection();
      connectionRepo.findByProjectAndId.mockResolvedValue({
        ...existing,
        created_at: now,
        updated_at: now,
        last_sync_at: null,
        last_sync_error: null,
      });
      const mockProvider = {
        validateConfig: vi.fn().mockReturnValue(true),
        providerType: "null",
      };
      providerRegistry.resolve.mockReturnValue(mockProvider);

      const result = await service.test(PROJECT_ID, CONNECTION_ID);

      expect(result).toEqual({ provider_type: "null", valid: true });
      expect(mockProvider.validateConfig).toHaveBeenCalledWith(existing.config);
    });

    it("throws BadRequestException when config is invalid", async () => {
      const existing = buildConnection();
      connectionRepo.findByProjectAndId.mockResolvedValue({
        ...existing,
        created_at: now,
        updated_at: now,
        last_sync_at: null,
        last_sync_error: null,
      });
      const mockProvider = {
        validateConfig: vi.fn().mockReturnValue(false),
        providerType: "null",
      };
      providerRegistry.resolve.mockReturnValue(mockProvider);

      await expect(
        service.test(PROJECT_ID, CONNECTION_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("throws NotFoundException when connection not found", async () => {
      connectionRepo.findByProjectAndId.mockResolvedValue(null);

      await expect(service.test(PROJECT_ID, "missing")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("pause", () => {
    it("sets status to paused and returns connection", async () => {
      const existing = buildConnection();
      connectionRepo.findByProjectAndId.mockResolvedValue({
        ...existing,
        created_at: now,
        updated_at: now,
        last_sync_at: null,
        last_sync_error: null,
      });
      const paused = buildConnection({ status: "paused" });
      connectionRepo.updateByProjectAndId.mockResolvedValue({
        ...paused,
        created_at: now,
        updated_at: now,
        last_sync_at: null,
        last_sync_error: null,
      });

      const result = await service.pause(PROJECT_ID, CONNECTION_ID);

      expect(connectionRepo.updateByProjectAndId).toHaveBeenCalledWith(
        PROJECT_ID,
        CONNECTION_ID,
        { status: "paused" },
      );
      expect(result.status).toBe("paused");
    });

    it("throws NotFoundException when connection not found", async () => {
      connectionRepo.findByProjectAndId.mockResolvedValue(null);

      await expect(service.pause(PROJECT_ID, "missing")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("resume", () => {
    it("sets status to active and returns connection", async () => {
      const existing = buildConnection({ status: "paused" });
      connectionRepo.findByProjectAndId.mockResolvedValue({
        ...existing,
        created_at: now,
        updated_at: now,
        last_sync_at: null,
        last_sync_error: null,
      });
      const active = buildConnection({ status: "active" });
      connectionRepo.updateByProjectAndId.mockResolvedValue({
        ...active,
        created_at: now,
        updated_at: now,
        last_sync_at: null,
        last_sync_error: null,
      });

      const result = await service.resume(PROJECT_ID, CONNECTION_ID);

      expect(connectionRepo.updateByProjectAndId).toHaveBeenCalledWith(
        PROJECT_ID,
        CONNECTION_ID,
        { status: "active" },
      );
      expect(result.status).toBe("active");
    });

    it("throws NotFoundException when connection not found", async () => {
      connectionRepo.findByProjectAndId.mockResolvedValue(null);

      await expect(
        service.resume(PROJECT_ID, "missing"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("listOperations", () => {
    it("returns operation logs for a connection within a project", async () => {
      const existing = buildConnection();
      connectionRepo.findByProjectAndId.mockResolvedValue({
        ...existing,
        created_at: now,
        updated_at: now,
        last_sync_at: null,
        last_sync_error: null,
      });
      operationLogRepo.listByConnection.mockResolvedValue([buildOperation()]);

      const result = await service.listOperations(PROJECT_ID, CONNECTION_ID);

      expect(connectionRepo.findByProjectAndId).toHaveBeenCalledWith(
        PROJECT_ID,
        CONNECTION_ID,
      );
      expect(operationLogRepo.listByConnection).toHaveBeenCalledWith(
        CONNECTION_ID,
        50,
        0,
      );
      expect(result).toHaveLength(1);
    });

    it("passes limit and offset to repository", async () => {
      const existing = buildConnection();
      connectionRepo.findByProjectAndId.mockResolvedValue({
        ...existing,
        created_at: now,
        updated_at: now,
        last_sync_at: null,
        last_sync_error: null,
      });
      operationLogRepo.listByConnection.mockResolvedValue([]);

      await service.listOperations(PROJECT_ID, CONNECTION_ID, 10, 5);

      expect(operationLogRepo.listByConnection).toHaveBeenCalledWith(
        CONNECTION_ID,
        10,
        5,
      );
    });

    it("throws NotFoundException when connection not found in project", async () => {
      connectionRepo.findByProjectAndId.mockResolvedValue(null);

      await expect(
        service.listOperations(PROJECT_ID, "missing"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("sync", () => {
    it("delegates inbound sync to the coordinator", async () => {
      const syncResult = {
        processed: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
      };
      syncCoordinator.sync.mockResolvedValue(syncResult);

      const result = await service.sync(PROJECT_ID, CONNECTION_ID);

      expect(result).toBe(syncResult);
      expect(syncCoordinator.sync).toHaveBeenCalledWith(
        PROJECT_ID,
        CONNECTION_ID,
      );
    });
  });

  describe("import", () => {
    it("delegates manual import to the coordinator", async () => {
      const importResult = {
        processed: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
      };
      syncCoordinator.importTickets.mockResolvedValue(importResult);

      const result = await service.import(PROJECT_ID, CONNECTION_ID);

      expect(result).toBe(importResult);
      expect(syncCoordinator.importTickets).toHaveBeenCalledWith(
        PROJECT_ID,
        CONNECTION_ID,
      );
    });
  });

  describe("exportWorkItems", () => {
    it("delegates export to OutboundSyncService", async () => {
      const exportResult = {
        processed: 2,
        created: 0,
        updated: 2,
        skipped: 0,
        failed: 0,
      };
      mockOutboundSync.exportWorkItems.mockResolvedValue(exportResult);

      const result = await service.exportWorkItems(PROJECT_ID, CONNECTION_ID);

      expect(result).toBe(exportResult);
      expect(mockOutboundSync.exportWorkItems).toHaveBeenCalledWith(
        PROJECT_ID,
        CONNECTION_ID,
      );
    });
  });
});

describe("ExternalSyncModule DI wiring", () => {
  it("resolves ProviderRegistryService with the null provider", async () => {
    const module = await Test.createTestingModule({
      imports: [ExternalSyncModule],
    })
      .useMocker((token) => {
        if (token === KanbanExternalConnectionRepository) {
          return {};
        }
        if (token === KanbanSyncOperationLogRepository) {
          return {};
        }
        if (token === KanbanWorkItemRepository) {
          return {};
        }
        if (token === SyncCoordinatorService) {
          return {};
        }
        if (token === OutboundSyncService) {
          return {};
        }
        return {};
      })
      .compile();

    const registry = module.get(ProviderRegistryService);
    expect(registry).toBeDefined();

    const provider = registry.resolve("null");
    expect(provider.providerType).toBe("null");
  });
});
