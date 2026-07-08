import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
import Docker from 'dockerode';
import { DOCKER_CLIENT } from '../../docker/docker.constants';
import { RedisStreamService } from '../../redis/redis-stream.service';
import { RedisPubSubService } from '../../redis/redis-pubsub.service';
import { TELEMETRY_GATEWAY } from '../../shared/interfaces/telemetry-gateway.interface';
import { type ITelemetryGateway } from '../../shared/interfaces/telemetry-gateway.interface';
import { SESSION_HYDRATION_SERVICE } from '../../shared/interfaces/session-hydration.interface';
import type { ISessionHydrationService } from '../../shared/interfaces/session-hydration.interface';
import { WorkflowEventLogService } from '../workflow-event-log.service';
import { SubagentOrchestratorService } from '../workflow-subagents/subagent-orchestrator.service';
import {
  WORKFLOW_ENGINE_SERVICE,
  WORKFLOW_PERSISTENCE_SERVICE,
} from '../kernel/interfaces/workflow-kernel.ports';
import type {
  IWorkflowEngineService,
  IWorkflowPersistenceService,
} from '../kernel/interfaces/workflow-kernel.ports';
import { UserQuestionAwaitRepository } from '../database/repositories/user-question-await.repository';
import type { SubmittedAnswer } from '../database/entities/user-question-await.entity.types';
import { QuestionIdleTrackerService } from './question-idle-tracker.service';

const USER_QUESTIONS_ANSWERED_EVENT = 'workflow.user_questions.answered';

type RunControlAction = 'pause' | 'resume' | 'abort';

@Injectable()
export class WorkflowRunSteeringService {
  private readonly logger = new Logger(WorkflowRunSteeringService.name);

  constructor(
    @Inject(WORKFLOW_ENGINE_SERVICE)
    private readonly workflowEngine: IWorkflowEngineService,
    @Inject(WORKFLOW_PERSISTENCE_SERVICE)
    private readonly workflowPersistence: IWorkflowPersistenceService,
    private readonly streamService: RedisStreamService,
    private readonly pubsubService: RedisPubSubService,
    @Inject(SESSION_HYDRATION_SERVICE)
    private readonly sessionHydration: ISessionHydrationService,
    private readonly subagentOrchestrator: SubagentOrchestratorService,
    @Inject(DOCKER_CLIENT) private readonly docker: Docker,
    private readonly eventEmitter: EventEmitter2,
    private readonly workflowEventLog: WorkflowEventLogService,
    private readonly moduleRef: ModuleRef,
    private readonly questionAwaitRepo: UserQuestionAwaitRepository,
    private readonly questionIdleTracker: QuestionIdleTrackerService,
  ) {}

  private get telemetryGateway(): ITelemetryGateway {
    const gateway = this.moduleRef.get<ITelemetryGateway>(TELEMETRY_GATEWAY, {
      strict: false,
    });
    if (!gateway) {
      throw new Error(
        'TELEMETRY_GATEWAY resolved to null — TelemetryModule must provide the real gateway',
      );
    }
    return gateway;
  }

  async pause(workflowRunId: string): Promise<{ containerId: string }> {
    const containerInfo = await this.findActiveContainerInfo(workflowRunId);
    const container = this.docker.getContainer(containerInfo.Id);

    if (containerInfo.State === 'paused') {
      return { containerId: containerInfo.Id };
    }

    await container.pause();
    await this.publishControlEvent(workflowRunId, 'pause', containerInfo.Id);

    return { containerId: containerInfo.Id };
  }

  async resume(workflowRunId: string): Promise<{ containerId: string }> {
    const containerInfo = await this.findActiveContainerInfo(workflowRunId, {
      includePaused: true,
    });
    const container = this.docker.getContainer(containerInfo.Id);

    if (containerInfo.State === 'paused') {
      await container.unpause();
    } else if (containerInfo.State !== 'running') {
      await container.start();
    }

    await this.publishControlEvent(workflowRunId, 'resume', containerInfo.Id);
    return { containerId: containerInfo.Id };
  }

  async abort(
    workflowRunId: string,
    reason = 'user_abort',
  ): Promise<{ containerId: string | null }> {
    await this.workflowPersistence.getWorkflowRun(workflowRunId);

    const containerInfo = await this.findActiveContainerInfoOrNull(
      workflowRunId,
      {
        includePaused: true,
      },
    );

    if (containerInfo) {
      const container = this.docker.getContainer(containerInfo.Id);

      try {
        await container.kill();
      } catch {
        // container may already be stopped
      }

      try {
        const cancellation =
          await this.subagentOrchestrator.cancelActiveForParent(
            containerInfo.Id,
            {
              workflowRunId,
              reason,
            },
          );

        if (cancellation.cancelled_execution_ids.length > 0) {
          await this.workflowEventLog.appendBestEffort({
            workflowRunId,
            eventType: 'subagent.cancelled_by_parent_abort',
            payload: {
              parentContainerId: containerInfo.Id,
              cancelledExecutionIds: cancellation.cancelled_execution_ids,
            },
          });
        }
      } catch (error) {
        this.logger.warn(
          `Failed to cancel child subagents during abort for ${workflowRunId}: ${(error as Error).message}`,
        );
      }
    }

    await this.workflowEngine.cancelWorkflowRun(workflowRunId, reason);
    await this.publishControlEvent(
      workflowRunId,
      'abort',
      containerInfo?.Id ?? null,
    );

    await this.questionAwaitRepo.cancelOpenForRun(workflowRunId);
    this.questionIdleTracker.clearTracking(workflowRunId);

    return { containerId: containerInfo?.Id ?? null };
  }

  async injectMessage(
    workflowRunId: string,
    message: string,
  ): Promise<{ acknowledged: true }> {
    await this.workflowPersistence.getWorkflowRun(workflowRunId);

    // 1. Publish user message to the telemetry stream so the UI sees it.
    await this.publishEvent(workflowRunId, {
      event_type: 'user_message',
      payload: {
        workflowRunId,
        message,
      },
      timestamp: new Date().toISOString(),
    });

    // 2. Try to forward to a running agent container via WebSocket prompt.
    const activeContainer = await this.findRunningContainer(workflowRunId);
    if (activeContainer) {
      try {
        const stepId = this.extractStepId(activeContainer);
        await this.telemetryGateway.sendPromptCommand(
          workflowRunId,
          stepId,
          message,
        );
        return { acknowledged: true };
      } catch {
        // Socket not found — fall through to resume logic.
      }
    }

    // 3. No active container — check for a saved session to resume.
    const sessionTree =
      await this.sessionHydration.findSessionTreeByWorkflowRunId(workflowRunId);

    if (sessionTree) {
      this.logger.log(
        `Resuming session ${sessionTree.id} for ${workflowRunId} with user message`,
      );

      await this.workflowEngine.resumeJobWithMessage(
        workflowRunId,
        sessionTree.id,
        message,
      );

      return { acknowledged: true };
    }

    await this.publishEvent(workflowRunId, {
      event_type: 'user_message_delivery_failed',
      payload: {
        workflowRunId,
        message,
        reason: 'no_active_container_or_saved_session',
      },
      timestamp: new Date().toISOString(),
    });

    await this.workflowEventLog.appendBestEffort({
      workflowRunId,
      eventType: 'user_message.delivery_failed',
      payload: {
        message,
        reason: 'no_active_container_or_saved_session',
      },
    });

    throw new ConflictException(
      `Unable to deliver guidance for workflow run ${workflowRunId}: no active container or saved session is available.`,
    );
  }

  /**
   * Submit answers to questions posed by the agent via ask_user_questions.
   *
   * Durable path (preferred): when a `user_question_awaits` row exists for
   * the run, answers are persisted on the row and delivery targets the
   * recorded step_id / job_id rather than relying on live container labels.
   *
   * Legacy path (backward compat): when no durable row exists (run started
   * before this fix), falls back to the original container-label discovery.
   *
   * The `awaiting_input` flag is cleared (via USER_QUESTIONS_ANSWERED_EVENT)
   * only after confirmed delivery; total failure throws ConflictException.
   */
  async submitQuestionAnswers(
    workflowRunId: string,
    answers: SubmittedAnswer[],
  ): Promise<{ acknowledged: true }> {
    await this.workflowPersistence.getWorkflowRun(workflowRunId);

    // Persist the answer event so the UI can replay it.
    await this.publishEvent(workflowRunId, {
      event_type: 'user_question_answers',
      payload: {
        workflowRunId,
        answers,
      },
      timestamp: new Date().toISOString(),
    });

    await this.workflowEventLog.appendBestEffort({
      workflowRunId,
      eventType: 'user_questions.answered',
      payload: { answerCount: answers.length },
    });

    const durableRow =
      await this.questionAwaitRepo.findOpenByRunId(workflowRunId);

    if (durableRow) {
      return this.deliverViaRow(workflowRunId, answers, durableRow);
    }

    return this.deliverViaLegacyContainerPath(workflowRunId, answers);
  }

  /**
   * Durable delivery path: uses the recorded step_id and job_id from the
   * `user_question_awaits` row to target delivery precisely.
   */
  private async deliverViaRow(
    workflowRunId: string,
    answers: SubmittedAnswer[],
    row: { id: string; job_id: string; step_id: string },
  ): Promise<{ acknowledged: true }> {
    // WS fast path: live agent socket for the recorded step.
    const hasSocket = this.telemetryGateway.hasActiveAgentSocket(
      workflowRunId,
      row.step_id,
    );

    if (hasSocket) {
      try {
        await this.telemetryGateway.sendQuestionResponseCommand(
          workflowRunId,
          row.step_id,
          answers,
        );
        await this.questionAwaitRepo.markAnswered(row.id, answers, 'ws');
        this.questionIdleTracker.clearTracking(workflowRunId);
        this.eventEmitter.emit(USER_QUESTIONS_ANSWERED_EVENT, {
          workflowRunId,
        });
        return { acknowledged: true };
      } catch (wsError) {
        this.logger.warn(
          `WS delivery failed for ${workflowRunId} step ${row.step_id}: ` +
            `${(wsError as Error).message}. Falling through to session resume path.`,
        );
      }
    }

    // Session resume path: kill lingering container then resume via job_id.
    const sessionTree =
      await this.sessionHydration.findSessionTreeByWorkflowRunId(workflowRunId);

    if (!sessionTree) {
      await this.questionAwaitRepo.markFailedDelivery(row.id, answers);
      throw new ConflictException(
        `Unable to deliver answers for workflow run ${workflowRunId}: ` +
          'no active agent socket and no saved session is available.',
      );
    }

    await this.killLingeringContainer(workflowRunId);

    const followUpMessage = this.buildQuestionAnswerFollowUpMessage(answers);
    await this.workflowEngine.resumeJobWithMessage(
      workflowRunId,
      sessionTree.id,
      followUpMessage,
      { jobId: row.job_id },
    );

    await this.questionAwaitRepo.markAnswered(row.id, answers, 'resume');
    this.questionIdleTracker.clearTracking(workflowRunId);
    this.eventEmitter.emit(USER_QUESTIONS_ANSWERED_EVENT, { workflowRunId });

    this.logger.log(
      `No agent socket for ${workflowRunId}; resumed job ${row.job_id} ` +
        `via session ${sessionTree.id} after persisting question answers.`,
    );

    return { acknowledged: true };
  }

  /**
   * Legacy delivery path for runs started before the durable row was
   * introduced. Discovers the target step via Docker container labels and
   * emits the answered event only after a successful WS or resume delivery.
   * When neither path is available, throws ConflictException rather than
   * falsely acknowledging — mirroring the honesty contract of deliverViaRow.
   */
  private async deliverViaLegacyContainerPath(
    workflowRunId: string,
    answers: SubmittedAnswer[],
  ): Promise<{ acknowledged: true }> {
    // WS path: live agent container discovered via Docker labels.
    const activeContainer = await this.findRunningContainer(workflowRunId);
    if (activeContainer) {
      try {
        const stepId = this.extractStepId(activeContainer);
        await this.telemetryGateway.sendQuestionResponseCommand(
          workflowRunId,
          stepId,
          answers,
        );
        this.eventEmitter.emit(USER_QUESTIONS_ANSWERED_EVENT, {
          workflowRunId,
        });
        return { acknowledged: true };
      } catch (error) {
        this.logger.warn(
          `WS delivery failed for ${workflowRunId} despite running container ` +
            `${activeContainer.Id}: ${(error as Error).message}. ` +
            'Falling through to session resume path.',
        );
      }
    }

    // Session resume path: rehydrate the saved session with the answers.
    const sessionTree =
      await this.sessionHydration.findSessionTreeByWorkflowRunId(workflowRunId);

    if (!sessionTree) {
      throw new ConflictException(
        `Unable to deliver answers for workflow run ${workflowRunId}: ` +
          'no active container and no saved session is available.',
      );
    }

    const followUpMessage = this.buildQuestionAnswerFollowUpMessage(answers);
    await this.workflowEngine.resumeJobWithMessage(
      workflowRunId,
      sessionTree.id,
      followUpMessage,
    );
    this.eventEmitter.emit(USER_QUESTIONS_ANSWERED_EVENT, { workflowRunId });

    this.logger.log(
      `No active container for ${workflowRunId}; resumed session ${sessionTree.id} ` +
        'after persisting question answers to the event stream.',
    );

    return { acknowledged: true };
  }

  /** Best-effort: kill any lingering executor container for this run. */
  private async killLingeringContainer(workflowRunId: string): Promise<void> {
    const containerInfo = await this.findRunningContainer(workflowRunId);
    if (!containerInfo) return;

    try {
      const container = this.docker.getContainer(containerInfo.Id);
      await container.kill();
    } catch (error) {
      this.logger.warn(
        `Best-effort container kill failed for ${workflowRunId}: ` +
          (error as Error).message,
      );
    }
  }

  private async findRunningContainer(
    workflowRunId: string,
  ): Promise<Docker.ContainerInfo | null> {
    try {
      const containers = await this.docker.listContainers({
        all: false,
        filters: {
          label: [
            'nexus.managed=true',
            `nexus.workflow_run_id=${workflowRunId}`,
          ],
          status: ['running'],
        },
      });
      if (containers.length === 0) return null;
      // Return the newest container (highest Created timestamp)
      const sortedContainers = [...containers].sort(
        (a, b) => b.Created - a.Created,
      );
      return sortedContainers[0];
    } catch {
      return null;
    }
  }

  private extractStepId(container: Docker.ContainerInfo): string {
    return container.Labels['nexus.step_id'] || 'unknown';
  }

  private async findActiveContainerInfo(
    workflowRunId: string,
    options?: { includePaused?: boolean },
  ): Promise<Docker.ContainerInfo> {
    await this.workflowPersistence.getWorkflowRun(workflowRunId);

    const containers = await this.docker.listContainers({
      all: true,
      filters: {
        label: [`nexus.managed=true`, `nexus.workflow_run_id=${workflowRunId}`],
      },
    });

    const candidates = containers.filter((entry) => {
      if (entry.State === 'running') {
        return true;
      }

      if (options?.includePaused && entry.State === 'paused') {
        return true;
      }

      return false;
    });

    const containerInfo = this.selectPreferredWorkflowContainer(candidates);
    if (!containerInfo) {
      throw new NotFoundException(
        `No active container found for workflow run ${workflowRunId}`,
      );
    }

    return containerInfo;
  }

  private selectPreferredWorkflowContainer(
    containers: Docker.ContainerInfo[],
  ): Docker.ContainerInfo | null {
    const sortedContainers = [...containers].sort((a, b) => {
      const parentPreference =
        Number(this.isChildSubagentContainer(a)) -
        Number(this.isChildSubagentContainer(b));
      if (parentPreference !== 0) {
        return parentPreference;
      }

      return b.Created - a.Created;
    });

    return sortedContainers[0] ?? null;
  }

  private isChildSubagentContainer(container: Docker.ContainerInfo): boolean {
    return Boolean(container.Labels?.['nexus.parent_container_id']);
  }

  private async findActiveContainerInfoOrNull(
    workflowRunId: string,
    options?: { includePaused?: boolean },
  ): Promise<Docker.ContainerInfo | null> {
    try {
      return await this.findActiveContainerInfo(workflowRunId, options);
    } catch (error) {
      if (error instanceof NotFoundException) {
        return null;
      }

      throw error;
    }
  }

  private async publishControlEvent(
    workflowRunId: string,
    action: RunControlAction,
    containerId: string | null,
  ): Promise<void> {
    await this.publishEvent(workflowRunId, {
      event_type: 'workflow_control',
      payload: {
        action,
        containerId,
      },
      timestamp: new Date().toISOString(),
    });
  }

  private async publishEvent(
    workflowRunId: string,
    event: {
      event_type: string;
      payload: Record<string, unknown>;
      timestamp: string;
    },
  ): Promise<void> {
    await this.streamService.persistEvent(workflowRunId, event);
    await this.pubsubService.publishEvent(workflowRunId, event);
  }

  private buildQuestionAnswerFollowUpMessage(
    answers: SubmittedAnswer[],
  ): string {
    if (answers.length === 0) {
      return (
        'The user submitted question responses from the UI. ' +
        'Continue from the resumed session context and proceed with the workflow.'
      );
    }

    const lines = answers.map((answer) => {
      const option = answer.selectedOption?.trim();
      const freeText = answer.freeTextAnswer?.trim();
      const parts: string[] = [];

      if (option && option.length > 0) {
        parts.push(`option=${option}`);
      }

      if (freeText && freeText.length > 0) {
        parts.push(`text=${freeText}`);
      }

      const normalized =
        parts.length > 0 ? parts.join(' | ') : 'no answer provided';
      return `Q${answer.questionIndex + 1}: ${normalized}`;
    });

    return [
      'The user answered your previously asked questions.',
      'Continue from the resumed session context using these canonical answers:',
      ...lines,
    ].join('\n');
  }
}
