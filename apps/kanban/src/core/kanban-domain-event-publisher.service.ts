import type { KanbanDomainEventPublisher } from "./core-client.types";
import { KanbanCoreHttpClient } from "./kanban-core-http-client";

export class KanbanDomainEventPublisherService implements KanbanDomainEventPublisher {
  constructor(private readonly httpClient: KanbanCoreHttpClient) {}

  async emitDomainEvent(params: {
    eventName: string;
    eventId?: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await this.httpClient.postJson<Record<string, unknown>>(
      "/internal/kanban/events",
      params,
      "domain event emission",
    );
  }
}
