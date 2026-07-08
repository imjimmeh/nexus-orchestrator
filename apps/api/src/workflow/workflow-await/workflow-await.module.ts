import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { SessionModule } from '../../session/session.module';
import { WorkflowCoreModule } from '../workflow-core.module';
import { WorkflowStepExecutionModule } from '../workflow-step-execution/workflow-step-execution.module';
import { AgentAwaitChildTerminalListener } from './agent-await-child-terminal.listener';
import { AgentAwaitReconcilerService } from './agent-await-reconciler.service';
import { AgentAwaitRegistryService } from './agent-await-registry.service';
import { DependencyParentResumeService } from './dependency-parent-resume.service';

/**
 * Wires the durable agent-await primitive into NestJS DI.
 *
 * Dependencies come from explicit imports: `DatabaseModule`, `SessionModule`,
 * `WorkflowStepExecutionModule` (for `StepEventPublisherService`), and
 * `WorkflowCoreModule` (for `WorkflowRunJobExecutionService` and
 * `WorkflowJobMessageQueueService`).
 */
@Module({
  imports: [
    DatabaseModule,
    SessionModule,
    WorkflowCoreModule,
    WorkflowStepExecutionModule,
  ],
  providers: [
    AgentAwaitRegistryService,
    DependencyParentResumeService,
    AgentAwaitChildTerminalListener,
    AgentAwaitReconcilerService,
  ],
  exports: [AgentAwaitRegistryService, DependencyParentResumeService],
})
export class WorkflowAwaitModule {
  protected readonly _moduleName = 'WorkflowAwaitModule';
}
