import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DatabaseModule } from '../database/database.module';
import { ObservabilityModule } from '../observability/observability.module';
import { WorkflowCoreModule } from './workflow-core.module';
import { WorkflowStepExecutionModule } from './workflow-step-execution/workflow-step-execution.module';
import { WorkflowController } from './workflow.controller';
import { WorkflowAdHocSessionController } from './workflow-ad-hoc-session.controller';
import { WorkflowLaunchController } from './workflow-launch/workflow-launch.controller';
import { WorkflowLaunchModule } from './workflow-launch/workflow-launch.module';
import { WorkflowRunOperationsModule } from './workflow-run-operations/workflow-run-operations.module';
import { WorkflowSubagentsModule } from './workflow-subagents/workflow-subagents.module';
import { WorkflowAwaitModule } from './workflow-await/workflow-await.module';
import { WorkflowSpecialStepsModule } from './workflow-special-steps/workflow-special-steps.module';
import { WorkflowEventLogController } from './workflow-event-log.controller';
import { WorkflowLifecycleController } from './workflow-lifecycle.controller';
import { WorkflowRepairModule } from './workflow-repair/workflow-repair.module';
import { WorkflowRuntimeModule } from './workflow-runtime/workflow-runtime.module';
import { WorkflowDelegationToolsModule } from './workflow-delegation-tools/workflow-delegation-tools.module';
import { WorkflowInternalToolsModule } from './workflow-internal-tools/workflow-internal-tools.module';
import { WorkflowAuditListener } from './listeners/workflow-audit.listener';
import { WorkflowRedisPublisherListener } from './listeners/workflow-redis-publisher.listener';
import { WorkflowCoreLifecycleStreamListener } from './listeners/workflow-core-lifecycle-stream.listener';
import { WorkflowTelemetryListener } from './listeners/workflow-telemetry.listener';
import { WorkflowCoreLifecycleStreamPublisher } from './workflow-core-lifecycle-stream.publisher';
import { WorkflowInternalDomainEventsController } from './workflow-internal-domain-events.controller';
import { WorkflowInternalDomainEventsService } from './workflow-internal-domain-events.service';
import { WorkflowInternalCoreRunsController } from './workflow-internal-core-runs.controller';
import { WorkflowInternalCoreRunsService } from './workflow-internal-core-runs.service';
import { WorkflowHostMountModule } from './workflow-host-mount/workflow-host-mount.module';
import { WorkflowRepositoryController } from './workflow-repository.controller';
import { CommitVerificationHandler } from './commit-verification.handler';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../auth/authorization/authorization.module';
import { WebAutomationModule } from '../web-automation/web-automation.module';
import { CapabilityGovernanceModule } from '../capability-governance/capability-governance.module';
import { CapabilityInfraModule } from '../capability-infra/capability-infra.module';
import { CostGovernanceModule } from '../cost-governance/cost-governance.module';
import { PluginKernelModule } from '../plugin-kernel/plugin-kernel.module';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { CapabilityPreflightService } from '../tool/capability-preflight.service';
import { AutomationModule } from '../automation/automation.module';
import { ConfigResolutionModule } from '../config-resolution/config-resolution.module';
import { GitOpsModule } from '../gitops/gitops.module';
import { RedisModule } from '../redis/redis.module';
import { SessionModule } from '../session/session.module';
import { VariablesModule } from '../variables/variables.module';
import { DelegationCapabilityProvider } from './providers/delegation-capability.provider';
import { ImplementationPlanCapabilityProvider } from './providers/implementation-plan-capability.provider';
import { JobOutputCapabilityProvider } from './providers/job-output-capability.provider';
import { OrchestrationSessionCapabilityProvider } from './providers/orchestration-session-capability.provider';
import { WorkflowContextCapabilityProvider } from './providers/workflow-context-capability.provider';
import { WorkflowManagementCapabilityProvider } from './providers/workflow-management-capability.provider';
import { WorkflowRuntimeBrowserCapabilityProvider } from './providers/workflow-runtime-browser-capability.provider';
import { WorkflowUserInteractionCapabilityProvider } from './providers/workflow-user-interaction-capability.provider';

@Module({
  imports: [
    WorkflowCoreModule,
    DatabaseModule,
    AuthModule,
    AuthorizationModule,
    ObservabilityModule,
    RedisModule,
    CapabilityGovernanceModule,
    CapabilityInfraModule,
    PluginKernelModule,
    ToolRegistryModule,
    AutomationModule,
    WebAutomationModule,
    WorkflowRepairModule,
    WorkflowRuntimeModule,
    WorkflowDelegationToolsModule,
    WorkflowInternalToolsModule,
    WorkflowLaunchModule,
    WorkflowRunOperationsModule,
    WorkflowSubagentsModule,
    WorkflowAwaitModule,
    WorkflowStepExecutionModule,
    WorkflowSpecialStepsModule,
    WorkflowHostMountModule,
    CostGovernanceModule,
    ConfigResolutionModule,
    GitOpsModule,
    VariablesModule,
    SessionModule,
    BullModule.registerQueue({
      name: 'workflow-steps',
    }),
  ],
  providers: [
    DelegationCapabilityProvider,
    ImplementationPlanCapabilityProvider,
    JobOutputCapabilityProvider,
    OrchestrationSessionCapabilityProvider,
    WorkflowContextCapabilityProvider,
    WorkflowRuntimeBrowserCapabilityProvider,
    WorkflowUserInteractionCapabilityProvider,
    WorkflowManagementCapabilityProvider,
    CapabilityPreflightService,
    WorkflowAuditListener,
    WorkflowRedisPublisherListener,
    WorkflowCoreLifecycleStreamListener,
    WorkflowTelemetryListener,
    WorkflowCoreLifecycleStreamPublisher,
    WorkflowInternalCoreRunsService,
    WorkflowInternalDomainEventsService,
    CommitVerificationHandler,
  ],
  controllers: [
    WorkflowAdHocSessionController,
    WorkflowLaunchController,
    WorkflowController,
    WorkflowEventLogController,
    WorkflowLifecycleController,
    WorkflowRepositoryController,
    WorkflowInternalCoreRunsController,
    WorkflowInternalDomainEventsController,
  ],
  exports: [
    WorkflowHostMountModule,
    WorkflowRuntimeModule,
    WorkflowSpecialStepsModule,
    WorkflowRunOperationsModule,
    WorkflowSubagentsModule,
    WorkflowAwaitModule,
    WorkflowStepExecutionModule,
    CapabilityPreflightService,
    WorkflowCoreModule,
  ],
})
export class WorkflowModule {
  /** Core Workflow Engine Module */
  protected readonly _moduleName = 'WorkflowModule';
}
