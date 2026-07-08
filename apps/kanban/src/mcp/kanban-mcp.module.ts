import { Module } from "@nestjs/common";
import type { IInternalToolHandler } from "@nexus/core";
import { CoreIntegrationModule } from "../core/core-integration.module";
import { ProjectGoalsModule } from "../goals/project-goals.module";
import { OrchestrationModule } from "../orchestration/orchestration.module";
import { ProjectModule } from "../project/project.module";
import { ReviewModule } from "../review/review.module";
import { RetrospectivesModule } from "../retrospectives/retrospectives.module";
import { KanbanSettingsModule } from "../settings/kanban-settings.module";
import { WorkItemModule } from "../work-item/work-item.module";
import { DispatchModule } from "../dispatch/dispatch.module";
import { InitiativesModule } from "../initiatives/initiatives.module";
import { KanbanMcpAuditService } from "./kanban-mcp-audit.service";
import { KanbanMcpController } from "./kanban-mcp.controller";
import { KanbanMcpManifestValidationService } from "./kanban-mcp-manifest-validation.service";
import { KanbanMcpService } from "./kanban-mcp.service";
import { KANBAN_INTERNAL_TOOL_HANDLER } from "./tools/shared/tokens";
import * as ReadTools from "./tools/read";
import * as MutationTools from "./tools/mutation";
import { PublishSpecsTool } from "./tools/publish-specs/publish-specs.tool";
import { BoardStateService } from "../services/board-state.service";

const readToolProviders = Object.values(ReadTools).filter(
  (v) => typeof v === "function",
);
const mutationToolProviders = Object.values(MutationTools).filter(
  (v) => typeof v === "function",
);

@Module({
  imports: [
    ProjectModule,
    ProjectGoalsModule,
    InitiativesModule,
    WorkItemModule,
    DispatchModule,
    KanbanSettingsModule,
    OrchestrationModule,
    CoreIntegrationModule,
    ReviewModule,
    RetrospectivesModule,
  ],
  controllers: [KanbanMcpController],
  providers: [
    KanbanMcpAuditService,
    KanbanMcpService,
    KanbanMcpManifestValidationService,
    BoardStateService,
    ...readToolProviders,
    ...mutationToolProviders,
    PublishSpecsTool,
    {
      provide: KANBAN_INTERNAL_TOOL_HANDLER,
      useFactory: (...tools: IInternalToolHandler[]) => tools,
      inject: [
        ...readToolProviders,
        ...mutationToolProviders,
        PublishSpecsTool,
      ],
    },
  ],
  exports: [
    KanbanMcpService,
    KANBAN_INTERNAL_TOOL_HANDLER,
    KanbanMcpManifestValidationService,
  ],
})
export class KanbanMcpModule {}
