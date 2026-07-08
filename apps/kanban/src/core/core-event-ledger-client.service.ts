import type {
  CoreEventLedgerClient,
  EventLedgerPayload,
} from "./core-client.types";
import { KanbanCoreHttpClient } from "./kanban-core-http-client";

export class CoreEventLedgerClientService implements CoreEventLedgerClient {
  constructor(private readonly httpClient: KanbanCoreHttpClient) {}

  async emitEventLedger(payload: EventLedgerPayload): Promise<void> {
    await this.httpClient.postJson<Record<string, unknown>>(
      "/events/internal",
      payload,
      "event ledger emission",
    );
  }
}
