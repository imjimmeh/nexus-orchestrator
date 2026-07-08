import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AgentProfileRepository } from '../../ai-config/database/repositories/agent-profile.repository';
import {
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowRunRepository,
} from '../kernel/interfaces/workflow-kernel.ports';
import { SystemSettingsService } from '../../settings/system-settings.service';
import { resolveAgentMentionTriggerScope } from '../../shared/agent-scope.utils';
import { findMentionDenialReason } from './agent-communication-mesh.service.validation';
import type {
  AgentMentionLifecycleEvent,
  CheckAgentMentionsParams,
  CheckAgentMentionsResult,
  MentionValidationContext,
  MentionAgentParams,
  MentionAgentResult,
  ResolveAgentThreadParams,
  ResolveAgentThreadResult,
} from './agent-communication-mesh.service.types';
import { WorkflowEventLogService } from '../workflow-event-log.service';
import {
  AGENT_COMMUNICATION_DOMAIN_PORT,
  type AgentCommunicationThreadUrgency,
  type IAgentCommunicationDomainPort,
} from '../domain-ports';
import {
  buildMentionAcceptedLifecycleEvents,
  buildResolveDeniedResult,
  resolveThreadDenialReason,
  toAgentMentionThreadSummary,
} from './agent-communication-mesh.service.utils';
import {
  createMentionMessages,
  persistResolvedThread,
  upsertMentionThread,
} from './agent-communication-mesh.service.persistence';

export type {
  AgentMentionLifecycleEvent,
  AgentMentionMessageSummary,
  AgentMentionThreadSummary,
  CheckAgentMentionsParams,
  CheckAgentMentionsResult,
  MentionAgentParams,
  MentionAgentResult,
  ResolveAgentThreadParams,
  ResolveAgentThreadResult,
} from './agent-communication-mesh.service.types';

interface NormalizedMentionParams {
  workflowRunId: string;
  targetAgentProfile: string;
  body: string;
  requesterExecutionId: string | null;
  payloadContextId: string | null;
  threadId: string;
  correlationId: string;
  urgency: AgentCommunicationThreadUrgency;
  metadata: Record<string, unknown> | null;
}

@Injectable()
export class AgentCommunicationMeshService {
  constructor(
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly workflowRunRepository: IWorkflowRunRepository,
    private readonly agentProfileRepository: AgentProfileRepository,
    @Inject(AGENT_COMMUNICATION_DOMAIN_PORT)
    private readonly agentCommunication: IAgentCommunicationDomainPort,
    private readonly systemSettings: SystemSettingsService,
    private readonly workflowEventLog: WorkflowEventLogService,
  ) {}

  async mentionAgent(params: MentionAgentParams): Promise<MentionAgentResult> {
    const { mention, context } = await this.prepareMentionContext(params);
    const denialReason = await findMentionDenialReason(context, {
      agentProfileRepository: this.agentProfileRepository,
      agentCommunication: this.agentCommunication,
      systemSettings: this.systemSettings,
    });
    if (denialReason) {
      return this.buildMentionDeniedResult(
        mention.workflowRunId,
        mention.threadId,
        mention.correlationId,
        mention.requesterExecutionId,
        denialReason,
      );
    }

    const persistenceDependencies = this.getPersistenceDependencies();
    const normalizedContextId =
      mention.payloadContextId ?? context.scopeContextId ?? null;
    await upsertMentionThread(
      persistenceDependencies,
      context,
      normalizedContextId,
      context.scopeId,
    );
    await createMentionMessages(persistenceDependencies, context);
    return this.buildMentionAcceptedResult(mention);
  }

  async checkAgentMentions(
    params: CheckAgentMentionsParams,
  ): Promise<CheckAgentMentionsResult> {
    const workflowRunId = this.requireString(
      params.workflow_run_id,
      'workflow_run_id',
    );
    const requesterExecutionId = this.optionalString(
      params.requester_execution_id,
    );
    const threadId = this.optionalString(params.thread_id) ?? undefined;

    const threads = await this.agentCommunication.findByRunAndRequester(
      workflowRunId,
      requesterExecutionId,
      threadId,
    );
    const messages = await this.agentCommunication.findMessagesByThreadIds(
      threads.map((thread) => thread.thread_id),
    );

    const messageByThread = new Map<
      string,
      Awaited<
        ReturnType<IAgentCommunicationDomainPort['findMessagesByThreadIds']>
      >
    >();
    for (const message of messages) {
      const current = messageByThread.get(message.thread_id) ?? [];
      current.push(message);
      messageByThread.set(message.thread_id, current);
    }

    const summaries = threads.map((thread) =>
      toAgentMentionThreadSummary(
        thread,
        (messageByThread.get(thread.thread_id) ?? []).sort(
          (a, b) => a.created_at.getTime() - b.created_at.getTime(),
        ),
      ),
    );

    return {
      workflow_run_id: workflowRunId,
      requester_execution_id: requesterExecutionId,
      thread_count: summaries.length,
      threads: summaries,
    };
  }

  async resolveAgentThread(
    params: ResolveAgentThreadParams,
  ): Promise<ResolveAgentThreadResult> {
    const {
      workflowRunId,
      threadId,
      requesterExecutionId,
      resolverExecutionId,
      resolutionNote,
      correlationId,
      metadata,
    } = this.normalizeResolveParams(params);

    const thread = await this.agentCommunication.findByThreadId(threadId);
    if (!thread) {
      return buildResolveDeniedResult(
        workflowRunId,
        threadId,
        'thread_not_found',
      );
    }
    const denialReason = resolveThreadDenialReason(
      thread,
      workflowRunId,
      requesterExecutionId,
    );
    if (denialReason) {
      return buildResolveDeniedResult(workflowRunId, threadId, denialReason);
    }

    const persistenceDependencies = this.getPersistenceDependencies();
    await persistResolvedThread(persistenceDependencies, {
      thread,
      workflowRunId,
      threadId,
      requesterExecutionId,
      resolverExecutionId,
      resolutionNote,
      correlationId,
      metadata,
    });
    return this.buildResolvedResult(
      workflowRunId,
      threadId,
      requesterExecutionId,
      resolverExecutionId,
      resolutionNote,
    );
  }

  private normalizeMentionParams(
    params: MentionAgentParams,
  ): NormalizedMentionParams {
    return {
      workflowRunId: this.requireString(
        params.workflow_run_id,
        'workflow_run_id',
      ),
      targetAgentProfile: this.requireString(
        params.target_agent_profile,
        'target_agent_profile',
      ),
      body: this.requireString(params.message, 'message'),
      requesterExecutionId: this.optionalString(params.requester_execution_id),
      payloadContextId: this.optionalString(params.context_id),
      threadId: this.optionalString(params.thread_id) ?? randomUUID(),
      correlationId: this.optionalString(params.correlation_id) ?? randomUUID(),
      urgency: params.urgency === 'high' ? 'high' : 'normal',
      metadata: params.metadata ?? null,
    };
  }

  private async prepareMentionContext(params: MentionAgentParams): Promise<{
    mention: NormalizedMentionParams;
    context: MentionValidationContext;
  }> {
    const mention = this.normalizeMentionParams(params);
    const run = await this.workflowRunRepository.findById(
      mention.workflowRunId,
    );
    if (!run) {
      throw new BadRequestException(
        `workflow run ${mention.workflowRunId} not found`,
      );
    }

    const scope = resolveAgentMentionTriggerScope(run.state_variables);
    return {
      mention,
      context: {
        ...mention,
        scopeId: scope.scopeId,
        scopeContextId: scope.contextId,
        existingThread: null,
      },
    };
  }

  private normalizeResolveParams(params: ResolveAgentThreadParams): {
    workflowRunId: string;
    threadId: string;
    requesterExecutionId: string | null;
    resolverExecutionId: string | null;
    resolutionNote: string | null;
    correlationId: string;
    metadata: Record<string, unknown> | null;
  } {
    return {
      workflowRunId: this.requireString(
        params.workflow_run_id,
        'workflow_run_id',
      ),
      threadId: this.requireString(params.thread_id, 'thread_id'),
      requesterExecutionId: this.optionalString(params.requester_execution_id),
      resolverExecutionId: this.optionalString(params.resolver_execution_id),
      resolutionNote: this.optionalString(params.resolution_note),
      correlationId: this.optionalString(params.correlation_id) ?? randomUUID(),
      metadata: params.metadata ?? null,
    };
  }

  private getPersistenceDependencies(): {
    agentCommunication: IAgentCommunicationDomainPort;
  } {
    return {
      agentCommunication: this.agentCommunication,
    };
  }

  private async buildMentionAcceptedResult(
    mention: NormalizedMentionParams,
  ): Promise<MentionAgentResult> {
    const lifecycleEvents = buildMentionAcceptedLifecycleEvents(
      mention.threadId,
      mention.targetAgentProfile,
      mention.requesterExecutionId,
    );
    await this.appendLifecycleEvents(
      mention.workflowRunId,
      mention.requesterExecutionId,
      lifecycleEvents,
    );

    return {
      status: 'accepted',
      thread_id: mention.threadId,
      correlation_id: mention.correlationId,
      thread_status: 'open',
      lifecycle_events: lifecycleEvents,
    };
  }

  private async buildResolvedResult(
    workflowRunId: string,
    threadId: string,
    requesterExecutionId: string | null,
    resolverExecutionId: string | null,
    resolutionNote: string | null,
  ): Promise<ResolveAgentThreadResult> {
    const lifecycleEvents: AgentMentionLifecycleEvent[] = [
      {
        event_type: 'agent_thread_resolved',
        payload: {
          thread_id: threadId,
          resolution_note: resolutionNote ?? null,
          requester_execution_id: requesterExecutionId,
        },
      },
    ];
    await this.appendLifecycleEvents(
      workflowRunId,
      resolverExecutionId ?? requesterExecutionId,
      lifecycleEvents,
    );

    return {
      status: 'resolved',
      thread_id: threadId,
      workflow_run_id: workflowRunId,
      lifecycle_events: lifecycleEvents,
    };
  }

  private async buildMentionDeniedResult(
    workflowRunId: string,
    threadId: string,
    correlationId: string,
    requesterExecutionId: string | null,
    denialReason: string,
  ): Promise<MentionAgentResult> {
    const lifecycleEvents: AgentMentionLifecycleEvent[] = [
      {
        event_type: 'agent_mention_denied',
        payload: {
          thread_id: threadId,
          denial_reason: denialReason,
          requester_execution_id: requesterExecutionId,
        },
      },
    ];
    await this.appendLifecycleEvents(
      workflowRunId,
      requesterExecutionId,
      lifecycleEvents,
    );

    return {
      status: 'denied',
      thread_id: threadId,
      correlation_id: correlationId,
      thread_status: 'denied',
      denial_reason: denialReason,
      lifecycle_events: lifecycleEvents,
    };
  }

  private async appendLifecycleEvents(
    workflowRunId: string,
    actorId: string | null,
    events: AgentMentionLifecycleEvent[],
  ): Promise<void> {
    for (const event of events) {
      await this.workflowEventLog.appendBestEffort({
        workflowRunId,
        eventType: event.event_type,
        actorId: actorId ?? undefined,
        payload: event.payload,
      });
    }
  }

  private requireString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException(`${field} is required`);
    }

    return value.trim();
  }

  private optionalString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }
}
