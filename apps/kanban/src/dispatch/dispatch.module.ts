import { forwardRef, Module } from "@nestjs/common";
import { CoreIntegrationModule } from "../core/core-integration.module";
import { ProjectModule } from "../project/project.module";
import { KanbanSettingsModule } from "../settings/kanban-settings.module";
import { WorkItemModule } from "../work-item/work-item.module";
import { DispatchController } from "./dispatch.controller";
import { DispatchService } from "./dispatch.service";

@Module({
  imports: [
    forwardRef(() => CoreIntegrationModule),
    WorkItemModule,
    KanbanSettingsModule,
    ProjectModule,
  ],
  controllers: [DispatchController],
  providers: [DispatchService],
  exports: [DispatchService],
})
export class DispatchModule {}
