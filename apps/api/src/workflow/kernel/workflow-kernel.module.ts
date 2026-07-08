import { forwardRef, Module } from '@nestjs/common';
import { WorkflowRepository } from '../database/repositories/workflow.repository';
import { WorkflowRunRepository } from '../database/repositories/workflow-run.repository';
import { WorkflowCoreModule } from '../workflow-core.module';
import { WorkflowEngineService } from '../workflow-engine.service';
import { WorkflowParserService } from '../workflow-parser.service';
import { WorkflowPersistenceService } from '../workflow-persistence.service';
import { WorkflowCancellationCascadeService } from '../workflow-cancellation-cascade.service';
import { StateMachineService } from '../state-machine.service';
import {
  STATE_MACHINE_SERVICE,
  WORKFLOW_DEFINITION_REPOSITORY_PORT,
  WORKFLOW_ENGINE_SERVICE,
  WORKFLOW_PARSER_SERVICE,
  WORKFLOW_PERSISTENCE_SERVICE,
  WORKFLOW_CANCELLATION_CASCADE_SERVICE,
  WORKFLOW_RUN_REPOSITORY_PORT,
} from './interfaces/workflow-kernel.ports';

/**
 * Public-facing kernel module that exports the core workflow DI tokens.
 *
 * Imports WorkflowCoreModule to get access to the concrete services, then
 * provides clean useExisting aliases so that external modules importing
 * WorkflowKernelModule can inject the kernel tokens without depending on
 * concrete providers directly. The `WorkflowRunRepository` and
 * `WorkflowRepository` (workflow-definition) providers are registered in
 * `DatabaseModule` and re-exported by `WorkflowCoreModule`; they reach this
 * module transitively through the `forwardRef(() => WorkflowCoreModule)`
 * import, so the `useExisting` aliases below resolve against the same
 * instances WorkflowCoreModule exposes (and against the mock in tests that
 * override WorkflowCoreModule).
 */
@Module({
  imports: [forwardRef(() => WorkflowCoreModule)],
  providers: [
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
    WORKFLOW_ENGINE_SERVICE,
    WORKFLOW_PARSER_SERVICE,
    STATE_MACHINE_SERVICE,
    WORKFLOW_PERSISTENCE_SERVICE,
    WORKFLOW_CANCELLATION_CASCADE_SERVICE,
    WORKFLOW_RUN_REPOSITORY_PORT,
    WORKFLOW_DEFINITION_REPOSITORY_PORT,
  ],
})
export class WorkflowKernelModule {
  protected readonly moduleName = WorkflowKernelModule.name;
}
