import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  NotFoundException,
  Param,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import { InboundSyncService } from "../sync-engine/inbound-sync.service.js";
import { ProviderRegistryService } from "../providers/provider-registry.service.js";
import { KanbanExternalConnectionRepository } from "../../database/repositories/kanban-external-connection.repository.js";
import type { InboundTicketSyncResult } from "../external-sync.types.js";

@Controller("external-sync")
export class WebhookReceiverController {
  constructor(
    private readonly connections: KanbanExternalConnectionRepository,
    private readonly providerRegistry: ProviderRegistryService,
    private readonly inboundSync: InboundSyncService,
  ) {}

  @Post("webhook/:connectionId")
  async receiveWebhook(
    @Param("connectionId") connectionId: string,
    @Body() body: unknown,
    @Headers("x-signature") signature?: string,
  ): Promise<{ success: boolean; data: InboundTicketSyncResult[] }> {
    const connection = await this.connections.findById(connectionId);
    if (!connection) {
      throw new NotFoundException("External connection not found");
    }

    if (connection.status !== "active") {
      throw new BadRequestException("External connection is not active");
    }

    const provider = this.providerRegistry.resolve(connection.provider_type);

    const isValid = provider.validateWebhookSignature(
      body,
      signature ?? "",
      undefined,
    );
    if (!isValid) {
      throw new UnauthorizedException("Invalid webhook signature");
    }

    const events = provider.parseWebhookEvents(body);
    const results: InboundTicketSyncResult[] = [];

    for (const event of events) {
      if (event.action === "deleted") {
        results.push(
          await this.inboundSync.processDeletedEvent(connection, event, "sync"),
        );
      } else if (event.ticket) {
        results.push(
          await this.inboundSync.processTicket(
            connection,
            event.ticket,
            "sync",
          ),
        );
      }
    }

    return { success: true, data: results };
  }
}
