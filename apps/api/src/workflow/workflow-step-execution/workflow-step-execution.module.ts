import { BullModule } from '@nestjs/bullmq';
import { forwardRef, Module } from '@nestjs/common';
import { AiConfigModule } from '../../ai-config/ai-config.module';
import { DatabaseModule } from '../../database/database.module';
import { MemoryModule } from '../../memory/memory.module';
import { MemorySignalsModule } from '../../memory/signals/memory-signals.module';
import { ObservabilityModule } from '../../observability/observability.module';
import { GitWorktreeModule } from '../../common/git/git-worktree.module';
import { CapabilityGovernanceModule } from '../../capability-governance/capability-governance.module';
import { DockerModule } from '../../docker/docker.module';
import { CapabilityInfraModule } from '../../capability-infra/capability-infra.module';
import { CapabilityPreflightService } from '../../tool/capability-preflight.service';
import { CostGovernanceModule } from '../../cost-governance/cost-governance.module';
import { ExecutionLifecycleModule } from '../../execution-lifecycle/execution-lifecycle.module';
import { ToolRegistryModule } from '../../tool-registry/tool-registry.module';
import { ToolRuntimeModule } from '../../tool-runtime/tool-runtime.module';
import { RuntimeFeedbackModule } from '../../runtime-feedback/runtime-feedback.module';
import { SystemSettingsModule } from '../../settings/system-settings.module';
import { WorkflowCoreModule } from '../workflow-core.module';
import { WorkflowKernelModule } from '../kernel/workflow-kernel.module';
import { WorkflowHostMountModule } from '../workflow-host-mount/workflow-host-mount.module';
import { WorkflowSpecialStepsModule } from '../workflow-special-steps/workflow-special-steps.module';
import { RedisModule } from '../../redis/redis.module';
import { HarnessModule } from '../../harness/harness.module';
import { DomainEventsModule } from '../../domain-events/domain-events.module';
import { SessionModule } from '../../session/session.module';
import { StepSessionCheckpointModule } from '../workflow-session-checkpoint/step-session-checkpoint.module';
import { StepAgentContainerSupportService } from './step-agent-container-support.service';
import { StepAgentStepExecutorService } from './step-agent-step-executor.service';
import { StepContainerRuntimeService } from './step-container-runtime.service';
import { StepEventPublisherService } from './step-event-publisher.service';
import { StepExecutionCompletionListener } from './step-execution-completion.listener';
import { StepExecutionConsumer } from './step-execution.consumer';
import { StepExecutionOrchestratorService } from './step-execution-orchestrator.service';
import { StepExecutionService } from './step-execution.service';
import { StepRequiredToolRetryService } from './step-required-tool-retry.service';
import { StepSupportService } from './step-support.service';
import { StrategicIntentPromptContextProvider } from './strategic-intent-prompt-context.provider';
import { WorkflowAutoRetryActivationGuardService } from './workflow-auto-retry-activation-guard.service';
import { StepCompletionFinalizerService } from './step-completion-finalizer.service';
import { WorkflowRunOperationsModule } from '../workflow-run-operations/workflow-run-operations.module';
import { WorkflowInterruptionRecoveryModule } from '../workflow-interruption-recovery/workflow-interruption-recovery.module';
import { WorkflowSubagentsModule } from '../workflow-subagents/workflow-subagents.module';
import { SystemPromptAssemblyModule } from '../../system-prompt/system-prompt-assembly.module';
import { WorkflowRuntimeToolchainsModule } from '../workflow-runtime-toolchains/workflow-runtime-toolchains.module';
import { WorkflowSkillBindingsModule } from '../workflow-skill-bindings/workflow-skill-bindings.module';

@Module({
  imports: [
    AiConfigModule,
    DatabaseModule,
    ObservabilityModule,
    forwardRef(() => MemoryModule),
    MemorySignalsModule,
    GitWorktreeModule,
    DockerModule,
    RedisModule,
    forwardRef(() => WorkflowCoreModule),
    WorkflowHostMountModule,
    WorkflowKernelModule,
    CapabilityGovernanceModule,
    CapabilityInfraModule,
    CostGovernanceModule,
    forwardRef(() => ExecutionLifecycleModule),
    ToolRegistryModule,
    ToolRuntimeModule,
    RuntimeFeedbackModule,
    SystemSettingsModule,
    BullModule.registerQueue({ name: 'workflow-steps' }),
    forwardRef(() => WorkflowSpecialStepsModule),
    WorkflowRunOperationsModule,
    HarnessModule,
    DomainEventsModule,
    forwardRef(() => SessionModule),
    StepSessionCheckpointModule,
    WorkflowInterruptionRecoveryModule,
    WorkflowSubagentsModule,
    SystemPromptAssemblyModule,
    WorkflowRuntimeToolchainsModule,
    WorkflowSkillBindingsModule,
  ],
  providers: [
    StepAgentContainerSupportService,
    StepAgentStepExecutorService,
    StepContainerRuntimeService,
    StepEventPublisherService,
    StepExecutionCompletionListener,
    StepExecutionConsumer,
    StepExecutionOrchestratorService,
    StepExecutionService,
    StepRequiredToolRetryService,
    StepSupportService,
    StrategicIntentPromptContextProvider,
    WorkflowAutoRetryActivationGuardService,
    CapabilityPreflightService,
    StepCompletionFinalizerService,
  ],
  exports: [
    StepEventPublisherService,
    StepExecutionOrchestratorService,
    StepSupportService,
    CapabilityPreflightService,
    StepCompletionFinalizerService,
  ],
})
export class WorkflowStepExecutionModule {
  protected readonly _moduleName = 'WorkflowStepExecutionModule';
}
