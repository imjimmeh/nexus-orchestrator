import { Global, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { KanbanEventDeliveryProjectionEntity } from "./entities/kanban-event-delivery-projection.entity";
import { KanbanCoreLifecycleCursorEntity } from "./entities/kanban-core-lifecycle-cursor.entity";
import { KanbanCoreLifecycleDeadLetterEntity } from "./entities/kanban-core-lifecycle-dead-letter.entity";
import { KanbanCoreRunProjectionEntity } from "./entities/kanban-core-run-projection.entity";
import { KanbanImportedRepositoryFindingEntity } from "./entities/kanban-imported-repository-finding.entity";
import { KanbanOrchestrationEntity } from "./entities/kanban-orchestration.entity";
import { KanbanOrchestrationFactEntity } from "./entities/kanban-orchestration-fact.entity";
import { KanbanOrchestrationIntentEntity } from "./entities/kanban-orchestration-intent.entity";
import { KanbanOrchestrationLaunchAttemptEntity } from "./entities/kanban-orchestration-launch-attempt.entity";
import { KanbanOrchestrationLeaseEntity } from "./entities/kanban-orchestration-lease.entity";
import { KanbanOrchestrationSchedulerOutcomeEntity } from "./entities/kanban-orchestration-scheduler-outcome.entity";
import { KanbanProjectGoalWorklogEntity } from "./entities/kanban-project-goal-worklog.entity";
import { KanbanProjectGoalEntity } from "./entities/kanban-project-goal.entity";
import { KanbanProjectEntity } from "./entities/kanban-project.entity";
import { KanbanRetrospectiveRunEntity } from "./entities/kanban-retrospective-run.entity";
import { KanbanExternalConnectionEntity } from "./entities/kanban-external-connection.entity";
import { KanbanSettingEntity } from "./entities/kanban-setting.entity";
import { KanbanSyncOperationLogEntity } from "./entities/kanban-sync-operation-log.entity";
import { KanbanWorkItemDependencyEntity } from "./entities/kanban-work-item-dependency.entity";
import { KanbanWorkItemSubtaskEntity } from "./entities/kanban-work-item-subtask.entity";
import { KanbanWorkItemEntity } from "./entities/kanban-work-item.entity";
import { KanbanInitiativeEntity } from "./entities/kanban-initiative.entity";
import { KanbanInitiativeGoalEntity } from "./entities/kanban-initiative-goal.entity";
import { KanbanCoreLifecycleCursorRepository } from "./repositories/kanban-core-lifecycle-cursor.repository";
import { KanbanCoreLifecycleDeadLetterRepository } from "./repositories/kanban-core-lifecycle-dead-letter.repository";
import { KanbanImportedRepositoryFindingRepository } from "./repositories/kanban-imported-repository-finding.repository";
import { KanbanCoreRunProjectionRepository } from "./repositories/kanban-core-run-projection.repository";
import { KanbanEventDeliveryProjectionRepository } from "./repositories/kanban-event-delivery-projection.repository";
import { CreateKanbanSourceOfTruth20260429015100 } from "./migrations/20260429015100-create-kanban-source-of-truth";
import { MigrateLegacyKanbanData20260502130000 } from "./migrations/20260502130000-migrate-legacy-kanban-data";
import { CreateKanbanRetrospectiveRuns20260516150000 } from "./migrations/20260516150000-create-kanban-retrospective-runs";
import { CreateKanbanOrchestrationControlPlane20260518194130 } from "./migrations/20260518194130-create-kanban-orchestration-control-plane";
import { CreateKanbanEventDeliveryProjections20260518202800 } from "./migrations/20260518202800-create-kanban-event-delivery-projections";
import { CreateKanbanImportedRepositoryFindings20260519120000 } from "./migrations/20260519120000-create-kanban-imported-repository-findings";
import { CreateKanbanSettings20260530120415 } from "./migrations/20260530120415-create-kanban-settings";
import { AddRepositoryWorkflowSettings20260603090000 } from "./migrations/20260603090000-add-repository-workflow-settings";
import { CreateKanbanExternalSyncTables20260602120000 } from "./migrations/20260602120000-create-kanban-external-sync-tables";
import { CreateKanbanOrchestrationLeases20260612190000 } from "./migrations/20260612190000-create-kanban-orchestration-leases";
import { CreateKanbanInitiatives20260612200000 } from "./migrations/20260612200000-create-kanban-initiatives";
import { AddWorkItemListIndexes20260614160019 } from "./migrations/20260614160019-add-work-item-list-indexes";
import { DefaultRepositoryWorkflowSettings20260615222000 } from "./migrations/20260615222000-default-repository-workflow-settings";
import { BackfillWorkItemTokenSpend20260619090000 } from "./migrations/20260619090000-backfill-work-item-token-spend";
import { KanbanOrchestrationRepository } from "./repositories/kanban-orchestration.repository";
import { KanbanOrchestrationFactRepository } from "./repositories/kanban-orchestration-fact.repository";
import { KanbanOrchestrationIntentRepository } from "./repositories/kanban-orchestration-intent.repository";
import { KanbanOrchestrationLaunchAttemptRepository } from "./repositories/kanban-orchestration-launch-attempt.repository";
import { KanbanOrchestrationSchedulerOutcomeRepository } from "./repositories/kanban-orchestration-scheduler-outcome.repository";
import { KanbanProjectGoalRepository } from "./repositories/kanban-project-goal.repository";
import { KanbanProjectRepository } from "./repositories/kanban-project.repository";
import { KanbanRetrospectiveRunRepository } from "./repositories/kanban-retrospective-run.repository";
import { KanbanSettingRepository } from "./repositories/kanban-setting.repository";
import { KanbanExternalConnectionRepository } from "./repositories/kanban-external-connection.repository";
import { KanbanSyncOperationLogRepository } from "./repositories/kanban-sync-operation-log.repository";
import { KanbanWorkItemRepository } from "./repositories/kanban-work-item.repository";
import { KanbanBoardStateSnapshotEntity } from "./entities/kanban-board-state-snapshot.entity";
import { BoardStateRepository } from "./repositories/kanban-board-state-snapshot.repository";
import { KanbanOrchestrationLeaseRepository } from "./repositories/kanban-orchestration-lease.repository";
import { KanbanInitiativeRepository } from "./repositories/kanban-initiative.repository";
import { KanbanProjectCharterItemEntity } from "./entities/kanban-project-charter-item.entity";
import { KanbanModelPricingCacheEntity } from "./entities/kanban-model-pricing-cache.entity";
import { KanbanWorkItemCostBucketStatEntity } from "./entities/kanban-work-item-cost-bucket-stat.entity";
import { KanbanWorkItemRunCostEntity } from "./entities/kanban-work-item-run-cost.entity";
import { KanbanProjectCharterItemRepository } from "./repositories/kanban-project-charter-item.repository";
import { KanbanModelPricingCacheRepository } from "./repositories/kanban-model-pricing-cache.repository";
import { KanbanWorkItemCostBucketStatRepository } from "./repositories/kanban-work-item-cost-bucket-stat.repository";
import { KanbanWorkItemRunCostRepository } from "./repositories/kanban-work-item-run-cost.repository";
import { CreateKanbanProjectCharterItems20260624120000 } from "./migrations/20260624120000-create-kanban-project-charter-items";
import { CreateWorkItemCostBucketStats20260707110000 } from "./migrations/20260707110000-create-work-item-cost-bucket-stats";
import { BackfillWorkItemRunCosts20260707120000 } from "./migrations/20260707120000-backfill-work-item-run-costs";
import { CreateModelPricingCache20260707100000 } from "./migrations/20260707100000-create-model-pricing-cache";
import { CreateWorkItemRunCosts20260707090000 } from "./migrations/20260707090000-create-work-item-run-costs";
import { AddProjectOrchestrationSettings20260628120000 } from "./migrations/20260628120000-add-project-orchestration-settings";
import { AddKanbanProjectRuntimeToolchains20260701090000 } from "./migrations/20260701090000-add-kanban-project-runtime-toolchains";
import { AddWorkItemTypePointsHierarchy20260706120000 } from "./migrations/20260706120000-add-work-item-type-points-hierarchy";
import { DeduplicateWorkItemCostBucketStats20260708150000 } from "./migrations/20260708150000-deduplicate-work-item-cost-bucket-stats";
import { AddPricedTurnCountCostEstimates20260708170000 } from "./migrations/20260708170000-add-priced-turn-count-cost-estimates";

const entities = [
  KanbanProjectEntity,
  KanbanWorkItemEntity,
  KanbanWorkItemDependencyEntity,
  KanbanWorkItemSubtaskEntity,
  KanbanProjectGoalEntity,
  KanbanProjectGoalWorklogEntity,
  KanbanOrchestrationEntity,
  KanbanOrchestrationIntentEntity,
  KanbanOrchestrationFactEntity,
  KanbanOrchestrationSchedulerOutcomeEntity,
  KanbanOrchestrationLaunchAttemptEntity,
  KanbanOrchestrationLeaseEntity,
  KanbanEventDeliveryProjectionEntity,
  KanbanCoreRunProjectionEntity,
  KanbanCoreLifecycleCursorEntity,
  KanbanCoreLifecycleDeadLetterEntity,
  KanbanRetrospectiveRunEntity,
  KanbanImportedRepositoryFindingEntity,
  KanbanSettingEntity,
  KanbanBoardStateSnapshotEntity,
  KanbanExternalConnectionEntity,
  KanbanSyncOperationLogEntity,
  KanbanInitiativeEntity,
  KanbanInitiativeGoalEntity,
  KanbanProjectCharterItemEntity,
  KanbanModelPricingCacheEntity,
  KanbanWorkItemCostBucketStatEntity,
  KanbanWorkItemRunCostEntity,
];

const repositories = [
  KanbanProjectRepository,
  KanbanWorkItemRepository,
  KanbanProjectGoalRepository,
  KanbanOrchestrationRepository,
  KanbanOrchestrationIntentRepository,
  KanbanOrchestrationFactRepository,
  KanbanOrchestrationSchedulerOutcomeRepository,
  KanbanOrchestrationLaunchAttemptRepository,
  KanbanEventDeliveryProjectionRepository,
  KanbanCoreRunProjectionRepository,
  KanbanCoreLifecycleCursorRepository,
  KanbanCoreLifecycleDeadLetterRepository,
  KanbanRetrospectiveRunRepository,
  KanbanImportedRepositoryFindingRepository,
  KanbanSettingRepository,
  BoardStateRepository,
  KanbanExternalConnectionRepository,
  KanbanSyncOperationLogRepository,
  KanbanOrchestrationLeaseRepository,
  KanbanInitiativeRepository,
  KanbanProjectCharterItemRepository,
  KanbanModelPricingCacheRepository,
  KanbanWorkItemCostBucketStatRepository,
  KanbanWorkItemRunCostRepository,
];

const migrations = [
  AddPricedTurnCountCostEstimates20260708170000,
  DeduplicateWorkItemCostBucketStats20260708150000,
  BackfillWorkItemRunCosts20260707120000,
  CreateWorkItemCostBucketStats20260707110000,
  CreateModelPricingCache20260707100000,
  CreateWorkItemRunCosts20260707090000,
  AddWorkItemTypePointsHierarchy20260706120000,
  AddRepositoryWorkflowSettings20260603090000,
  CreateKanbanSourceOfTruth20260429015100,
  MigrateLegacyKanbanData20260502130000,
  CreateKanbanRetrospectiveRuns20260516150000,
  CreateKanbanOrchestrationControlPlane20260518194130,
  CreateKanbanEventDeliveryProjections20260518202800,
  CreateKanbanImportedRepositoryFindings20260519120000,
  CreateKanbanSettings20260530120415,
  CreateKanbanExternalSyncTables20260602120000,
  CreateKanbanOrchestrationLeases20260612190000,
  CreateKanbanInitiatives20260612200000,
  AddWorkItemListIndexes20260614160019,
  DefaultRepositoryWorkflowSettings20260615222000,
  BackfillWorkItemTokenSpend20260619090000,
  CreateKanbanProjectCharterItems20260624120000,
  AddProjectOrchestrationSettings20260628120000,
  AddKanbanProjectRuntimeToolchains20260701090000,
];

@Global()
@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: "postgres",
      host: readDbValue("KANBAN_DB_HOST", "DB_HOST", "localhost"),
      port: Number(readDbValue("KANBAN_DB_PORT", "DB_PORT", "5432")),
      username: readDbValue("KANBAN_DB_USERNAME", "DB_USERNAME", "nexus"),
      password: readDbValue(
        "KANBAN_DB_PASSWORD",
        "DB_PASSWORD",
        "nexus_password",
      ),
      database: readDbValue(
        "KANBAN_DB_DATABASE",
        "DB_DATABASE",
        "nexus_orchestrator",
      ),
      entities,
      migrations,
      migrationsRun: readBooleanValue("KANBAN_TYPEORM_MIGRATIONS_RUN", true),
      synchronize: process.env.NODE_ENV !== "production",
      logging: process.env.NODE_ENV !== "production",
    }),
    TypeOrmModule.forFeature(entities),
  ],
  providers: [...repositories],
  exports: [TypeOrmModule, ...repositories],
})
export class DatabaseModule {}

function readDbValue(
  primaryKey: string,
  secondaryKey: string,
  fallback: string,
): string {
  const primary = process.env[primaryKey];
  if (typeof primary === "string" && primary.trim().length > 0) {
    return primary;
  }

  const secondary = process.env[secondaryKey];
  if (typeof secondary === "string" && secondary.trim().length > 0) {
    return secondary;
  }

  return fallback;
}

function readBooleanValue(key: string, fallback: boolean): boolean {
  const value = process.env[key];
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }

  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}
