import { BullModule } from '@nestjs/bullmq';
import { forwardRef, Module } from '@nestjs/common';
import { AiConfigModule } from '../ai-config/ai-config.module';
import { ConfigResolutionModule } from '../config-resolution/config-resolution.module';
import { DatabaseModule } from '../database/database.module';
import { DockerModule } from '../docker/docker.module';
import { ObservabilityModule } from '../observability/observability.module';
import { SecurityModule } from '../security/security.module';
import { SessionModule } from '../session/session.module';
import { SystemSettingsModule } from '../settings/system-settings.module';
import { GitOpsModule } from '../gitops/gitops.module';
import { VariablesModule } from '../variables/variables.module';
import { WorkflowRepository } from './database/repositories/workflow.repository';
import { WorkflowRunRepository } from './database/repositories/workflow-run.repository';
import { WorkflowSpecialStepsModule } from './workflow-special-steps/workflow-special-steps.module';
import { ConcurrencyPolicyService } from './concurrency-policy.service';
import { DAGResolverService } from './dag-resolver.service';
import { WorkflowDomainPortsModule } from './domain-ports/workflow-domain-ports.module';
import { ExecutionContextResolverService } from './execution-context-resolver.service';
import { PromptLoaderService } from './prompt-loader.service';
import { RepositoryWorkflowDiscoveryService } from './repository-workflow-discovery.service';
import { StateMachineService } from './state-machine.service';
import { StateManagerService } from './state-manager.service';
import { WorkflowBootstrapValidatorService } from './workflow-bootstrap-validator.service';
import { WorkflowCancellationCascadeService } from './workflow-cancellation-cascade.service';
import { WorkflowConcurrencyManager } from './workflow-concurrency-manager.service';
import { WorkflowContainerCleanupService } from './workflow-container-cleanup.service';
import { WorkflowDefinitionLoaderService } from './workflow-definition-loader.service';
import { WorkflowEngineLaunchOrchestratorService } from './workflow-engine-launch-orchestrator.service';
import { WorkflowEngineService } from './workflow-engine.service';
import { WorkflowEventLogService } from './workflow-event-log.service';
import { WorkflowEventTriggerService } from './workflow-event-trigger.service';
import { WorkflowFailedJobRetryService } from './workflow-failed-job-retry.service';
import { WorkflowJobMessageQueueService } from './workflow-job-message-queue.service';
import { WorkflowLaunchDedupeService } from './workflow-launch-dedupe.service';
import { WorkflowLifecycleExecutionService } from './workflow-lifecycle-execution.service';
import { WorkflowOutputContractService } from './workflow-output-contract.service';
import { TOOL_EXECUTION_COUNTER } from './tool-execution-counter.tokens';
import { EventLedgerToolExecutionCounter } from './event-ledger-tool-execution-counter';
import { WorkflowParserService } from './workflow-parser.service';
import { WorkflowPersistenceService } from './workflow-persistence.service';
import { WorkflowRepositoryAggregator } from './workflow-repository-aggregator.service';
import { JobCompletionHandler } from './job-completion.handler';
import { JobFailureHandler } from './job-failure.handler';
import { WorkflowRunJobExecutionService } from './workflow-run-job-execution.service';
import { WorkflowRunQuestionParkService } from './workflow-run-question-park.service';
import { WorkflowSkillRuntimeDiagnosticsService } from './workflow-skill-runtime-diagnostics.service';
import { WorkflowStageSkillPolicyService } from './workflow-stage-skill-policy.service';
import { WorkflowStepCompletionGuardService } from './workflow-step-completion-guard.service';
import { WorkflowTerminalRunCloserService } from './workflow-terminal-run-closer.service';
import { WorkflowTriggerRegistryService } from './workflow-trigger-registry.service';
import { WorkflowValidationService } from './workflow-validation.service';
import { WorkflowResolutionService } from './services/workflow-resolution.service';
import {
  WORKFLOW_ENGINE_SERVICE,
  WORKFLOW_PARSER_SERVICE,
  STATE_MACHINE_SERVICE,
  WORKFLOW_PERSISTENCE_SERVICE,
  WORKFLOW_CANCELLATION_CASCADE_SERVICE,
  WORKFLOW_RUN_REPOSITORY_PORT,
  WORKFLOW_DEFINITION_REPOSITORY_PORT,
} from './kernel/interfaces/workflow-kernel.ports';

@Module({
  imports: [
    AiConfigModule,
    BullModule.registerQueue({ name: 'workflow-steps' }),
    ConfigResolutionModule,
    DatabaseModule,
    WorkflowDomainPortsModule,
    DockerModule,
    GitOpsModule,
    ObservabilityModule,
    SecurityModule,
    forwardRef(() => SessionModule),
    SystemSettingsModule,
    VariablesModule,
    forwardRef(() => WorkflowSpecialStepsModule),
  ],
  providers: [
    ConcurrencyPolicyService,
    DAGResolverService,
    ExecutionContextResolverService,
    {
      provide: TOOL_EXECUTION_COUNTER,
      useClass: EventLedgerToolExecutionCounter,
    },
    PromptLoaderService,
    RepositoryWorkflowDiscoveryService,
    StateMachineService,
    StateManagerService,
    WorkflowBootstrapValidatorService,
    WorkflowCancellationCascadeService,
    WorkflowConcurrencyManager,
    WorkflowContainerCleanupService,
    WorkflowDefinitionLoaderService,
    WorkflowEngineLaunchOrchestratorService,
    WorkflowEngineService,
    WorkflowEventLogService,
    WorkflowEventTriggerService,
    WorkflowFailedJobRetryService,
    WorkflowJobMessageQueueService,
    WorkflowLaunchDedupeService,
    WorkflowLifecycleExecutionService,
    WorkflowOutputContractService,
    WorkflowParserService,
    WorkflowPersistenceService,
    WorkflowRepositoryAggregator,
    WorkflowResolutionService,
    JobCompletionHandler,
    JobFailureHandler,
    WorkflowRunJobExecutionService,
    WorkflowRunQuestionParkService,
    WorkflowSkillRuntimeDiagnosticsService,
    WorkflowStageSkillPolicyService,
    WorkflowStepCompletionGuardService,
    WorkflowTerminalRunCloserService,
    WorkflowTriggerRegistryService,
    WorkflowValidationService,
    {
      provide: WORKFLOW_ENGINE_SERVICE,
      useExisting: WorkflowEngineService,
    },
    {
      provide: WORKFLOW_PARSER_SERVICE,
      useExisting: WorkflowParserService,
    },
    {
      provide: STATE_MACHINE_SERVICE,
      useExisting: StateMachineService,
    },
    {
      provide: WORKFLOW_PERSISTENCE_SERVICE,
      useExisting: WorkflowPersistenceService,
    },
    {
      provide: WORKFLOW_CANCELLATION_CASCADE_SERVICE,
      useExisting: WorkflowCancellationCascadeService,
    },
    {
      provide: WORKFLOW_RUN_REPOSITORY_PORT,
      useExisting: WorkflowRunRepository,
    },
    {
      provide: WORKFLOW_DEFINITION_REPOSITORY_PORT,
      useExisting: WorkflowRepository,
    },
  ],
  exports: [
    ConcurrencyPolicyService,
    DAGResolverService,
    ExecutionContextResolverService,
    WorkflowDomainPortsModule,
    PromptLoaderService,
    RepositoryWorkflowDiscoveryService,
    StateMachineService,
    StateManagerService,
    WorkflowBootstrapValidatorService,
    WorkflowCancellationCascadeService,
    WorkflowConcurrencyManager,
    WorkflowContainerCleanupService,
    WorkflowDefinitionLoaderService,
    WorkflowEngineLaunchOrchestratorService,
    WorkflowEngineService,
    WorkflowEventLogService,
    WorkflowEventTriggerService,
    WorkflowFailedJobRetryService,
    WorkflowJobMessageQueueService,
    WorkflowLaunchDedupeService,
    WorkflowLifecycleExecutionService,
    WorkflowOutputContractService,
    WorkflowParserService,
    WorkflowPersistenceService,
    WorkflowRepositoryAggregator,
    WorkflowResolutionService,
    WorkflowRunJobExecutionService,
    WorkflowSkillRuntimeDiagnosticsService,
    WorkflowStageSkillPolicyService,
    WorkflowStepCompletionGuardService,
    WorkflowTerminalRunCloserService,
    WorkflowTriggerRegistryService,
    WorkflowValidationService,
    WORKFLOW_ENGINE_SERVICE,
    WORKFLOW_PARSER_SERVICE,
    STATE_MACHINE_SERVICE,
    WORKFLOW_PERSISTENCE_SERVICE,
    WORKFLOW_CANCELLATION_CASCADE_SERVICE,
    WORKFLOW_RUN_REPOSITORY_PORT,
    WORKFLOW_DEFINITION_REPOSITORY_PORT,
    // Re-export DatabaseModule so WorkflowKernelModule (which imports
    // forwardRef(() => WorkflowCoreModule)) can resolve its
    // WORKFLOW_RUN_REPOSITORY_PORT / WORKFLOW_DEFINITION_REPOSITORY_PORT
    // useExisting aliases (WorkflowRunRepository / WorkflowRepository)
    // transitively through this module. Keeping the ports sourced through
    // WorkflowCoreModule keeps them mockable by overriding it in tests.
    DatabaseModule,
  ],
})
export class WorkflowCoreModule {
  protected readonly moduleName = WorkflowCoreModule.name;
}
