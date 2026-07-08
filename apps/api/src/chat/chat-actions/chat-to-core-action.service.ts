import { randomUUID } from 'node:crypto';
import { BadGatewayException, Injectable, Optional } from '@nestjs/common';
import {
  CoreHttpClient,
  WorkflowRunRequestV1Schema,
  type ServiceClientHttpOptions,
  type WorkflowRunRequestV1,
  type WorkflowRunStatusV1,
} from '@nexus/core';
import { isRecord } from '@nexus/core';
import { RequestContextService } from '../common/request-context.service';
import { isMemoryContextInjectionEnabled } from '../memory/chat-memory.config';
import { ChatCoreLookupService } from './chat-core-lookup.service';
import { unwrapSuccessEnvelope } from './chat-to-core-action.utils';
import {
  fetchJsonFromCore,
  resolveHttpOptions,
} from './chat-to-core-action-http.helpers';
import {
  readAcceptedCorrelationId,
  readNonEmptyString,
  readRunId,
  readStatusCorrelationId,
  readWorkflowId,
  readWorkflowRunEvent,
} from './chat-to-core-action.parsers';
import type {
  ChatActionQuestionAnswer,
  ChatActionMemoryContext,
  ChatActionRequestContext,
  ChatActionRunLink,
  ChatActionWorkflowRunEvent,
} from './chat-actions.types';

const DEFAULT_WORKFLOW_ID = 'chat_direct_agent_default';
const SERVICE_TOKEN_SUBJECT = 'chat-service';

@Injectable()
export class ChatToCoreActionService {
  private readonly client: CoreHttpClient;
  private readonly httpOptions: ServiceClientHttpOptions;
  private readonly defaultWorkflowId: string;

  constructor(
    @Optional() private readonly coreLookups?: ChatCoreLookupService,
    @Optional() private readonly requestContext?: RequestContextService,
  ) {
    this.httpOptions = resolveHttpOptions();
    this.client = new CoreHttpClient(this.httpOptions);
    this.defaultWorkflowId =
      (process.env.CHAT_DEFAULT_WORKFLOW_ID?.trim() || null) ??
      DEFAULT_WORKFLOW_ID;
  }

  async requestAction(
    params: ChatActionRequestContext,
  ): Promise<ChatActionRunLink> {
    const resolvedWorkflowId = await this.resolveWorkflowId(
      params.workflowId ?? this.defaultWorkflowId,
    );
    const request = this.buildWorkflowRunRequest(params, resolvedWorkflowId);

    try {
      const accepted = await this.client.requestWorkflowRun(request);
      const correlationId =
        readAcceptedCorrelationId(accepted) ?? request.metadata.correlation_id;

      return {
        runId: this.requireRunId(accepted),
        workflowId: this.requireWorkflowId(accepted),
        runStatus: 'PENDING',
        correlation_id: correlationId,
      };
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error;
      }

      throw new BadGatewayException(
        `Failed to submit chat action request to core: ${(error as Error).message}`,
      );
    }
  }

  async continueWorkflowRunWithMessage(params: {
    runId: string;
    message: string;
    correlationId?: string | null;
  }): Promise<ChatActionRunLink> {
    const correlationId = this.resolveIncomingCorrelationId(
      params.correlationId,
    );

    try {
      await this.fetchJsonFromCore(
        `/workflows/runs/${encodeURIComponent(params.runId)}/inject`,
        correlationId,
        {
          method: 'POST',
          body: {
            message: params.message,
          },
        },
      );

      const status = await this.getWorkflowRunStatus(
        params.runId,
        correlationId,
      );

      return {
        runId: this.requireRunId(status),
        workflowId: this.requireWorkflowId(status),
        runStatus: status.status,
        correlation_id: readStatusCorrelationId(status) ?? correlationId,
      };
    } catch (error) {
      throw new BadGatewayException(
        `Failed to continue workflow run ${params.runId}: ${(error as Error).message}`,
      );
    }
  }

  async getWorkflowRunStatus(
    runId: string,
    correlationId: string,
  ): Promise<WorkflowRunStatusV1> {
    try {
      return await this.client.getWorkflowRunStatus(runId, correlationId);
    } catch (error) {
      throw new BadGatewayException(
        `Failed to fetch workflow run status for ${runId}: ${(error as Error).message}`,
      );
    }
  }

  async getWorkflowRunDetails(
    runId: string,
    correlationId: string,
  ): Promise<Record<string, unknown>> {
    try {
      const response = await this.fetchJsonFromCore(
        `/workflows/runs/${encodeURIComponent(runId)}`,
        correlationId,
      );
      const data = unwrapSuccessEnvelope(response);
      if (!isRecord(data)) {
        throw new Error('Unexpected workflow run details response payload');
      }

      return data;
    } catch (error) {
      throw new BadGatewayException(
        `Failed to fetch workflow run details for ${runId}: ${(error as Error).message}`,
      );
    }
  }

  async getWorkflowRunEvents(
    runId: string,
    correlationId: string,
  ): Promise<ChatActionWorkflowRunEvent[]> {
    try {
      const response = await this.fetchJsonFromCore(
        `/workflows/runs/${encodeURIComponent(runId)}/events`,
        correlationId,
      );
      const data = unwrapSuccessEnvelope(response);
      if (!Array.isArray(data)) {
        throw new TypeError('Unexpected workflow run events response payload');
      }

      const events: ChatActionWorkflowRunEvent[] = [];
      for (const entry of data) {
        const event = readWorkflowRunEvent(entry);
        if (event) {
          events.push(event);
        }
      }

      return events;
    } catch (error) {
      throw new BadGatewayException(
        `Failed to fetch workflow run events for ${runId}: ${(error as Error).message}`,
      );
    }
  }

  async submitWorkflowRunQuestionAnswers(
    runId: string,
    correlationId: string,
    answers: ChatActionQuestionAnswer[],
  ): Promise<void> {
    try {
      await this.fetchJsonFromCore(
        `/workflows/runs/${encodeURIComponent(runId)}/question-answers`,
        correlationId,
        {
          method: 'POST',
          body: { answers },
        },
      );
    } catch (error) {
      throw new BadGatewayException(
        `Failed to submit question answers for workflow run ${runId}: ${(error as Error).message}`,
      );
    }
  }

  private buildWorkflowRunRequest(
    params: ChatActionRequestContext,
    workflowId: string,
  ): WorkflowRunRequestV1 {
    return WorkflowRunRequestV1Schema.parse({
      workflow_id: workflowId,
      input: this.buildWorkflowInput(params),
      launch_source: `chat_ingress_${params.channel}`,
      metadata: {
        correlation_id: this.resolveCorrelationId(),
        causation_id: this.resolveCausationId(params),
        idempotency_key: this.resolveIdempotencyKey(params),
        requested_by: params.requestedBy ?? SERVICE_TOKEN_SUBJECT,
      },
    });
  }

  private requireRunId(value: unknown): string {
    const runId = readRunId(value);
    if (!runId) {
      throw new Error('Core workflow run response is missing run id');
    }

    return runId;
  }

  private requireWorkflowId(value: unknown): string {
    const workflowId = readWorkflowId(value);
    if (!workflowId) {
      throw new Error('Core workflow run response is missing workflow id');
    }

    return workflowId;
  }

  private buildWorkflowInput(params: ChatActionRequestContext): {
    chatSessionId: string;
    messageId: string;
    message: string;
    objective: string;
    channel: string;
    agent_profile: string;
    scopeId: string | null;
    externalUserId: string | null;
    memory_context: ChatActionMemoryContext | null;
  } {
    return {
      chatSessionId: params.chatSessionId,
      messageId: params.messageId,
      message: params.message,
      objective: params.message,
      channel: params.channel,
      agent_profile: params.agentProfileName,
      scopeId: params.scopeId ?? null,
      externalUserId: params.externalUserId ?? null,
      memory_context: this.resolveMemoryContextForInjection(
        params.memoryContext,
      ),
    };
  }

  /**
   * Returns the memory context to forward to the workflow, honoring the
   * `MEMORY_CONTEXT_INJECTION_ENABLED` graduated-rollout guard. When the
   * flag is disabled, forces `null` so the workflow's
   * `{{#if trigger.memory_context}}` block is skipped at render time.
   */
  private resolveMemoryContextForInjection(
    memoryContext: ChatActionMemoryContext | null | undefined,
  ): ChatActionMemoryContext | null {
    if (!isMemoryContextInjectionEnabled()) {
      return null;
    }

    return memoryContext ?? null;
  }

  private resolveCorrelationId(): string {
    return this.requestContext?.getRequestId() ?? randomUUID();
  }

  private resolveIncomingCorrelationId(
    value: string | null | undefined,
  ): string {
    const provided = readNonEmptyString(value);
    return provided ?? this.resolveCorrelationId();
  }

  private resolveCausationId(params: ChatActionRequestContext): string {
    return this.requestContext?.getCausationId() ?? params.messageId;
  }

  private resolveIdempotencyKey(params: ChatActionRequestContext): string {
    return (
      params.idempotencyKey ??
      `chat:${params.channel}:${params.chatSessionId}:${params.messageId}`
    );
  }

  private async resolveWorkflowId(workflowIdentifier: string): Promise<string> {
    const trimmedIdentifier = workflowIdentifier.trim();
    if (!trimmedIdentifier) {
      throw new BadGatewayException(
        'Failed to resolve chat workflow identifier: value is empty',
      );
    }

    if (!this.coreLookups) {
      return trimmedIdentifier;
    }

    const resolvedWorkflowId =
      await this.coreLookups.resolveActiveWorkflowId(trimmedIdentifier);
    if (!resolvedWorkflowId) {
      throw new BadGatewayException(
        `Failed to resolve chat workflow identifier '${trimmedIdentifier}' to an active workflow UUID`,
      );
    }

    return resolvedWorkflowId;
  }

  private async fetchJsonFromCore(
    path: string,
    correlationId: string,
    options?: {
      method?: 'GET' | 'POST';
      body?: unknown;
    },
  ): Promise<unknown> {
    return fetchJsonFromCore({
      httpOptions: this.httpOptions,
      path,
      correlationId,
      options,
    });
  }
}
