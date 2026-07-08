import { forwardRef, Module } from "@nestjs/common";
import { KanbanPermissionsGuard } from "../common/kanban-permissions.guard";
import { ProjectModule } from "../project/project.module";
import { ProjectGoalsController } from "./project-goals.controller";
import { ProjectGoalsService } from "./project-goals.service";

@Module({
  imports: [forwardRef(() => ProjectModule)],
  controllers: [ProjectGoalsController],
  providers: [ProjectGoalsService, KanbanPermissionsGuard],
  exports: [ProjectGoalsService],
})
export class ProjectGoalsModule {}
