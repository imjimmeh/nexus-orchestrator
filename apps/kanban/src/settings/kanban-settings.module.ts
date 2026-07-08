import { Module } from "@nestjs/common";
import { KanbanSettingsController } from "./kanban-settings.controller";
import { KanbanSettingsService } from "./kanban-settings.service";

@Module({
  controllers: [KanbanSettingsController],
  providers: [KanbanSettingsService],
  exports: [KanbanSettingsService],
})
export class KanbanSettingsModule {}
