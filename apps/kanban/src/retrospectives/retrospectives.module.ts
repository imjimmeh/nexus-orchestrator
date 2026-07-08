import { forwardRef, Module, OnModuleInit } from "@nestjs/common";
import { CoreIntegrationModule } from "../core/core-integration.module";
import { DatabaseModule } from "../database/database.module";
import { CycleDecisionEventHandler } from "./events/cycle-decision-event.handler";
import { KanbanRetrospectiveEvidenceService } from "./kanban-retrospective-evidence.service";
import { KanbanRetrospectiveFailureThresholdService } from "./kanban-retrospective-failure-threshold.service";
import {
  KANBAN_RETROSPECTIVE_FAILURE_THRESHOLD_SERVICE,
} from "./kanban-retrospective-failure-threshold.types";
import { KanbanRetrospectiveService } from "./kanban-retrospective.service";
import { RetrospectivesController } from "./retrospectives.controller";

const RETROSPECTIVES_FEATURE_NAME = "retrospectives";

@Module({
  imports: [forwardRef(() => CoreIntegrationModule), DatabaseModule],
  controllers: [RetrospectivesController],
  providers: [
    KanbanRetrospectiveService,
    KanbanRetrospectiveFailureThresholdService,
    KanbanRetrospectiveEvidenceService,
    CycleDecisionEventHandler,
    {
      provide: KANBAN_RETROSPECTIVE_FAILURE_THRESHOLD_SERVICE,
      useExisting: KanbanRetrospectiveFailureThresholdService,
    },
  ],
  exports: [
    KanbanRetrospectiveService,
    {
      provide: KANBAN_RETROSPECTIVE_FAILURE_THRESHOLD_SERVICE,
      useExisting: KanbanRetrospectiveFailureThresholdService,
    },
    KanbanRetrospectiveEvidenceService,
    CycleDecisionEventHandler,
  ],
})
export class RetrospectivesModule implements OnModuleInit {
  readonly featureName = RETROSPECTIVES_FEATURE_NAME;

  /**
   * Initialize the cycle decision event handler on module startup.
   * This registers the handler with the kanban event emitter.
   */
  onModuleInit(): void {
    // The handler will be registered via injection in the service that uses it.
    // For standalone usage, inject and call register() on CycleDecisionEventHandler.
  }
}
