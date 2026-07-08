import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StepSessionCheckpointEntity } from './step-session-checkpoint.entity.js';
import { StepSessionCheckpointRepository } from './step-session-checkpoint.repository.js';

/**
 * Wires the step-session-checkpoint persistence primitive into NestJS DI.
 *
 * Consumers import `StepSessionCheckpointModule` to gain access to
 * `StepSessionCheckpointRepository` for recording and querying durable
 * session position snapshots per execution step.
 */
@Module({
  imports: [TypeOrmModule.forFeature([StepSessionCheckpointEntity])],
  providers: [StepSessionCheckpointRepository],
  exports: [StepSessionCheckpointRepository],
})
export class StepSessionCheckpointModule {
  protected readonly _moduleName = 'StepSessionCheckpointModule';
}
