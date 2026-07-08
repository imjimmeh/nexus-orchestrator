import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ChatSessionStatus } from '@nexus/core';
import type { DomainEventEnvelope } from '../domain-events/domain-event-bus.types';
import { InProcessDomainEventBus } from '../domain-events/in-process-domain-event.bus';
import { LOCAL_DOMAIN_EVENT_FANOUT } from '../domain-events/outbox-domain-event.bus';
import { ChatSessionRepository } from '../chat/database/repositories/chat-session.repository';
import { ExecutionRepository } from '../execution-lifecycle/database/repositories/execution.repository';
import { SessionHydrationService } from '../session/session-hydration.service';
import { EXECUTION_EVENT_TYPES } from '../execution-lifecycle/execution-lifecycle.contracts';
import {
  CHAT_SESSION_COMPLETED_EVENT,
  CHAT_SESSION_FAILED_EVENT,
} from './chat-session-events.constants';

const CHAT_EXECUTION_KINDS = new Set(['adhoc_chat', 'workflow_chat'] as const);

/** Single fallback message for a terminated execution with no specific reason. */
const DEFAULT_TERMINATION_MESSAGE = 'Execution terminated';

/**
 * The single router that drives a `chat_sessions` row to a terminal state off
 * `execution.*` domain events. It is the only listener that writes the terminal
 * state for executions keyed by `chat_session_id`, collapsing what were
 * previously two competing listeners (the chat-completion listener and the
 * execution-lifecycle legacy cascade) into one deterministic writer.
 *
 * Routing policy:
 *   - `execution.completed` → mark the session COMPLETED, but ONLY for chat
 *     kinds (`adhoc_chat`/`workflow_chat`). Completion of `subagent` /
 *     `workflow_step` executions is owned elsewhere and is intentionally
 *     ignored here.
 *   - `execution.failed` / `execution.reaped` → mark the session FAILED for ANY
 *     kind that carries a `chat_session_id` (chat kinds AND subagents), via the
 *     idempotent {@link ChatSessionRepository.failIfNotTerminal} writer.
 */
@Injectable()
export class ChatSessionTerminalRouter implements OnModuleInit {
  private readonly logger = new Logger(ChatSessionTerminalRouter.name);

  constructor(
    @Inject(LOCAL_DOMAIN_EVENT_FANOUT)
    private readonly bus: InProcessDomainEventBus,
    private readonly executionRepo: ExecutionRepository,
    private readonly chatSessionRepo: ChatSessionRepository,
    private readonly sessionHydration: SessionHydrationService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  onModuleInit(): void {
    this.bus.on(EXECUTION_EVENT_TYPES.completed, (e) =>
      this.handleCompleted(e),
    );
    this.bus.on(EXECUTION_EVENT_TYPES.failed, (e) => this.handleFailed(e));
    this.bus.on(EXECUTION_EVENT_TYPES.reaped, (e) => this.handleFailed(e));
  }

  private async handleCompleted(event: DomainEventEnvelope): Promise<void> {
    try {
      const execution = await this.executionRepo.findById(event.aggregateId);

      if (!execution?.chat_session_id) {
        return;
      }

      if (
        !CHAT_EXECUTION_KINDS.has(
          execution.kind as 'adhoc_chat' | 'workflow_chat',
        )
      ) {
        return;
      }

      const chatSessionId = execution.chat_session_id;

      let sessionTreeId: string | null = null;
      if (execution.container_id) {
        try {
          sessionTreeId = await this.sessionHydration.saveSessionForChat(
            execution.container_id,
            chatSessionId,
          );
        } catch (hydrateError) {
          this.logger.warn(
            `Failed to save session for chat ${chatSessionId} from container ${execution.container_id}: ${(hydrateError as Error).message}`,
          );
        }
      }

      await this.chatSessionRepo.update(chatSessionId, {
        status: ChatSessionStatus.COMPLETED,
        execution_state: 'completed',
        ...(sessionTreeId ? { session_tree_id: sessionTreeId } : {}),
        error_message: null,
        completed_at: new Date(),
      });

      this.eventEmitter.emit(CHAT_SESSION_COMPLETED_EVENT, {
        sessionId: chatSessionId,
        status: ChatSessionStatus.COMPLETED,
      });

      this.logger.log(
        `Chat session ${chatSessionId} marked COMPLETED via execution ${event.aggregateId}`,
      );
    } catch (error) {
      this.logger.warn(
        `ChatSessionTerminalRouter.handleCompleted failed for execution ${event.aggregateId}: ${(error as Error).message}`,
      );
    }
  }

  private async handleFailed(event: DomainEventEnvelope): Promise<void> {
    try {
      const execution = await this.executionRepo.findById(event.aggregateId);

      if (!execution?.chat_session_id) {
        return;
      }

      const chatSessionId = execution.chat_session_id;

      const wrote = await this.chatSessionRepo.failIfNotTerminal(
        chatSessionId,
        {
          reason: execution.failure_reason,
          message: execution.error_message ?? DEFAULT_TERMINATION_MESSAGE,
        },
      );

      if (!wrote) {
        return;
      }

      this.eventEmitter.emit(CHAT_SESSION_FAILED_EVENT, {
        sessionId: chatSessionId,
        status: ChatSessionStatus.FAILED,
      });

      this.logger.log(
        `Chat session ${chatSessionId} marked FAILED via execution ${event.aggregateId} (reason: ${execution.failure_reason ?? 'unknown'})`,
      );
    } catch (error) {
      this.logger.warn(
        `ChatSessionTerminalRouter.handleFailed failed for execution ${event.aggregateId}: ${(error as Error).message}`,
      );
    }
  }
}
