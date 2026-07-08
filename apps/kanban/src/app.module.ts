import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { CorrelationIdMiddleware } from "@nexus/core";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { RequestContextModule } from "./common/request-context.module";
import { CoreIntegrationModule } from "./core/core-integration.module";
import { DatabaseModule } from "./database/database.module";
import { DispatchModule } from "./dispatch/dispatch.module";
import { ProjectGoalsModule } from "./goals/project-goals.module";
import { InitiativesModule } from "./initiatives/initiatives.module";
import { OrchestrationModule } from "./orchestration/orchestration.module";
import { ProjectModule } from "./project/project.module";
import { ReviewModule } from "./review/review.module";
import { WorkItemModule } from "./work-item/work-item.module";
import { CostEstimationModule } from "./work-item/cost-estimation/cost-estimation.module";
import { KanbanMcpModule } from "./mcp/kanban-mcp.module";
import { RetrospectivesModule } from "./retrospectives/retrospectives.module";
import { KanbanSettingsModule } from "./settings/kanban-settings.module";
import { ExternalSyncModule } from "./external-sync/external-sync.module";

@Module({
  imports: [
    RequestContextModule,
    DatabaseModule,
    CoreIntegrationModule,
    ProjectModule,
    ProjectGoalsModule,
    InitiativesModule,
    WorkItemModule,
    CostEstimationModule,
    DispatchModule,
    OrchestrationModule,
    ReviewModule,
    KanbanMcpModule,
    RetrospectivesModule,
    KanbanSettingsModule,
    ExternalSyncModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes("*");
  }
}
