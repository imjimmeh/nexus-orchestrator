import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type {
  ExternalTicket,
  ExternalTicketChangeEvent,
} from "../providers/external-ticket-provider.types.js";
import type { IExternalTicketProvider } from "../providers/external-ticket-provider.types.js";
import type { KanbanExternalConnectionEntity } from "../../database/entities/kanban-external-connection.entity.js";
import { WebhookReceiverController } from "./webhook-receiver.controller.js";

const CONNECTION_ID = "660e8400-e29b-41d4-a716-446655440001";

function mockConnection(
  overrides: Partial<KanbanExternalConnectionEntity> = {},
): KanbanExternalConnectionEntity {
  return {
    id: CONNECTION_ID,
    project_id: "project-1",
    provider_type: "github",
    name: "GitHub Sync",
    status: "active",
    sync_mode: "bidirectional",
    sync_transport: "webhook",
    config: { repo: "org/repo" },
    field_mapping: {},
    webhook_secret_ref: "secret-ref-1",
    poll_interval_seconds: null,
    last_sync_at: null,
    last_sync_error: null,
    created_at: new Date("2026-06-01T00:00:00.000Z"),
    updated_at: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides,
  };
}

function mockTicket(overrides: Partial<ExternalTicket> = {}): ExternalTicket {
  return {
    id: "ext-456",
    title: "Fix login bug",
    description: "Users cannot log in",
    status: "open",
    priority: "high",
    url: "https://github.com/org/repo/issues/456",
    assignee: "dev1",
    labels: ["bug"],
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function mockChangeEvent(
  overrides: Partial<ExternalTicketChangeEvent> = {},
): ExternalTicketChangeEvent {
  return {
    externalId: "ext-456",
    action: "created",
    ticket: mockTicket(),
    timestamp: "2026-06-01T00:00:00.000Z",
    connectionId: CONNECTION_ID,
    ...overrides,
  };
}

function mockProvider(
  overrides: Partial<IExternalTicketProvider> = {},
): IExternalTicketProvider {
  return {
    providerType: "github",
    capabilities: {
      supportsCreate: true,
      supportsUpdate: true,
      supportsDelete: true,
      supportsWebhooks: true,
      supportsPolling: true,
      supportsComments: false,
      supportsAttachments: false,
    },
    validateConfig: vi.fn().mockResolvedValue(true),
    fetchTickets: vi.fn(),
    fetchTicket: vi.fn(),
    createTicket: vi.fn(),
    updateTicket: vi.fn(),
    deleteTicket: vi.fn(),
    validateWebhookSignature: vi.fn().mockReturnValue(true),
    parseWebhookEvents: vi.fn().mockReturnValue([]),
    ...overrides,
  };
}

describe("WebhookReceiverController", () => {
  function createController() {
    const findByIdMock = vi.fn();
    const resolveMock = vi.fn();
    const processTicketMock = vi.fn();
    const processDeletedEventMock = vi.fn();

    const connections = {
      findById: findByIdMock,
    };

    const providerRegistry = {
      resolve: resolveMock,
    };

    const inboundSync = {
      processTicket: processTicketMock,
      processDeletedEvent: processDeletedEventMock,
    };

    const controller = new WebhookReceiverController(
      connections as never,
      providerRegistry as never,
      inboundSync as never,
    );

    return {
      controller,
      findByIdMock,
      resolveMock,
      processTicketMock,
      processDeletedEventMock,
    };
  }

  describe("POST /external-sync/webhook/:connectionId", () => {
    it("accepted webhook: valid signature, active connection, parses events, calls processTicket", async () => {
      const { controller, findByIdMock, resolveMock, processTicketMock } =
        createController();
      const connection = mockConnection();
      const ticket = mockTicket();
      const event = mockChangeEvent({ action: "created", ticket });
      const provider = mockProvider({
        validateWebhookSignature: vi.fn().mockReturnValue(true),
        parseWebhookEvents: vi.fn().mockReturnValue([event]),
      });

      findByIdMock.mockResolvedValue(connection);
      resolveMock.mockReturnValue(provider);
      processTicketMock.mockResolvedValue({
        action: "created",
        status: "success",
      });

      const result = await controller.receiveWebhook(
        CONNECTION_ID,
        { event: "issues", action: "opened" },
        "sha256=abc123",
      );

      expect(findByIdMock).toHaveBeenCalledWith(CONNECTION_ID);
      expect(resolveMock).toHaveBeenCalledWith("github");
      expect((provider as any).validateWebhookSignature).toHaveBeenCalledWith(
        { event: "issues", action: "opened" },
        "sha256=abc123",
        undefined,
      );
      expect((provider as any).parseWebhookEvents).toHaveBeenCalledWith({
        event: "issues",
        action: "opened",
      });
      expect(processTicketMock).toHaveBeenCalledWith(
        connection,
        ticket,
        "sync",
      );
      expect(result).toEqual({
        success: true,
        data: [{ action: "created", status: "success" }],
      });
    });

    it("invalid signature: provider rejects signature → UnauthorizedException", async () => {
      const { controller, findByIdMock, resolveMock } = createController();
      const connection = mockConnection();
      const provider = mockProvider({
        validateWebhookSignature: vi.fn().mockReturnValue(false),
      });

      findByIdMock.mockResolvedValue(connection);
      resolveMock.mockReturnValue(provider);

      await expect(
        controller.receiveWebhook(
          CONNECTION_ID,
          { test: true },
          "bad-signature",
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("inactive/paused connection: status is not active → BadRequestException", async () => {
      const { controller, findByIdMock } = createController();
      const connection = mockConnection({ status: "paused" });

      findByIdMock.mockResolvedValue(connection);

      await expect(
        controller.receiveWebhook(CONNECTION_ID, { test: true }, "sha256=abc"),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("connection not found: no record → NotFoundException", async () => {
      const { controller, findByIdMock } = createController();

      findByIdMock.mockResolvedValue(null);

      await expect(
        controller.receiveWebhook("nonexistent", { test: true }, "sha256=abc"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("provider parse failure: valid signature but event parsing throws → error returned", async () => {
      const {
        controller,
        findByIdMock,
        resolveMock,
        processTicketMock,
        processDeletedEventMock,
      } = createController();
      const connection = mockConnection();
      const provider = mockProvider({
        validateWebhookSignature: vi.fn().mockReturnValue(true),
        parseWebhookEvents: vi.fn().mockImplementation(() => {
          throw new Error("Failed to parse webhook payload");
        }),
      });

      findByIdMock.mockResolvedValue(connection);
      resolveMock.mockReturnValue(provider);

      await expect(
        controller.receiveWebhook(
          CONNECTION_ID,
          { malformed: true },
          "sha256=abc",
        ),
      ).rejects.toThrow("Failed to parse webhook payload");
      expect(processTicketMock).not.toHaveBeenCalled();
      expect(processDeletedEventMock).not.toHaveBeenCalled();
    });

    it("multiple events: each event processed individually", async () => {
      const { controller, findByIdMock, resolveMock, processTicketMock } =
        createController();
      const connection = mockConnection();
      const ticket1 = mockTicket({ id: "ext-1", title: "Bug A" });
      const ticket2 = mockTicket({ id: "ext-2", title: "Bug B" });
      const event1 = mockChangeEvent({
        externalId: "ext-1",
        action: "created",
        ticket: ticket1,
      });
      const event2 = mockChangeEvent({
        externalId: "ext-2",
        action: "updated",
        ticket: ticket2,
      });
      const provider = mockProvider({
        validateWebhookSignature: vi.fn().mockReturnValue(true),
        parseWebhookEvents: vi.fn().mockReturnValue([event1, event2]),
      });

      findByIdMock.mockResolvedValue(connection);
      resolveMock.mockReturnValue(provider);
      processTicketMock
        .mockResolvedValueOnce({ action: "created", status: "success" })
        .mockResolvedValueOnce({ action: "updated", status: "success" });

      const result = await controller.receiveWebhook(
        CONNECTION_ID,
        { events: "batch" },
        "sha256=abc",
      );

      expect(processTicketMock).toHaveBeenCalledTimes(2);
      expect(processTicketMock).toHaveBeenNthCalledWith(
        1,
        connection,
        ticket1,
        "sync",
      );
      expect(processTicketMock).toHaveBeenNthCalledWith(
        2,
        connection,
        ticket2,
        "sync",
      );
      expect(result).toEqual({
        success: true,
        data: [
          { action: "created", status: "success" },
          { action: "updated", status: "success" },
        ],
      });
    });

    it("deleted event: parsed event has action 'deleted' → calls processDeletedEvent", async () => {
      const {
        controller,
        findByIdMock,
        resolveMock,
        processTicketMock,
        processDeletedEventMock,
      } = createController();
      const connection = mockConnection();
      const event = mockChangeEvent({ action: "deleted", ticket: undefined });
      const provider = mockProvider({
        validateWebhookSignature: vi.fn().mockReturnValue(true),
        parseWebhookEvents: vi.fn().mockReturnValue([event]),
      });

      findByIdMock.mockResolvedValue(connection);
      resolveMock.mockReturnValue(provider);
      processDeletedEventMock.mockResolvedValue({
        action: "deleted",
        status: "success",
      });

      const result = await controller.receiveWebhook(
        CONNECTION_ID,
        { event: "issues", action: "deleted" },
        "sha256=abc",
      );

      expect(processDeletedEventMock).toHaveBeenCalledWith(
        connection,
        event,
        "sync",
      );
      expect(processTicketMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        data: [{ action: "deleted", status: "success" }],
      });
    });

    it("handles mixed events: created and deleted in same payload", async () => {
      const {
        controller,
        findByIdMock,
        resolveMock,
        processTicketMock,
        processDeletedEventMock,
      } = createController();
      const connection = mockConnection();
      const ticket = mockTicket();
      const createdEvent = mockChangeEvent({ action: "created", ticket });
      const deletedEvent = mockChangeEvent({
        externalId: "ext-789",
        action: "deleted",
        ticket: undefined,
      });
      const provider = mockProvider({
        validateWebhookSignature: vi.fn().mockReturnValue(true),
        parseWebhookEvents: vi
          .fn()
          .mockReturnValue([createdEvent, deletedEvent]),
      });

      findByIdMock.mockResolvedValue(connection);
      resolveMock.mockReturnValue(provider);
      processTicketMock.mockResolvedValue({
        action: "created",
        status: "success",
      });
      processDeletedEventMock.mockResolvedValue({
        action: "deleted",
        status: "success",
      });

      const result = await controller.receiveWebhook(
        CONNECTION_ID,
        { mixed: true },
        "sha256=abc",
      );

      expect(processTicketMock).toHaveBeenCalledTimes(1);
      expect(processTicketMock).toHaveBeenCalledWith(
        connection,
        ticket,
        "sync",
      );
      expect(processDeletedEventMock).toHaveBeenCalledTimes(1);
      expect(processDeletedEventMock).toHaveBeenCalledWith(
        connection,
        deletedEvent,
        "sync",
      );
      expect(result).toEqual({
        success: true,
        data: [
          { action: "created", status: "success" },
          { action: "deleted", status: "success" },
        ],
      });
    });
  });
});
