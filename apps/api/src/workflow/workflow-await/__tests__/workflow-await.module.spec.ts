import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { DatabaseModule } from '../../../database/database.module';
import { SessionModule } from '../../../session/session.module';
import { WorkflowCoreModule } from '../../workflow-core.module';
import { WorkflowStepExecutionModule } from '../../workflow-step-execution/workflow-step-execution.module';
import { CHAT_SESSION_DOMAIN_PORT } from '../../domain-ports';
import { AgentAwaitChildTerminalListener } from '../agent-await-child-terminal.listener';
import { AgentAwaitReconcilerService } from '../agent-await-reconciler.service';
import { AgentAwaitRegistryService } from '../agent-await-registry.service';
import { AgentAwaitRepository } from '../agent-await.repository';
import { DependencyParentResumeService } from '../dependency-parent-resume.service';
import { WORKFLOW_RUN_REPOSITORY_PORT } from '../../kernel/interfaces/workflow-kernel.ports';
import { WorkflowJobMessageQueueService } from '../../workflow-job-message-queue.service';
import { WorkflowRunJobExecutionService } from '../../workflow-run-job-execution.service';
import { StepEventPublisherService } from '../../workflow-step-execution/step-event-publisher.service';
import { WorkflowAwaitModule } from '../workflow-await.module';

/**
 * Stand-in for the `@Global()` modules (`DatabaseModule`, `SessionModule`,
 * `WorkflowModule`) that supply the await module's cross-module dependencies in
 * the real DI graph. Each dependency is mocked so the module compiles without
 * any real infrastructure (DataSource, Redis, BullMQ).
 */
@Global()
@Module({
  providers: [
    { provide: AgentAwaitRepository, useValue: {} },
    { provide: WORKFLOW_RUN_REPOSITORY_PORT, useValue: {} },
    { provide: CHAT_SESSION_DOMAIN_PORT, useValue: {} },
    { provide: WorkflowJobMessageQueueService, useValue: {} },
    { provide: WorkflowRunJobExecutionService, useValue: {} },
    {
      provide: StepEventPublisherService,
      useValue: { publishProcessEvent: vi.fn() },
    },
  ],
  exports: [
    AgentAwaitRepository,
    WORKFLOW_RUN_REPOSITORY_PORT,
    CHAT_SESSION_DOMAIN_PORT,
    WorkflowJobMessageQueueService,
    WorkflowRunJobExecutionService,
    StepEventPublisherService,
  ],
})
class WorkflowAwaitTestDependenciesModule {}

describe('WorkflowAwaitModule', () => {
  it('compiles and resolves the durable await services', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [WorkflowAwaitTestDependenciesModule, WorkflowAwaitModule],
    })
      .overrideModule(DatabaseModule)
      .useModule(WorkflowAwaitTestDependenciesModule)
      .overrideModule(SessionModule)
      .useModule(WorkflowAwaitTestDependenciesModule)
      .overrideModule(WorkflowCoreModule)
      .useModule(WorkflowAwaitTestDependenciesModule)
      .overrideModule(WorkflowStepExecutionModule)
      .useModule(WorkflowAwaitTestDependenciesModule)
      .compile();

    expect(moduleRef.get(AgentAwaitRegistryService)).toBeInstanceOf(
      AgentAwaitRegistryService,
    );
    expect(moduleRef.get(DependencyParentResumeService)).toBeInstanceOf(
      DependencyParentResumeService,
    );
    expect(moduleRef.get(AgentAwaitChildTerminalListener)).toBeInstanceOf(
      AgentAwaitChildTerminalListener,
    );
    expect(moduleRef.get(AgentAwaitReconcilerService)).toBeInstanceOf(
      AgentAwaitReconcilerService,
    );
  });
});
