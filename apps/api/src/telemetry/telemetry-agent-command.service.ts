import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
import {
  findAgentSocket,
  sendAgentCommandHelper,
  sendDehydrateCommandHelper,
} from './telemetry-gateway-agent-command.helpers';
import type { QuestionResponseAnswer } from './types';

/**
 * Owns every operation that needs the Socket.io `Server` reference: the
 * public command-sending surface consumed via the `TELEMETRY_GATEWAY`
 * injection token.
 *
 * The service receives its `Server` from
 * {@link TelemetryGateway.afterInit} — keeping the gateway itself a thin
 * WebSocket adapter and removing all server-dependent methods from it.
 */
@Injectable()
export class TelemetryAgentCommandService {
  private readonly logger = new Logger(TelemetryAgentCommandService.name);

  private server?: Server;

  /**
   * Wires the Socket.io `Server` into the service. Called by
   * {@link TelemetryGateway.afterInit}. Throws if any command is invoked
   * before the gateway has finished initializing — that would mean the
   * socket layer isn't ready, and a silent no-op would mask the bug.
   */
  attachServer(server: Server): void {
    this.server = server;
  }

  sendDehydrateCommand(containerId: string, timeoutMs = 15_000): Promise<void> {
    return sendDehydrateCommandHelper({
      server: this.requireServer(),
      containerId,
      timeoutMs,
    });
  }

  sendPromptCommand(
    workflowRunId: string,
    stepId: string,
    message: string,
  ): Promise<void> {
    return this.sendAgentCommand(workflowRunId, stepId, {
      type: 'prompt',
      message,
    });
  }

  sendAbortCommand(workflowRunId: string, stepId: string): Promise<void> {
    return this.sendAgentCommand(workflowRunId, stepId, { type: 'abort' });
  }

  hasActiveAgentSocket(workflowRunId: string, stepId?: string): boolean {
    return (
      findAgentSocket(this.requireServer(), workflowRunId, stepId) !== undefined
    );
  }

  sendQuestionResponseCommand(
    workflowRunId: string,
    stepId: string,
    answers: QuestionResponseAnswer[],
  ): Promise<void> {
    return this.sendAgentCommand(workflowRunId, stepId, {
      type: 'question_response',
      answers,
    });
  }

  sendPromptToActiveAgent(
    workflowRunId: string,
    message: string,
  ): Promise<void> {
    return sendAgentCommandHelper({
      server: this.requireServer(),
      logger: this.logger,
      workflowRunId,
      command: { type: 'prompt', message },
    });
  }

  sendQuestionResponseToActiveAgent(
    workflowRunId: string,
    answers: QuestionResponseAnswer[],
  ): Promise<void> {
    return sendAgentCommandHelper({
      server: this.requireServer(),
      logger: this.logger,
      workflowRunId,
      command: { type: 'question_response', answers },
    });
  }

  private sendAgentCommand(
    workflowRunId: string,
    stepId: string | undefined,
    command: Parameters<typeof sendAgentCommandHelper>[0]['command'],
  ): Promise<void> {
    return sendAgentCommandHelper({
      server: this.requireServer(),
      logger: this.logger,
      workflowRunId,
      stepId,
      command,
    });
  }

  private requireServer(): Server {
    if (!this.server) {
      throw new Error(
        'TelemetryAgentCommandService invoked before gateway finished initializing',
      );
    }
    return this.server;
  }
}
