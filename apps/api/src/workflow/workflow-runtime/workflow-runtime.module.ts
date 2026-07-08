import { Module } from '@nestjs/common';
import { WorkflowStepExecutionModule } from '../workflow-step-execution/workflow-step-execution.module';
import { AiConfigModule } from '../../ai-config/ai-config.module';
import { ObservabilityModule } from '../../observability/observability.module';
import { DockerModule } from '../../docker/docker.module';
import { AuthModule } from '../../auth/auth.module';
import { AuthorizationModule } from '../../auth/authorization/authorization.module';
import { AutomationModule } from '../../automation/automation.module';
import { CapabilityGovernanceModule } from '../../capability-governance/capability-governance.module';
import { GitWorktreeModule } from '../../common/git/git-worktree.module';
import { ToolRegistryModule } from '../../tool-registry/tool-registry.module';
import { ToolRuntimeModule } from '../../tool-runtime/tool-runtime.module';
import { RedisModule } from '../../redis/redis.module';
import { ChatSessionCollaborationClient } from '../../telemetry/chat-session-collaboration.client';
import { SessionModule } from '../../session/session.module';
import { WarRoomModule } from '../../war-room/war-room.module';
import { WebAutomationModule } from '../../web-automation/web-automation.module';
import { AgentMentionsCapabilityProvider } from '../providers/agent-mentions-capability.provider';
import { WarRoomCapabilityProvider } from '../providers/war-room-capability.provider';
import { WorkflowCompletionCapabilityProvider } from '../providers/workflow-completion-capability.provider';
import {
  WORKFLOW_PARSER_SERVICE,
  WORKFLOW_RUNTIME_CAPABILITY_EXECUTOR_SERVICE,
  WORKFLOW_RUNTIME_TOOLS_SERVICE,
} from '../kernel/interfaces/workflow-kernel.ports';
import { WorkflowParserService } from '../workflow-parser.service';
import { WorkflowRuntimeArtifactsController } from './workflow-runtime-artifacts.controller';
import { WorkflowRuntimeAgentMentionsController } from './workflow-runtime-agent-mentions.controller';
import { WorkflowRuntimeBrowserActionsService } from './workflow-runtime-browser-actions.service';
import { WorkflowRuntimeCapabilityLifecycleController } from './workflow-runtime-capability-lifecycle.controller';
import { WorkflowRuntimeCapabilityExecutorService } from './workflow-runtime-capability-executor.service';
import { WorkflowRuntimeCapabilityLifecycleService } from './workflow-runtime-capability-lifecycle.service';
import { WorkflowRuntimeInternalToolCallbacksController } from './workflow-runtime-internal-tool-callbacks.controller';
import { WorkflowRuntimeLifecycleController } from './workflow-runtime-lifecycle.controller';
import { WorkflowRuntimeMeshDelegationToolsService } from './workflow-runtime-mesh-delegation-tools.service';
import { WorkflowRuntimeOrchestrationActionsService } from './workflow-runtime-orchestration-actions.service';
import { WorkflowRuntimeAwaitActionsService } from './workflow-runtime-await-actions.service';
import { DelegationCircuitBreakerService } from './delegation-circuit-breaker.service';
import { WorkflowRuntimeRunningWorkflowsService } from './workflow-runtime-running-workflows.service';
import { WorkflowRuntimeOrchestrationSessionService } from './workflow-runtime-orchestration-session.service';
import { WorkflowRuntimeSpecEmitterService } from './workflow-runtime-spec-emitter.service';
import { WorkflowRuntimeSetJobOutputService } from './workflow-runtime-set-job-output.service';
import { JobOutputContractResolverService } from './job-output-contract-resolver.service';
import { WorkflowRuntimeStepCompleteController } from './workflow-runtime-step-complete.controller';
import { WorkflowRuntimeSubagentToolsService } from './workflow-runtime-subagent-tools.service';
import { WorkflowRuntimeSubagentsController } from './workflow-runtime-subagents.controller';
import { WorkflowRuntimeTerminalRunGuardService } from './workflow-runtime-terminal-run-guard.service';
import { WorkflowRuntimeToolsService } from './workflow-runtime-tools.service';
import { WorkflowRuntimeWarRoomController } from './workflow-runtime-war-room.controller';
import { WorkflowCoreModule } from '../workflow-core.module';
import { WorkflowInternalToolsModule } from '../workflow-internal-tools/workflow-internal-tools.module';
import { WorkflowKernelModule } from '../kernel/workflow-kernel.module';
import { WorkflowSubagentsModule } from '../workflow-subagents/workflow-subagents.module';
import { WorkflowAwaitModule } from '../workflow-await/workflow-await.module';
import { HarnessModule } from '../../harness/harness.module';
import { ImprovementModule } from '../../improvement/improvement.module';

@Module({
  imports: [
    AuthModule,
    DockerModule,
    AiConfigModule,
    ObservabilityModule,
    AuthorizationModule,
    AutomationModule,
    CapabilityGovernanceModule,
    GitWorktreeModule,
    RedisModule,
    SessionModule,
    ToolRegistryModule,
    ToolRuntimeModule,
    WarRoomModule,
    WebAutomationModule,
    WorkflowSubagentsModule,
    WorkflowAwaitModule,
    HarnessModule,
    ImprovementModule,
    WorkflowCoreModule,
    WorkflowInternalToolsModule,
    WorkflowKernelModule,
    WorkflowStepExecutionModule,
  ],
  controllers: [
    WorkflowRuntimeArtifactsController,
    WorkflowRuntimeAgentMentionsController,
    WorkflowRuntimeCapabilityLifecycleController,
    WorkflowRuntimeInternalToolCallbacksController,
    WorkflowRuntimeLifecycleController,
    WorkflowRuntimeStepCompleteController,
    WorkflowRuntimeSubagentsController,
    WorkflowRuntimeWarRoomController,
  ],
  providers: [
    AgentMentionsCapabilityProvider,
    ChatSessionCollaborationClient,
    WarRoomCapabilityProvider,
    WorkflowCompletionCapabilityProvider,
    WorkflowParserService,
    WorkflowRuntimeToolsService,
    WorkflowRuntimeCapabilityExecutorService,
    WorkflowRuntimeCapabilityLifecycleService,
    WorkflowRuntimeSetJobOutputService,
    JobOutputContractResolverService,
    WorkflowRuntimeOrchestrationActionsService,
    WorkflowRuntimeAwaitActionsService,
    DelegationCircuitBreakerService,
    WorkflowRuntimeRunningWorkflowsService,
    WorkflowRuntimeOrchestrationSessionService,
    WorkflowRuntimeBrowserActionsService,
    WorkflowRuntimeSubagentToolsService,
    WorkflowRuntimeTerminalRunGuardService,
    WorkflowRuntimeMeshDelegationToolsService,
    WorkflowRuntimeSpecEmitterService,
    {
      provide: WORKFLOW_RUNTIME_CAPABILITY_EXECUTOR_SERVICE,
      useExisting: WorkflowRuntimeCapabilityExecutorService,
    },
    {
      provide: WORKFLOW_PARSER_SERVICE,
      useExisting: WorkflowParserService,
    },
    {
      provide: WORKFLOW_RUNTIME_TOOLS_SERVICE,
      useExisting: WorkflowRuntimeToolsService,
    },
  ],
  exports: [
    WorkflowRuntimeToolsService,
    WorkflowRuntimeOrchestrationActionsService,
    WorkflowRuntimeAwaitActionsService,
    WorkflowRuntimeTerminalRunGuardService,
    WORKFLOW_RUNTIME_CAPABILITY_EXECUTOR_SERVICE,
    WORKFLOW_RUNTIME_TOOLS_SERVICE,
  ],
})
export class WorkflowRuntimeModule {
  protected readonly _moduleName = 'WorkflowRuntimeModule';
}
