import { forwardRef, Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { CoreIntegrationModule } from "../core/core-integration.module";
import { ProjectGoalsModule } from "../goals/project-goals.module";
import { OrchestrationLeaseService } from "../orchestration/control-plane/orchestration-lease.service";
import { CharterAggregateService } from "./charter-aggregate.service";
import { CharterDocRenderService } from "./charter-doc-render.service";
import { CharterRegenEnqueuer } from "./charter-regen.enqueuer";
import { CharterRegenProcessor } from "./charter-regen.processor";
import { CharterRegenReconciliationService } from "./charter-regen-reconciliation.service";
import { CHARTER_REGEN_QUEUE } from "./charter-regen.queue";
import { ManagedProjectCloneService } from "./managed-project-clone.service";
import { ProjectAgentsFileService } from "./project-agents-file.service";
import { ProjectController } from "./project.controller";
import { ProjectMemorySummaryService } from "./project-memory-summary.service";
import { ProjectRepositoryMetadataService } from "./project-repository-metadata.service";
import { ProjectService } from "./project.service";

@Module({
  imports: [
    forwardRef(() => CoreIntegrationModule),
    forwardRef(() => ProjectGoalsModule),
    BullModule.registerQueue({ name: CHARTER_REGEN_QUEUE }),
  ],
  controllers: [ProjectController],
  providers: [
    ProjectService,
    ManagedProjectCloneService,
    ProjectAgentsFileService,
    ProjectMemorySummaryService,
    ProjectRepositoryMetadataService,
    OrchestrationLeaseService,
    CharterDocRenderService,
    CharterRegenProcessor,
    CharterRegenEnqueuer,
    CharterRegenReconciliationService,
    CharterAggregateService,
  ],
  exports: [
    ProjectService,
    ManagedProjectCloneService,
    ProjectMemorySummaryService,
    CharterRegenEnqueuer,
    CharterDocRenderService,
  ],
})
export class ProjectModule {}
