import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { StepExecutionConsumer } from '../workflow/workflow-step-execution/step-execution.consumer';
import type { StepQueueDrainer } from './shutdown-freeze.coordinator.types';

/**
 * Pauses the local `workflow-steps` BullMQ worker during shutdown so no new
 * jobs are pulled while in-flight executions are frozen. Pausing the local
 * worker is process-scoped and non-persistent — a fresh process starts
 * unpaused — so no resume on startup is required.
 *
 * The {@link StepExecutionConsumer} is resolved lazily via {@link ModuleRef}
 * (non-strict) rather than constructor-injected, to avoid a module-level
 * circular dependency between this module and WorkflowStepExecutionModule
 * (which already imports ExecutionLifecycleModule).
 */
@Injectable()
export class StepQueueDrainerAdapter implements StepQueueDrainer {
  private readonly logger = new Logger(StepQueueDrainerAdapter.name);

  constructor(private readonly moduleRef: ModuleRef) {}

  async pauseAll(): Promise<void> {
    try {
      const consumer = this.moduleRef.get(StepExecutionConsumer, {
        strict: false,
      });
      if (!consumer) {
        this.logger.warn(
          'Step execution consumer unavailable; nothing to pause',
        );
        return;
      }
      await consumer.pauseWorker();
    } catch (error) {
      this.logger.error(
        `Failed to pause workflow-steps worker: ${(error as Error).message}`,
      );
    }
  }
}
