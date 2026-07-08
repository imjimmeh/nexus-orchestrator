import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationRepository } from './database/repositories/notification.repository';
import { UserRepository } from '../users/database/repositories/user.repository';
import { WORKFLOW_RUN_FAILED_EVENT } from '../workflow/workflow-events.constants';
import type { WorkflowRunEvent } from '../workflow/workflow-events.types';
import { NotificationGateway } from './notification.gateway';
import type {
  UserQuestionsAnsweredPayload,
  UserQuestionsPosedPayload,
} from './notification-producer.service.types';
import { WORKFLOW_PERSISTENCE_SERVICE } from '../workflow/kernel/interfaces/workflow-kernel.ports';
import type { IWorkflowPersistenceService } from '../workflow/kernel/interfaces/workflow-kernel.ports';

@Injectable()
export class NotificationProducerService {
  private readonly logger = new Logger(NotificationProducerService.name);

  constructor(
    private readonly notificationRepo: NotificationRepository,
    @Inject(WORKFLOW_PERSISTENCE_SERVICE)
    private readonly workflowPersistence: IWorkflowPersistenceService,
    private readonly notificationGateway: NotificationGateway,
    private readonly userRepo: UserRepository,
  ) {}

  @OnEvent(WORKFLOW_RUN_FAILED_EVENT)
  async handleWorkflowRunFailed(event: WorkflowRunEvent): Promise<void> {
    const trigger = event.stateVariables?.trigger;
    const scopeId =
      trigger &&
      typeof trigger === 'object' &&
      typeof (trigger as Record<string, unknown>).scopeId === 'string'
        ? ((trigger as Record<string, unknown>).scopeId as string)
        : null;

    if (!scopeId) {
      return;
    }

    await this.notifyWorkflowRunFailed(scopeId, event.workflowRunId);
  }

  @OnEvent('tool_call.approval_required')
  async handleToolCallApprovalRequired(payload: {
    requestId: string;
    scopeId?: string | null;
    toolName: string;
  }): Promise<void> {
    await this.notifyToolCallApprovalNeeded(
      payload.scopeId ?? null,
      payload.requestId,
      payload.toolName,
    );
  }

  @OnEvent('orchestration_action.pending')
  async handleOrchestrationActionPending(payload: {
    scopeId: string;
    actionRequestId: string;
    action: string;
  }): Promise<void> {
    await this.notifyOrchestrationActionPending(
      payload.scopeId,
      payload.actionRequestId,
      payload.action,
    );
  }

  async handleUserQuestionsPosed(
    payload: UserQuestionsPosedPayload,
  ): Promise<void> {
    try {
      const context = await this.resolveQuestionContext(payload.workflowRunId);
      if (!context.scopeId) return;

      await this.processNotificationsForProject(
        { scopeId: context.scopeId, contextId: context.contextId },
        payload,
      );
    } catch (error) {
      this.logger.error(
        `Failed to handle user_questions.posed for run ${payload.workflowRunId}: ${(error as Error).message}`,
      );
    }
  }

  async handleUserQuestionsAnswered(
    payload: UserQuestionsAnsweredPayload,
  ): Promise<void> {
    await this.notificationRepo.markUnreadInAppByCorrelationIdAsRead(
      `user_questions.posed:${payload.workflowRunId}`,
    );
  }

  private async resolveQuestionContext(
    workflowRunId: string,
  ): Promise<{ scopeId: string | null; contextId: string | null }> {
    let run;
    try {
      run = await this.workflowPersistence.getWorkflowRun(workflowRunId);
    } catch {
      this.logger.debug(
        `Could not resolve workflow run ${workflowRunId} for question context`,
      );
      return { scopeId: null, contextId: null };
    }
    const trigger = run.state_variables?.trigger as
      | Record<string, unknown>
      | undefined;
    const scopeId =
      typeof trigger?.scopeId === 'string' ? trigger.scopeId : null;
    const contextId =
      typeof trigger?.contextId === 'string' ? trigger.contextId : null;

    if (!scopeId) {
      this.logger.warn(`No scopeId found for workflow run ${workflowRunId}`);
    }

    return { scopeId, contextId };
  }

  private async processNotificationsForProject(
    context: { scopeId: string; contextId: string | null },
    payload: UserQuestionsPosedPayload,
  ): Promise<void> {
    const firstQuestionText =
      typeof payload.questions[0]?.question === 'string'
        ? payload.questions[0].question
        : 'The orchestrator has a question for you.';

    const correlationId = `user_questions.posed:${payload.workflowRunId}`;

    const admins = await this.userRepo.findActiveAdmins();
    for (const admin of admins) {
      const existing =
        await this.notificationRepo.findUnreadInAppByUserAndCorrelationId(
          admin.id,
          correlationId,
        );
      if (existing) {
        continue;
      }

      await this.createInAppNotification({
        userId: admin.id,
        scopeId: context.scopeId,
        subject: 'Input Needed From You',
        body: firstQuestionText,
        eventType: 'workflow.user_input.required',
        correlationId,
        metadata: {
          workflowRunId: payload.workflowRunId,
          scopeId: context.scopeId,
          contextId: context.contextId,
          questions: payload.questions,
        },
      });
    }
  }

  async createInAppNotification(params: {
    userId: string;
    scopeId?: string | null;
    subject: string;
    body: string;
    eventType: string;
    metadata?: Record<string, unknown> | null;
    correlationId?: string | null;
  }): Promise<void> {
    const notification = await this.notificationRepo.create({
      userId: params.userId,
      scopeId: params.scopeId ?? null,
      channel: 'in_app',
      externalRecipientId: params.userId,
      subject: params.subject,
      body: params.body,
      status: 'pending',
      eventType: params.eventType,
      metadata: params.metadata ?? null,
      correlationId: params.correlationId ?? null,
      readAt: null,
      readByUserId: null,
    });

    this.notificationGateway.broadcastNewNotification(
      params.userId,
      notification,
    );
  }

  async notifyWorkflowRunFailed(
    scopeId: string,
    workflowRunId: string,
  ): Promise<void> {
    const admins = await this.userRepo.findActiveAdmins();
    for (const admin of admins) {
      await this.createInAppNotification({
        userId: admin.id,
        scopeId,
        subject: 'Workflow Run Failed',
        body: `Workflow run ${workflowRunId} failed.`,
        eventType: 'workflow.run.failed',
        metadata: { workflowRunId, scopeId },
      });
    }
  }

  async notifyOrchestrationActionPending(
    scopeId: string,
    actionRequestId: string,
    action: string,
  ): Promise<void> {
    const admins = await this.userRepo.findActiveAdmins();
    for (const admin of admins) {
      await this.createInAppNotification({
        userId: admin.id,
        scopeId,
        subject: `Action Required: ${action}`,
        body: `Orchestration action '${action}' is pending approval.`,
        eventType: 'orchestration_action.pending',
        metadata: { actionRequestId, scopeId, action },
      });
    }
  }

  async notifyToolCallApprovalNeeded(
    scopeId: string | null,
    requestId: string,
    toolName: string,
  ): Promise<void> {
    const admins = await this.userRepo.findActiveAdmins();
    for (const admin of admins) {
      await this.createInAppNotification({
        userId: admin.id,
        scopeId,
        subject: `Tool Approval Needed: ${toolName}`,
        body: `A tool call (${toolName}) requires approval.`,
        eventType: 'tool_call.approval_needed',
        correlationId: `tool_call.approval_needed:${requestId}`,
        metadata: { requestId, scopeId, toolName },
      });
    }
  }
}
