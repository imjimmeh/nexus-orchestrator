import { BullModule } from '@nestjs/bullmq';
import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { DatabaseModule } from '../../database/database.module';
import { AuthorizationModule } from '../../auth/authorization/authorization.module';
import { CostGovernanceModule } from '../../cost-governance/cost-governance.module';
import { DockerModule } from '../../docker/docker.module';
import { ExecutionLifecycleModule } from '../../execution-lifecycle/execution-lifecycle.module';
import { GitWorktreeModule } from '../../common/git/git-worktree.module';
import { ObservabilityModule } from '../../observability/observability.module';
import { RedisModule } from '../../redis/redis.module';
import { SystemSettingsModule } from '../../settings/system-settings.module';
import { WebAutomationModule } from '../../web-automation/web-automation.module';
import { SessionModule } from '../../session/session.module';
import { ShutdownStateModule } from '../../shutdown/shutdown-state.module';
import { SystemPromptAssemblyModule } from '../../system-prompt/system-prompt-assembly.module';
import { WorkflowCoreModule } from '../workflow-core.module';
import { WorkflowKernelModule } from '../kernel/workflow-kernel.module';
import { WorkflowRepairModule } from '../workflow-repair/workflow-repair.module';
import { WorkflowInterruptionRecoveryModule } from '../workflow-interruption-recovery/workflow-interruption-recovery.module';
import { WorkflowHostMountModule } from '../workflow-host-mount/workflow-host-mount.module';
import { WorkflowStepExecutionModule } from '../workflow-step-execution/workflow-step-execution.module';
import { WorkflowSubagentsModule } from '../workflow-subagents/workflow-subagents.module';
import { RetrospectiveTraceService } from '../workflow-retrospective/retrospective-trace.service';
import { QuestionIdleContainerListener } from './question-idle-container.listener';
import { QuestionIdleTrackerService } from './question-idle-tracker.service';
import { UserQuestionAwaitService } from './user-question-await.service';
import { WorkflowGraphReadModelService } from './workflow-graph-read-model.service';
import { WorkflowRunAwaitingInputListener } from './workflow-run-awaiting-input.listener';
import { WorkflowRunBrowserSessionCleanupListener } from './workflow-run-browser-session-cleanup.listener';
import { WorkflowRunHeartbeatService } from './workflow-run-heartbeat.service';
import { WorkflowRunReconciliationService } from './workflow-run-reconciliation.service';
import { WorkflowRunAutonomyDiagnosticsService } from './workflow-run-autonomy-diagnostics.service';
import { WorkflowRunSteeringService } from './workflow-run-steering.service';
import { WorkflowRunTodoService } from './workflow-run-todo.service';
import { WorkflowRunWorkspaceService } from './workflow-run-workspace.service';
import { WorkflowRunsController } from './workflow-runs.controller';
import { TodoPromptContributor } from './todo-prompt.contributor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'workflow-steps' }),
    AuthModule,
    DatabaseModule,
    AuthorizationModule,
    CostGovernanceModule,
    DockerModule,
    forwardRef(() => ExecutionLifecycleModule),
    GitWorktreeModule,
    ObservabilityModule,
    RedisModule,
    SystemSettingsModule,
    // TELEMETRY_GATEWAY is resolved lazily via ModuleRef (strict:false) in
    // WorkflowRunSteeringService — no TelemetryModule import needed, which
    // avoids the WorkflowRunOperationsModule <-> TelemetryModule cycle.
    forwardRef(() => SessionModule),
    WebAutomationModule,
    WorkflowInterruptionRecoveryModule,
    forwardRef(() => WorkflowCoreModule),
    WorkflowRepairModule,
    WorkflowKernelModule,
    WorkflowSubagentsModule,
    forwardRef(() => WorkflowStepExecutionModule),
    WorkflowHostMountModule,
    ShutdownStateModule,
    SystemPromptAssemblyModule,
  ],
  controllers: [WorkflowRunsController],
  providers: [
    QuestionIdleContainerListener,
    QuestionIdleTrackerService,
    UserQuestionAwaitService,
    WorkflowGraphReadModelService,
    WorkflowRunAwaitingInputListener,
    WorkflowRunBrowserSessionCleanupListener,
    WorkflowRunAutonomyDiagnosticsService,
    WorkflowRunHeartbeatService,
    WorkflowRunReconciliationService,
    WorkflowRunSteeringService,
    WorkflowRunTodoService,
    WorkflowRunWorkspaceService,
    RetrospectiveTraceService,
    TodoPromptContributor,
  ],
  exports: [
    QuestionIdleTrackerService,
    UserQuestionAwaitService,
    WorkflowGraphReadModelService,
    WorkflowRunAutonomyDiagnosticsService,
    WorkflowRunHeartbeatService,
    WorkflowRunReconciliationService,
    WorkflowRunSteeringService,
    WorkflowRunTodoService,
    WorkflowRunWorkspaceService,
  ],
})
export class WorkflowRunOperationsModule {}
