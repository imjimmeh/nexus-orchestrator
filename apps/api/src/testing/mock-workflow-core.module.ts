import { Module } from '@nestjs/common';
import { StateMachineService } from '../workflow/state-machine.service';
import { WorkflowRepository } from '../workflow/database/repositories/workflow.repository';
import { WorkflowRunRepository } from '../workflow/database/repositories/workflow-run.repository';
import { WorkflowEngineService } from '../workflow/workflow-engine.service';
import { WorkflowParserService } from '../workflow/workflow-parser.service';
import { WorkflowPersistenceService } from '../workflow/workflow-persistence.service';
import { WorkflowCancellationCascadeService } from '../workflow/workflow-cancellation-cascade.service';
import { WorkflowEngineLaunchOrchestratorService } from '../workflow/workflow-engine-launch-orchestrator.service';

@Module({
  providers: [
    { provide: WorkflowEngineService, useValue: {} },
    { provide: WorkflowParserService, useValue: {} },
    { provide: StateMachineService, useValue: {} },
    { provide: WorkflowPersistenceService, useValue: {} },
    { provide: WorkflowCancellationCascadeService, useValue: {} },
    { provide: WorkflowEngineLaunchOrchestratorService, useValue: {} },
    { provide: WorkflowRepository, useValue: {} },
    { provide: WorkflowRunRepository, useValue: {} },
  ],
  exports: [
    WorkflowEngineService,
    WorkflowParserService,
    StateMachineService,
    WorkflowPersistenceService,
    WorkflowCancellationCascadeService,
    WorkflowEngineLaunchOrchestratorService,
    WorkflowRepository,
    WorkflowRunRepository,
  ],
})
export class MockWorkflowCoreModule {}
