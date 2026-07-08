import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ExecutionRepository } from './database/repositories/execution.repository';
import { ExecutionEventPublisher } from './execution-event.publisher';
import { ServiceLifecycleStateService } from './service-lifecycle-state.service';
import type {
  ContainerResumer,
  ResumeSummary,
  SessionRehydrator,
} from './startup-resume.coordinator.types';

export const CONTAINER_RESUMER = Symbol('CONTAINER_RESUMER');
export const SESSION_REHYDRATOR = Symbol('SESSION_REHYDRATOR');

@Injectable()
export class StartupResumeCoordinator implements OnApplicationBootstrap {
  private readonly logger = new Logger(StartupResumeCoordinator.name);
  private latestResumeSummary: ResumeSummary = {
    frozenFound: 0,
    resumed: 0,
    failed: 0,
    lastResumeAt: null,
  };

  get lastResumeSummary(): ResumeSummary {
    return this.latestResumeSummary;
  }

  constructor(
    private readonly lifecycle: ServiceLifecycleStateService,
    private readonly executions: ExecutionRepository,
    @Inject(CONTAINER_RESUMER) private readonly resumer: ContainerResumer,
    @Inject(SESSION_REHYDRATOR) private readonly rehydrator: SessionRehydrator,
    private readonly publisher: ExecutionEventPublisher,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.resumeFrozen();
    } catch (error) {
      this.logger.error(`Startup resume failed: ${(error as Error).message}`);
    } finally {
      // Always leave the service accepting work, even if resume hit errors —
      // the watchdogs (now released) will recover anything left behind.
      this.lifecycle.markRunning();
    }
  }

  private async resumeFrozen(): Promise<void> {
    const frozen = await this.executions.findFrozen();
    const resumedAt = new Date();
    let resumed = 0;
    let failed = 0;

    for (const execution of frozen) {
      try {
        const containerId = execution.container_id ?? null;
        const state = containerId
          ? await this.resumer.getContainerRuntimeState(containerId)
          : 'missing';

        if (containerId && (state === 'paused' || state === 'running')) {
          await this.resumer.resumeContainer(containerId);
          await this.executions.clearFrozen(execution.id, new Date());
          await this.publisher.resumed(execution.id, { via: 'unpause' });
          resumed += 1;
          continue;
        }

        const ok = await this.rehydrator.rehydrateAndResume(execution.id);
        if (ok) {
          await this.executions.clearFrozen(execution.id, new Date());
          await this.publisher.resumed(execution.id, { via: 'rehydrate' });
          resumed += 1;
        } else {
          failed += 1;
          this.logger.error(
            `Could not resume execution ${execution.id}: container missing and no rehydratable session`,
          );
          await this.executions.clearFrozen(execution.id, new Date());
          await this.executions.applyTransition(execution.id, 'failed', {
            failure_reason: 'container_lost',
            error_message:
              'Could not resume execution: container missing and no rehydratable session',
          });
        }
      } catch (error) {
        failed += 1;
        this.logger.error(
          `Failed to resume execution ${execution.id}: ${(error as Error).message}`,
        );
        try {
          await this.executions.clearFrozen(execution.id, new Date());
          await this.executions.applyTransition(execution.id, 'failed', {
            failure_reason: 'container_lost',
            error_message: `Failed to resume execution: ${(error as Error).message}`,
          });
        } catch (dbError) {
          this.logger.error(
            `Failed to mark execution ${execution.id} as failed after resume error: ${(dbError as Error).message}`,
          );
        }
      }
    }

    this.latestResumeSummary = {
      frozenFound: frozen.length,
      resumed,
      failed,
      lastResumeAt: resumedAt.toISOString(),
    };
    if (frozen.length > 0) {
      this.logger.warn(
        `Startup resume complete: found=${frozen.length} resumed=${resumed} failed=${failed}`,
      );
    }
  }
}
