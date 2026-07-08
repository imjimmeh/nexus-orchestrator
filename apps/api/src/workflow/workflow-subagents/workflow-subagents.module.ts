import { forwardRef, Module } from '@nestjs/common';
import { AiConfigModule } from '../../ai-config/ai-config.module';
import { SecurityModule } from '../../security/security.module';
import { AuditLogModule } from '../../audit/audit-log.module';
import { DatabaseModule } from '../../database/database.module';
import { ObservabilityModule } from '../../observability/observability.module';
import { GitWorktreeModule } from '../../common/git/git-worktree.module';
import { HarnessModule } from '../../harness/harness.module';
import { CostGovernanceModule } from '../../cost-governance/cost-governance.module';
import { DockerModule } from '../../docker/docker.module';
import { DomainEventsModule } from '../../domain-events/domain-events.module';
import { ExecutionLifecycleModule } from '../../execution-lifecycle/execution-lifecycle.module';
import { MemoryModule } from '../../memory/memory.module';
import { MemorySignalsModule } from '../../memory/signals/memory-signals.module';
import { RedisModule } from '../../redis/redis.module';
import { SystemSettingsModule } from '../../settings/system-settings.module';
import { ToolRuntimeModule } from '../../tool-runtime/tool-runtime.module';
import { WorkflowCoreModule } from '../workflow-core.module';
import { WorkflowHostMountModule } from '../workflow-host-mount/workflow-host-mount.module';
import { WorkflowKernelModule } from '../kernel/workflow-kernel.module';
import { WorkflowRuntimeToolchainsModule } from '../workflow-runtime-toolchains/workflow-runtime-toolchains.module';
import { ShutdownStateModule } from '../../shutdown/shutdown-state.module';
import { SystemPromptAssemblyModule } from '../../system-prompt/system-prompt-assembly.module';
import { WorkflowSkillBindingsModule } from '../workflow-skill-bindings/workflow-skill-bindings.module';
import { SubagentPromptContextService } from './subagent-prompt-context.service';
import { AgentCommunicationMeshService } from './agent-communication-mesh.service';
import { MeshDelegationAuditPublisherService } from './mesh-delegation-audit-publisher.service';
import { MeshDelegationCandidateQueryService } from './mesh-delegation-candidate-query.service';
import { MeshDelegationCapacityPolicyService } from './mesh-delegation-capacity-policy.service';
import { MeshDelegationDispatchService } from './mesh-delegation-dispatch.service';
import { MeshDelegationDispatchExecutorService } from './mesh-delegation-dispatch-executor.service';
import { MeshDelegationGovernanceService } from './mesh-delegation-governance.service';
import { MeshDelegationService } from './mesh-delegation.service';
import { MeshDelegationStatusUpdaterService } from './mesh-delegation-status-updater.service';
import { SubagentCoordinationService } from './subagent-coordination.service';
import { SubagentExecutionReadModel } from './subagent-execution-read-model';
import { SubagentLifecycleEventService } from './subagent-lifecycle-event.service';
import { SubagentReapedListener } from './subagent-reaped.listener';
import { SubagentParentLockService } from './subagent-parent-lock.service';
import { SubagentParentResumeService } from './subagent-parent-resume.service';
import { SubagentOrchestratorService } from './subagent-orchestrator.service';
import { SubagentOrphanReconcilerService } from './subagent-orphan-reconciler.service';
import { SubagentProvisioningService } from './subagent-provisioning.service';

@Module({
  imports: [
    AiConfigModule,
    DatabaseModule,
    ObservabilityModule,
    GitWorktreeModule,
    HarnessModule,
    CostGovernanceModule,
    DockerModule,
    DomainEventsModule,
    forwardRef(() => ExecutionLifecycleModule),
    forwardRef(() => MemoryModule),
    MemorySignalsModule,
    RedisModule,
    SecurityModule,
    AuditLogModule,
    SystemSettingsModule,
    ToolRuntimeModule,
    forwardRef(() => WorkflowCoreModule),
    WorkflowHostMountModule,
    WorkflowKernelModule,
    WorkflowRuntimeToolchainsModule,
    ShutdownStateModule,
    SystemPromptAssemblyModule,
    WorkflowSkillBindingsModule,
  ],
  providers: [
    SubagentPromptContextService,
    AgentCommunicationMeshService,
    MeshDelegationAuditPublisherService,
    MeshDelegationCandidateQueryService,
    MeshDelegationCapacityPolicyService,
    MeshDelegationDispatchService,
    MeshDelegationDispatchExecutorService,
    MeshDelegationGovernanceService,
    MeshDelegationService,
    MeshDelegationStatusUpdaterService,
    SubagentCoordinationService,
    SubagentExecutionReadModel,
    SubagentLifecycleEventService,
    SubagentReapedListener,
    SubagentParentLockService,
    SubagentParentResumeService,
    SubagentProvisioningService,
    SubagentOrchestratorService,
    SubagentOrphanReconcilerService,
  ],
  exports: [
    AgentCommunicationMeshService,
    MeshDelegationService,
    SubagentExecutionReadModel,
    SubagentOrchestratorService,
  ],
})
export class WorkflowSubagentsModule {
  protected readonly _moduleName = 'WorkflowSubagentsModule';
}
