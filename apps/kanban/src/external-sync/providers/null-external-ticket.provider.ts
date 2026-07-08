import { Injectable } from "@nestjs/common";
import type {
  ExternalTicket,
  ExternalTicketChangeEvent,
  IExternalTicketProvider,
  PaginatedResult,
  ProviderCapabilities,
} from "./external-ticket-provider.types.js";

@Injectable()
export class NullExternalTicketProvider implements IExternalTicketProvider {
  readonly providerType = "null";

  readonly capabilities: ProviderCapabilities = {
    supportsCreate: false,
    supportsUpdate: false,
    supportsDelete: false,
    supportsWebhooks: false,
    supportsPolling: false,
    supportsComments: false,
    supportsAttachments: false,
  };

  validateConfig(config: unknown): boolean {
    if (config === null || config === undefined) {
      return false;
    }
    if (typeof config !== "object") {
      return false;
    }
    return true;
  }

  fetchTickets(_params?: unknown): Promise<PaginatedResult<ExternalTicket>> {
    return Promise.resolve({ items: [], hasMore: false });
  }

  fetchTicket(_externalId: string): Promise<ExternalTicket | null> {
    return Promise.resolve(null);
  }

  createTicket(data: Partial<ExternalTicket>): Promise<ExternalTicket> {
    const id = `null-${Date.now()}`;
    return Promise.resolve({ ...data, id, title: data.title ?? id });
  }

  updateTicket(
    externalId: string,
    data: Partial<ExternalTicket>,
  ): Promise<ExternalTicket> {
    return Promise.resolve({
      ...data,
      id: externalId,
      title: data.title ?? externalId,
    });
  }

  deleteTicket(_externalId: string): Promise<void> {
    return Promise.resolve();
  }

  validateWebhookSignature(
    _payload: unknown,
    _signature: string,
    _secret?: string,
  ): boolean {
    return true;
  }

  parseWebhookEvents(_payload: unknown): ExternalTicketChangeEvent[] {
    return [];
  }
}
