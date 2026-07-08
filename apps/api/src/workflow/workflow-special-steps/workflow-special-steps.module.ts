import { forwardRef, Module } from '@nestjs/common';
import { GitWorktreeModule } from '../../common/git/git-worktree.module';
import { IntegrationStrategyResolver } from '../../common/git/integration/integration-strategy.resolver';
import { DatabaseModule } from '../../database/database.module';
import { McpModule } from '../../mcp/mcp.module';
import { ObservabilityModule } from '../../observability/observability.module';
import { ToolRegistryModule } from '../../tool-registry/tool-registry.module';
import { ToolRuntimeModule } from '../../tool-runtime/tool-runtime.module';
import { WebAutomationModule } from '../../web-automation/web-automation.module';
import { WorkflowCoreModule } from '../workflow-core.module';
import { WorkflowStepExecutionModule } from '../workflow-step-execution/workflow-step-execution.module';
import { CommitPathsGitActionStrategy } from './git-actions/commit-paths-git-action.strategy';
import { CreateBranchGitActionStrategy } from './git-actions/create-branch-git-action.strategy';
import { MergeBranchResolverService } from './git-actions/merge-branch-resolver.service';
import { MergeGitActionStrategy } from './git-actions/merge-git-action.strategy';
import { MergeIntegrateGitActionStrategy } from './git-actions/merge-integrate-git-action.strategy';
import { MergePrepareGitActionStrategy } from './git-actions/merge-prepare-git-action.strategy';
import { ProvisionWorktreeGitActionStrategy } from './git-actions/provision-worktree-git-action.strategy';
import { RemoveWorktreeGitActionStrategy } from './git-actions/remove-worktree-git-action.strategy';
import { SpecialStepPluginLoaderService } from './plugin/special-step-plugin-loader.service';
import { StepEmitEventSpecialStepHandler } from './step-emit-event-special-step.handler';
import { StepGitOperationSpecialStepHandler } from './step-git-operation-special-step.handler';
import { StepHttpWebhookSpecialStepHandler } from './step-http-webhook-special-step.handler';
import { StepInvokeWorkflowSpecialStepHandler } from './step-invoke-workflow-special-step.handler';
import { StepManageToolCandidateSpecialStepHandler } from './step-manage-tool-candidate-special-step.handler';
import { StepMcpToolCallSpecialStepHandler } from './step-mcp-tool-call-special-step.handler';
import { StepRegisterToolSpecialStepHandler } from './step-register-tool-special-step.handler';
import { StepRunCommandSpecialStepHandler } from './step-run-command-special-step.handler';
import { StepSpecialStepExecutorService } from './step-special-step-executor.service';
import { SpecialStepForEachCoordinator } from './special-step-for-each.coordinator';
import { SpecialStepAuditPublisher } from './special-step-audit.publisher';
import {
  SPECIAL_STEP_HANDLERS,
  StepSpecialStepRegistryService,
} from './step-special-step-registry.service';
import type { ISpecialStepHandler } from './step-special-step.types';
import { StepWebAutomationSpecialStepHandler } from './step-web-automation-special-step.handler';

const specialStepHandlers = [
  StepRegisterToolSpecialStepHandler,
  StepInvokeWorkflowSpecialStepHandler,
  StepRunCommandSpecialStepHandler,
  StepEmitEventSpecialStepHandler,
  StepWebAutomationSpecialStepHandler,
  StepHttpWebhookSpecialStepHandler,
  StepMcpToolCallSpecialStepHandler,
  StepGitOperationSpecialStepHandler,
  StepManageToolCandidateSpecialStepHandler,
];

const gitActionStrategies = [
  IntegrationStrategyResolver,
  MergeBranchResolverService,
  MergeGitActionStrategy,
  MergePrepareGitActionStrategy,
  MergeIntegrateGitActionStrategy,
  ProvisionWorktreeGitActionStrategy,
  RemoveWorktreeGitActionStrategy,
  CreateBranchGitActionStrategy,
  CommitPathsGitActionStrategy,
];

@Module({
  imports: [
    GitWorktreeModule,
    DatabaseModule,
    ToolRegistryModule,
    ToolRuntimeModule,
    WebAutomationModule,
    McpModule,
    ObservabilityModule,
    forwardRef(() => WorkflowCoreModule),
    WorkflowStepExecutionModule,
  ],
  providers: [
    ...specialStepHandlers,
    ...gitActionStrategies,
    {
      provide: SPECIAL_STEP_HANDLERS,
      useFactory: (...handlers: ISpecialStepHandler[]) => handlers,
      inject: specialStepHandlers,
    },
    StepSpecialStepRegistryService,
    StepSpecialStepExecutorService,
    SpecialStepForEachCoordinator,
    SpecialStepAuditPublisher,
    SpecialStepPluginLoaderService,
  ],
  exports: [
    SPECIAL_STEP_HANDLERS,
    StepSpecialStepRegistryService,
    StepSpecialStepExecutorService,
    SpecialStepForEachCoordinator,
    SpecialStepPluginLoaderService,
    ...specialStepHandlers,
  ],
})
export class WorkflowSpecialStepsModule {
  protected readonly _moduleName = 'WorkflowSpecialStepsModule';
}
