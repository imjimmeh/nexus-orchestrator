import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleInit,
} from '@nestjs/common';
import Docker from 'dockerode';
import { DOCKER_CLIENT } from '../../docker/docker.constants';
import { QuestionIdleTrackerService } from './question-idle-tracker.service';
import { UserQuestionAwaitRepository } from '../database/repositories/user-question-await.repository';

/**
 * Container lifecycle for runs parked on a user question.
 *
 * A parked run does not need a live container: the question and its owning
 * job are durable (user_question_awaits) and the answer path resumes from the
 * persisted session tree. So after the idle thresholds we stop, then remove,
 * the waiting container to free heavy-tier capacity. Timers are in-memory;
 * onApplicationBootstrap re-arms them from open rows after a restart.
 */
@Injectable()
export class QuestionIdleContainerListener
  implements OnModuleInit, OnApplicationBootstrap
{
  private readonly logger = new Logger(QuestionIdleContainerListener.name);

  constructor(
    private readonly tracker: QuestionIdleTrackerService,
    @Inject(DOCKER_CLIENT) private readonly docker: Docker,
    private readonly questionAwaitRepo: UserQuestionAwaitRepository,
  ) {}

  onModuleInit(): void {
    this.tracker.registerCallbacks({
      onStop: (workflowRunId, containerId) =>
        this.stopContainer(workflowRunId, containerId),
      onRemove: (workflowRunId, containerId) =>
        this.removeContainer(workflowRunId, containerId),
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    const openRuns = await this.questionAwaitRepo.findRunIdsWithOpenQuestions();
    if (openRuns.size === 0) {
      return;
    }

    const containers = await this.docker.listContainers({
      all: false,
      filters: { label: ['nexus.managed=true'], status: ['running'] },
    });
    for (const container of containers) {
      const runId = container.Labels?.['nexus.workflow_run_id'];
      if (runId && openRuns.has(runId) && !this.tracker.isTracking(runId)) {
        this.logger.log(
          `Re-arming question idle tracking for run ${runId} (container ${container.Id})`,
        );
        await this.tracker.trackQuestionsPosed(runId, container.Id);
      }
    }
  }

  private async stopContainer(
    workflowRunId: string,
    containerId: string,
  ): Promise<void> {
    try {
      await this.docker.getContainer(containerId).stop();
      this.logger.log(
        `Stopped question-idle container ${containerId} for run ${workflowRunId}`,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to stop question-idle container ${containerId}: ${(error as Error).message}`,
      );
    }
  }

  private async removeContainer(
    workflowRunId: string,
    containerId: string,
  ): Promise<void> {
    try {
      await this.docker.getContainer(containerId).remove({ force: true });
      this.logger.log(
        `Removed question-idle container ${containerId} for run ${workflowRunId}`,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to remove question-idle container ${containerId}: ${(error as Error).message}`,
      );
    }
  }
}
