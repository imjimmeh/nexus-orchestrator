import { forwardRef, Module } from "@nestjs/common";
import type Redis from "ioredis";
import { CoreIntegrationModule } from "../core/core-integration.module";
import { OrchestrationModule } from "../orchestration/orchestration.module";
import { ExternalSyncModule } from "../external-sync/external-sync.module.js";
import { KanbanSettingsModule } from "../settings/kanban-settings.module";
import { KANBAN_REDIS_CLIENT } from "../core/kanban-redis.constants";
import { KanbanPermissionsGuard } from "../common/kanban-permissions.guard";
import { CostEstimationModule } from "./cost-estimation/cost-estimation.module";
import { WorkItemController } from "./work-item.controller";
import { WorkItemGlobalController } from "./work-item-global.controller";
import { WorkItemService } from "./work-item.service";
import { KanbanLifecycleEventPublisher } from "./kanban-lifecycle-event-publisher";
import { WorkItemRealtimeGateway } from "./work-item-realtime.gateway";
import { WorkItemRealtimePublisher } from "./work-item-realtime.publisher";
import { WorkItemRunLeaseService } from "./work-item-run-lease";

@Module({
  imports: [
    forwardRef(() => CoreIntegrationModule),
    forwardRef(() => CostEstimationModule),
    forwardRef(() => ExternalSyncModule),
    forwardRef(() => OrchestrationModule),
    KanbanSettingsModule,
  ],
  controllers: [WorkItemController, WorkItemGlobalController],
  providers: [
    WorkItemService,
    KanbanLifecycleEventPublisher,
    KanbanPermissionsGuard,
    WorkItemRealtimeGateway,
    WorkItemRunLeaseService,
    {
      provide: WorkItemRealtimePublisher,
      useFactory: (redis: Redis) => new WorkItemRealtimePublisher(redis),
      inject: [KANBAN_REDIS_CLIENT],
    },
  ],
  exports: [
    WorkItemService,
    WorkItemRealtimeGateway,
    WorkItemRealtimePublisher,
    WorkItemRunLeaseService,
  ],
})
export class WorkItemModule {
  protected readonly moduleName = WorkItemModule.name;
}
