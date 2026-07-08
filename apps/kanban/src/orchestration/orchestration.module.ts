import { forwardRef, Module } from "@nestjs/common";
import { CoreIntegrationModule } from "../core/core-integration.module";
import { ProjectModule } from "../project/project.module";
import { RetrospectivesModule } from "../retrospectives/retrospectives.module";
import { KanbanSettingsModule } from "../settings/kanban-settings.module";
import { WorkItemModule } from "../work-item/work-item.module";
import { DispatchModule } from "../dispatch/dispatch.module";
import {
  OrchestrationController,
} from "./orchestration.controller";
import { OrchestrationActionRequestsController } from "./orchestration-action-requests.controller";
import { OrchestrationService } from "./orchestration.service";
import { OrchestrationActionRequestsService } from "./orchestration-action-requests.service";
import {
  ORCHESTRATION_CLEAR_PENDING_CONSECUTIVE_FAILURE,
  OrchestrationCycleDecisionService,
} from "./orchestration-cycle-decision.service";
import { OrchestrationObservabilityService } from "./orchestration-observability.service";
import { OrchestrationRunRequestService } from "./orchestration-run-request.service";
import { OrchestrationStateLifecycleService } from "./orchestration-state-lifecycle.service";
import { OrchestrationContinuationService } from "./orchestration-continuation.service";
import { OrchestrationContinuationReconcilerService } from "./orchestration-continuation-reconciler.service";
import { ProjectOrchestrationWakeupService } from "./project-orchestration-wakeup.service";
import { ProbeResultsService } from "./probe-results.service";
import { ReconciledWorkItemPublisher } from "./reconciled-work-item-publisher";
import { ImportedRepositoryFindingPublisher } from "./imported-repository-finding-publisher";
import { ImportedRepositoryFindingResolutionService } from "./imported-repository-finding-resolution.service";
import { HumanDecisionResolutionPolicyService } from "./human-decision-resolution-policy.service";
import { ControlPlaneBoardController } from "./control-plane/control-plane-board.controller";
import { ControlPlaneBoardService } from "./control-plane/control-plane-board.service";
import { OrchestrationPolicyController } from "./orchestration-policy.controller";
import { OrchestrationPolicyService } from "./orchestration-policy.service";
import { KanbanEventReplayService } from "./control-plane/kanban-event-replay.service";
import { OrchestrationControlPlaneSchedulerService } from "./control-plane/orchestration-control-plane-scheduler.service";
import { OrchestrationDecisionExecutorService } from "./control-plane/orchestration-decision-executor.service";
import { OrchestrationFactSnapshotService } from "./control-plane/orchestration-fact-snapshot.service";
import { OrchestrationRepairLaneService } from "./control-plane/orchestration-repair-lane.service";
import { OrchestrationSimulationRunnerService } from "./control-plane/simulation/orchestration-simulation-runner.service";
import { OrchestrationLeaseService } from "./control-plane/orchestration-lease.service";
import { OrchestrationLeaseSweeperService } from "./control-plane/orchestration-lease-sweeper.service";
import { ProjectStrategicStateService } from "./strategic/project-strategic-state.service";
import { RejectionHotspotsService } from "./rejection-hotspots.service";
import { OrchestrationPolicyBackfillService } from "./orchestration-policy-backfill.service";
import { OrchestrationWakePolicyService } from "./orchestration-wake-policy.service";

@Module({
  imports: [
    forwardRef(() => CoreIntegrationModule),
    forwardRef(() => DispatchModule),
    ProjectModule,
    RetrospectivesModule,
    KanbanSettingsModule,
    forwardRef(() => WorkItemModule),
  ],
  controllers: [
    OrchestrationController,
    OrchestrationActionRequestsController,
    ControlPlaneBoardController,
    OrchestrationPolicyController,
  ],
  providers: [
    OrchestrationService,
    OrchestrationCycleDecisionService,
    OrchestrationActionRequestsService,
    OrchestrationObservabilityService,
    OrchestrationStateLifecycleService,
    OrchestrationRunRequestService,
    {
      // The cycle decision service's `clearPendingConsecutiveFailure`
      // callback is bound to the orchestrator's public
      // `clearPendingConsecutiveFailure` method, which owns the
      // require/save plumbing for the metadata patch. The factory uses
      // a forwardRef to break the orchestrator ⇄ cycle decision cycle.
      //
      // Work item: 2b8d0c51-ad27-4f10-9448-38502c8bbf35
      // EPIC-117 / EPIC-202
      provide: ORCHESTRATION_CLEAR_PENDING_CONSECUTIVE_FAILURE,
      useFactory: (orchestrator: OrchestrationService) => (projectId: string) =>
        orchestrator.clearPendingConsecutiveFailure(projectId),
      inject: [forwardRef(() => OrchestrationService) as never],
    },
    OrchestrationPolicyService,
    OrchestrationContinuationService,
    OrchestrationContinuationReconcilerService,
    ProjectOrchestrationWakeupService,
    ProbeResultsService,
    ReconciledWorkItemPublisher,
    ImportedRepositoryFindingPublisher,
    ImportedRepositoryFindingResolutionService,
    HumanDecisionResolutionPolicyService,
    ControlPlaneBoardService,
    KanbanEventReplayService,
    OrchestrationControlPlaneSchedulerService,
    OrchestrationDecisionExecutorService,
    OrchestrationFactSnapshotService,
    OrchestrationRepairLaneService,
    OrchestrationSimulationRunnerService,
    OrchestrationLeaseService,
    OrchestrationLeaseSweeperService,
    ProjectStrategicStateService,
    RejectionHotspotsService,
    OrchestrationPolicyBackfillService,
    OrchestrationWakePolicyService,
  ],
  exports: [
    OrchestrationService,
    OrchestrationPolicyService,
    OrchestrationContinuationService,
    ProjectOrchestrationWakeupService,
    ProbeResultsService,
    ReconciledWorkItemPublisher,
    ImportedRepositoryFindingPublisher,
    ImportedRepositoryFindingResolutionService,
    HumanDecisionResolutionPolicyService,
    ControlPlaneBoardService,
    KanbanEventReplayService,
    OrchestrationControlPlaneSchedulerService,
    OrchestrationDecisionExecutorService,
    OrchestrationFactSnapshotService,
    OrchestrationRepairLaneService,
    OrchestrationSimulationRunnerService,
    OrchestrationLeaseService,
    ProjectStrategicStateService,
    RejectionHotspotsService,
    OrchestrationWakePolicyService,
  ],
})
export class OrchestrationModule {
  protected readonly moduleName = OrchestrationModule.name;
}
