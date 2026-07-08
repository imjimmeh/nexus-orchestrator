import { forwardRef, Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { HarnessModule } from '../../harness/harness.module';
import { SessionModule } from '../../session/session.module';
import { WorkflowCoreModule } from '../workflow-core.module';
import { WorkflowSubagentsModule } from '../workflow-subagents/workflow-subagents.module';
import { StepSessionCheckpointModule } from '../workflow-session-checkpoint/step-session-checkpoint.module.js';
import { InterruptionRecoveryService } from './interruption-recovery.service';

@Module({
  imports: [
    DatabaseModule,
    forwardRef(() => WorkflowCoreModule),
    WorkflowSubagentsModule,
    HarnessModule,
    StepSessionCheckpointModule,
    forwardRef(() => SessionModule),
  ],
  providers: [InterruptionRecoveryService],
  exports: [InterruptionRecoveryService],
})
export class WorkflowInterruptionRecoveryModule {
  protected readonly _moduleName = 'WorkflowInterruptionRecoveryModule';
}
