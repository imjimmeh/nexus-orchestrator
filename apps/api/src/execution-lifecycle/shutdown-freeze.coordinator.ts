import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ExecutionRepository } from './database/repositories/execution.repository';
import { ExecutionEventPublisher } from './execution-event.publisher';
import { ServiceLifecycleStateService } from './service-lifecycle-state.service';
import {
  FREEZABLE_EXECUTION_KINDS,
  FREEZE_REASON_SHUTDOWN,
  resolveFreezeBudgetMs,
} from './freeze.contracts';
import type {
  ContainerFreezer,
  StepQueueDrainer,
} from './shutdown-freeze.coordinator.types';

export const CONTAINER_FREEZER = Symbol('CONTAINER_FREEZER');
export const STEP_QUEUE_DRAINER = Symbol('STEP_QUEUE_DRAINER');

@Injectable()
export class ShutdownFreezeCoordinator implements OnApplicationShutdown {
  private readonly logger = new Logger(ShutdownFreezeCoordinator.name);
  private readonly budgetMs = resolveFreezeBudgetMs(
    process.env.EXECUTION_FREEZE_BUDGET_MS,
  );

  constructor(
    private readonly lifecycle: ServiceLifecycleStateService,
    private readonly executions: ExecutionRepository,
    @Inject(CONTAINER_FREEZER) private readonly freezer: ContainerFreezer,
    private readonly publisher: ExecutionEventPublisher,
    @Inject(STEP_QUEUE_DRAINER) private readonly queues: StepQueueDrainer,
  ) {}

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.lifecycle.markDraining();
    this.logger.warn(
      `Shutdown (${signal ?? 'unknown'}): freezing in-flight executions`,
    );

    try {
      await this.queues.pauseAll();
    } catch (error) {
      this.logger.error(
        `Failed to pause step workers: ${(error as Error).message}`,
      );
    }

    let candidates: Array<{ id: string; container_id?: string | null }>;
    try {
      candidates = await this.executions.findFreezeCandidates(
        FREEZABLE_EXECUTION_KINDS,
      );
    } catch (error) {
      this.logger.error(
        `Could not load freeze candidates: ${(error as Error).message}`,
      );
      return;
    }

    const pausedAt = new Date();
    const deadline = pausedAt.getTime() + this.budgetMs;
    let frozen = 0;
    let skipped = 0;

    for (const execution of candidates) {
      if (!execution.container_id) {
        skipped += 1;
        continue;
      }
      if (Date.now() > deadline) {
        skipped += candidates.length - frozen - skipped;
        this.logger.warn(
          `Freeze budget (${this.budgetMs}ms) exceeded; ${skipped} execution(s) left to the resilience net`,
        );
        break;
      }
      try {
        await this.freezer.freezeContainer(execution.container_id);
        await this.executions.markFrozen(
          execution.id,
          FREEZE_REASON_SHUTDOWN,
          pausedAt,
        );
        await this.publisher.paused(execution.id, {
          reason: FREEZE_REASON_SHUTDOWN,
        });
        frozen += 1;
      } catch (error) {
        skipped += 1;
        this.logger.error(
          `Failed to freeze execution ${execution.id} (container ${execution.container_id}): ${(error as Error).message}`,
        );
      }
    }

    this.logger.warn(
      `Shutdown freeze complete: frozen=${frozen} skipped=${skipped}`,
    );
  }
}
