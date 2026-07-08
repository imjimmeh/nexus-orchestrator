import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ConflictResolverService } from "./sync-engine/conflict-resolver.service.js";
import { FieldMapperService } from "./sync-engine/field-mapper.service.js";
import { InboundSyncService } from "./sync-engine/inbound-sync.service.js";
import { OutboundSyncService } from "./sync-engine/outbound-sync.service.js";
import { SyncCoordinatorService } from "./sync-engine/sync-coordinator.service.js";
import { ExternalSyncController } from "./external-sync.controller.js";
import { ExternalSyncService } from "./external-sync.service.js";
import { ExternalSyncPollingProcessor } from "./transport/external-sync-polling.processor.js";
import { ExternalSyncPollingScheduler } from "./transport/external-sync-polling.scheduler.js";
import { ProviderRegistryService } from "./providers/provider-registry.service.js";
import { NullExternalTicketProvider } from "./providers/null-external-ticket.provider.js";
import { WebhookReceiverController } from "./transport/webhook-receiver.controller.js";
import { EXTERNAL_TICKET_PROVIDER } from "./providers/external-ticket-provider.tokens.js";
import { EXTERNAL_SYNC_POLLING_QUEUE } from "./transport/external-sync-polling.queue.js";
import { OUTBOUND_SYNC_SERVICE } from "./outbound-sync.types.js";
import type { IExternalTicketProvider } from "./providers/external-ticket-provider.types.js";

@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: {
          host:
            process.env["KANBAN_REDIS_HOST"] ||
            process.env["REDIS_HOST"] ||
            "localhost",
          port: Number(
            process.env["KANBAN_REDIS_PORT"] ||
              process.env["REDIS_PORT"] ||
              6379,
          ),
          password:
            process.env["KANBAN_REDIS_PASSWORD"] ||
            process.env["REDIS_PASSWORD"] ||
            undefined,
        },
      }),
    }),
    BullModule.registerQueue({ name: EXTERNAL_SYNC_POLLING_QUEUE }),
  ],
  controllers: [ExternalSyncController, WebhookReceiverController],
  providers: [
    ConflictResolverService,
    ExternalSyncPollingProcessor,
    ExternalSyncPollingScheduler,
    ExternalSyncService,
    FieldMapperService,
    InboundSyncService,
    OutboundSyncService,
    ProviderRegistryService,
    SyncCoordinatorService,
    {
      provide: OUTBOUND_SYNC_SERVICE,
      useExisting: OutboundSyncService,
    },
    {
      provide: EXTERNAL_TICKET_PROVIDER,
      useFactory: (): IExternalTicketProvider[] => {
        const provider = new NullExternalTicketProvider();
        return [provider];
      },
    },
  ],
  exports: [
    ConflictResolverService,
    FieldMapperService,
    OUTBOUND_SYNC_SERVICE,
    OutboundSyncService,
    ProviderRegistryService,
    SyncCoordinatorService,
  ],
})
export class ExternalSyncModule {}
