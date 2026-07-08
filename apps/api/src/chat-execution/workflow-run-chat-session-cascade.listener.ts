import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ChatSessionStatus, type ChatSessionExecutionState } from '@nexus/core';
import { ChatSessionRepository } from '../chat/database/repositories/chat-session.repository';
import {
  WORKFLOW_RUN_COMPLETED_EVENT,
  WORKFLOW_RUN_FAILED_EVENT,
  WORKFLOW_RUN_CANCELLED_EVENT,
} from '../workflow/workflow-events.constants';
import type { WorkflowRunEvent } from '../workflow/workflow-events.types';

/**
 * Listens to workflow run terminal events and cascades the final status
 * to any chat sessions that were created as part of that workflow run.
 *
 * This prevents chat sessions from being left in RUNNING state indefinitely
 * when their parent workflow run has already terminated.
 */
@Injectable()
export class WorkflowRunChatSessionCascadeListener {
  private readonly logger = new Logger(
    WorkflowRunChatSessionCascadeListener.name,
  );

  constructor(private readonly chatSessionRepo: ChatSessionRepository) {}

  @OnEvent(WORKFLOW_RUN_COMPLETED_EVENT)
  async onRunCompleted(event: WorkflowRunEvent): Promise<void> {
    await this.cascadeStatus(
      event.workflowRunId,
      ChatSessionStatus.COMPLETED,
      'Workflow run completed',
    );
  }

  @OnEvent(WORKFLOW_RUN_FAILED_EVENT)
  async onRunFailed(event: WorkflowRunEvent): Promise<void> {
    await this.cascadeStatus(
      event.workflowRunId,
      ChatSessionStatus.FAILED,
      event.reason ?? 'Workflow run failed',
    );
  }

  @OnEvent(WORKFLOW_RUN_CANCELLED_EVENT)
  async onRunCancelled(event: WorkflowRunEvent): Promise<void> {
    await this.cascadeStatus(
      event.workflowRunId,
      ChatSessionStatus.CANCELLED,
      event.reason ?? 'Workflow run cancelled',
    );
  }

  private async cascadeStatus(
    workflowRunId: string,
    status: ChatSessionStatus,
    reason: string,
  ): Promise<void> {
    try {
      const sessions =
        await this.chatSessionRepo.findByWorkflowRunId(workflowRunId);

      if (sessions.length === 0) {
        return;
      }

      this.logger.log(
        `Cascading workflow run ${workflowRunId} termination (${status}) to ${sessions.length.toString()} linked chat session(s)`,
      );

      for (const session of sessions) {
        if (
          session.status === ChatSessionStatus.COMPLETED ||
          session.status === ChatSessionStatus.FAILED ||
          session.status === ChatSessionStatus.CANCELLED
        ) {
          continue;
        }

        // Route FAILED writes through the idempotent writer so a more specific,
        // earlier failure reason on the row can never be clobbered by this
        // generic run-level cascade.
        if (status === ChatSessionStatus.FAILED) {
          await this.chatSessionRepo.failIfNotTerminal(session.id, {
            message: reason,
          });
        } else {
          await this.chatSessionRepo.update(session.id, {
            status,
            execution_state: this.mapTerminalExecutionState(status),
            error_message: reason,
            completed_at: new Date(),
          });
        }

        this.logger.log(
          `Updated chat session ${session.id} status to ${status} (workflow run ${workflowRunId})`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to cascade workflow run ${workflowRunId} status to chat sessions: ${(error as Error).message}`,
      );
    }
  }

  private mapTerminalExecutionState(
    status: ChatSessionStatus,
  ): ChatSessionExecutionState {
    switch (status) {
      case ChatSessionStatus.COMPLETED:
        return 'completed';
      case ChatSessionStatus.FAILED:
        return 'failed';
      case ChatSessionStatus.CANCELLED:
        return 'cancelled';
      default:
        return 'failed';
    }
  }
}
