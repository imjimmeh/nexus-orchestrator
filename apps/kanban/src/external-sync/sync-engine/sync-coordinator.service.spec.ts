import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { KanbanExternalConnectionEntity } from "../../database/entities/kanban-external-connection.entity.js";
import { KanbanExternalConnectionRepository } from "../../database/repositories/kanban-external-connection.repository.js";
import { KanbanSyncOperationLogRepository } from "../../database/repositories/kanban-sync-operation-log.repository.js";
import type { IExternalTicketProvider } from "../providers/external-ticket-provider.types.js";
import { ProviderRegistryService } from "../providers/provider-registry.service.js";
import { InboundSyncService } from "./inbound-sync.service.js";
import { SyncCoordinatorService } from "./sync-coordinator.service.js";

const PROJECT_ID = "550e8400-e29b-41d4-a716-446655440000";
const CONNECTION_ID = "660e8400-e29b-41d4-a716-446655440001";

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

function createService() {
  const connectionRepo = {
    findByProjectAndId: vi.fn(),
    markSyncFailure: vi.fn(),
    markSyncSuccess: vi.fn(),
  };
  const provider = {
    fetchTickets: vi.fn(),
  };
  const providerRegistry = {
    resolve: vi.fn().mockReturnValue(provider),
  };
  const inboundSync = {
    processTicket: vi.fn(),
  };
  const operationLogRepo = {
    createOperation: vi.fn(),
    completeOperation: vi.fn(),
  };

  const service = new SyncCoordinatorService(
    connectionRepo as unknown as KanbanExternalConnectionRepository,
    providerRegistry as unknown as ProviderRegistryService,
    inboundSync as unknown as InboundSyncService,
    operationLogRepo as unknown as KanbanSyncOperationLogRepository,
  );

  operationLogRepo.createOperation.mockResolvedValue({ id: "op-1" });
  operationLogRepo.completeOperation.mockResolvedValue({ id: "op-1" });

  return {
    connectionRepo,
    inboundSync,
    operationLogRepo,
    provider: provider as unknown as Pick<
      IExternalTicketProvider,
      "fetchTickets"
    > & { fetchTickets: ReturnType<typeof vi.fn> },
    service,
  };
}

describe("SyncCoordinatorService", () => {
  it("imports paginated tickets and returns processed counts", async () => {
    const { connectionRepo, inboundSync, provider, service } = createService();
    const connection = buildConnection();
    connectionRepo.findByProjectAndId.mockResolvedValue(connection);
    provider.fetchTickets
      .mockResolvedValueOnce({
        items: [{ id: "EXT-1", title: "One" }],
        nextCursor: "cursor-2",
        hasMore: true,
      })
      .mockResolvedValueOnce({
        items: [{ id: "EXT-2", title: "Two" }],
        hasMore: false,
      });
    inboundSync.processTicket
      .mockResolvedValueOnce({ action: "created", status: "success" })
      .mockResolvedValueOnce({ action: "skipped", status: "skipped" });

    const result = await service.importTickets(PROJECT_ID, CONNECTION_ID);

    expect(provider.fetchTickets).toHaveBeenNthCalledWith(1, undefined);
    expect(provider.fetchTickets).toHaveBeenNthCalledWith(2, {
      cursor: "cursor-2",
    });
    expect(inboundSync.processTicket).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      processed: 2,
      created: 1,
      updated: 0,
      skipped: 1,
      failed: 0,
    });
    expect(connectionRepo.markSyncSuccess).toHaveBeenCalledWith(
      CONNECTION_ID,
      expect.any(Date),
    );
  });

  it("exits pagination loop when hasMore is false and nextCursor is undefined", async () => {
    const { connectionRepo, inboundSync, provider, service } = createService();
    const connection = buildConnection();
    connectionRepo.findByProjectAndId.mockResolvedValue(connection);
    provider.fetchTickets.mockResolvedValueOnce({
      items: [{ id: "EXT-1", title: "One" }],
      hasMore: false,
    });
    inboundSync.processTicket.mockResolvedValueOnce({
      action: "created",
      status: "success",
    });

    const result = await service.importTickets(PROJECT_ID, CONNECTION_ID);

    expect(provider.fetchTickets).toHaveBeenCalledTimes(1);
    expect(result.processed).toBe(1);
    expect(connectionRepo.markSyncSuccess).toHaveBeenCalledWith(
      CONNECTION_ID,
      expect.any(Date),
    );
  });

  it("exits pagination loop when nextCursor is empty string despite hasMore being true", async () => {
    const { connectionRepo, inboundSync, provider, service } = createService();
    const connection = buildConnection();
    connectionRepo.findByProjectAndId.mockResolvedValue(connection);
    provider.fetchTickets.mockResolvedValueOnce({
      items: [
        { id: "EXT-1", title: "One" },
        { id: "EXT-2", title: "Two" },
      ],
      nextCursor: "",
      hasMore: true,
    });
    inboundSync.processTicket
      .mockResolvedValueOnce({ action: "created", status: "success" })
      .mockResolvedValueOnce({ action: "updated", status: "success" });

    const result = await service.importTickets(PROJECT_ID, CONNECTION_ID);

    expect(provider.fetchTickets).toHaveBeenCalledTimes(1);
    expect(result.processed).toBe(2);
    expect(connectionRepo.markSyncSuccess).toHaveBeenCalledWith(
      CONNECTION_ID,
      expect.any(Date),
    );
  });

  it("logs provider fetch failures, marks the connection failed, and rethrows", async () => {
    const { connectionRepo, operationLogRepo, provider, service } =
      createService();
    const connection = buildConnection();
    const failure = new Error("provider unavailable");
    connectionRepo.findByProjectAndId.mockResolvedValue(connection);
    provider.fetchTickets.mockRejectedValue(failure);

    await expect(service.sync(PROJECT_ID, CONNECTION_ID)).rejects.toThrow(
      failure,
    );

    expect(operationLogRepo.createOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        connection_id: CONNECTION_ID,
        project_id: PROJECT_ID,
        direction: "inbound",
        operation: "sync",
        status: "pending",
      }),
    );
    expect(operationLogRepo.completeOperation).toHaveBeenCalledWith(
      "op-1",
      "failed",
      "provider unavailable",
      expect.objectContaining({ action: "fetchTickets" }),
    );
    expect(connectionRepo.markSyncFailure).toHaveBeenCalledWith(
      CONNECTION_ID,
      "provider unavailable",
    );
  });

  it("throws NotFoundException when the connection is not in the project", async () => {
    const { connectionRepo, service } = createService();
    connectionRepo.findByProjectAndId.mockResolvedValue(null);

    await expect(service.sync(PROJECT_ID, "missing")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
