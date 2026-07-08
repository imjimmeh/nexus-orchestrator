import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../auth/authorization/authorization.module';
import { SCHEDULED_JOBS_QUEUE } from '../automation/scheduled-jobs.constants';
import { DatabaseModule } from '../database/database.module';
import { DockerModule } from '../docker/docker.module';
import { ExecutionLifecycleModule } from '../execution-lifecycle/execution-lifecycle.module';
import { McpModule } from '../mcp/mcp.module';
import { WorkflowKernelModule } from '../workflow/kernel/workflow-kernel.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { ContainerRuntimeIntegrityCheckService } from './checks/container-runtime-integrity.check';
import { ContractSchemaMismatchCheckService } from './checks/contract-schema-mismatch.check';
import { QueueLagDeadLetterCheckService } from './checks/queue-lag-dead-letter.check';
import { SplitServiceHealthCheckService } from './checks/split-service-health.check';
import { ToolPluginRegistryIntegrityCheckService } from './checks/tool-plugin-registry-integrity.check';
import { WorkflowStuckStateCheckService } from './checks/workflow-stuck-state.check';
import { GitWorktreeIntegrityCheckService } from './checks/git-worktree-integrity.check';
import { ApiConnectivityCheckService } from './checks/api-connectivity.check';
import { DoctorCheckRegistryService } from './doctor-check-registry.service';
import { DoctorHistoryService } from './doctor-history.service';
import { DoctorRepairDelegationListener } from './doctor-repair-delegation.listener';
import { DoctorRepairExecutorService } from './doctor-repair-executor.service';
import { DoctorReportService } from './doctor-report.service';
import { DoctorWorkflowRepairService } from './doctor-workflow-repair.service';
import { OperationsDoctorController } from './operations-doctor.controller';
import { OperationsLifecycleController } from './operations-lifecycle.controller';
import { WorkflowFailureDoctorTriggerListener } from './workflow-failure-doctor-trigger.listener';
import { SysadminRepairRequestListener } from './sysadmin-repair-request.listener';
import { RuntimeArtifactsInspectorService } from './runtime-artifacts-inspector.service';
import { WorkflowRecoveryCandidatesService } from './workflow-recovery-candidates.service';
import { SystemRecoveryRepairService } from './system-recovery-repair.service';

@Module({
  imports: [
    AuthModule,
    AuthorizationModule,
    DatabaseModule,
    DockerModule,
    ExecutionLifecycleModule,
    WorkflowModule,
    WorkflowKernelModule,
    McpModule,
    BullModule.registerQueue(
      {
        name: 'workflow-steps',
      },
      {
        name: SCHEDULED_JOBS_QUEUE,
      },
    ),
  ],
  controllers: [OperationsDoctorController, OperationsLifecycleController],
  providers: [
    DoctorReportService,
    DoctorCheckRegistryService,
    DoctorRepairDelegationListener,
    WorkflowFailureDoctorTriggerListener,
    SysadminRepairRequestListener,
    DoctorRepairExecutorService,
    DoctorWorkflowRepairService,
    DoctorHistoryService,
    WorkflowRecoveryCandidatesService,
    RuntimeArtifactsInspectorService,
    WorkflowStuckStateCheckService,
    QueueLagDeadLetterCheckService,
    SplitServiceHealthCheckService,
    ContainerRuntimeIntegrityCheckService,
    ContractSchemaMismatchCheckService,
    ToolPluginRegistryIntegrityCheckService,
    GitWorktreeIntegrityCheckService,
    ApiConnectivityCheckService,
    SystemRecoveryRepairService,
  ],
})
export class OperationsModule {
  protected readonly _moduleName = 'OperationsModule';
}
