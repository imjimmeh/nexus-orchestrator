import type { Logger } from '@nestjs/common';
import type { AgentCommunicationMeshService } from '../workflow/workflow-subagents/agent-communication-mesh.service';
import type {
  AuthenticatedSocket,
  CheckAgentMentionsGatewayPayload,
  GatewayWorkflowEvent,
  MentionAgentGatewayPayload,
  ResolveAgentThreadGatewayPayload,
} from './types';

type MeshServiceLike = Pick<
  AgentCommunicationMeshService,
  'mentionAgent' | 'checkAgentMentions' | 'resolveAgentThread'
>;

type ProcessAndBroadcastEvent = (
  workflowRunId: string,
  event: GatewayWorkflowEvent,
) => Promise<void>;

export async function handleMentionAgentCompat(params: {
  client: AuthenticatedSocket;
  payload: MentionAgentGatewayPayload;
  logger: Logger;
  meshService?: MeshServiceLike;
  processAndBroadcastEvent: ProcessAndBroadcastEvent;
}): Promise<void> {
  const { client, payload, logger, meshService, processAndBroadcastEvent } =
    params;

  if (client.role !== 'agent' || !client.workflowRunId) {
    return;
  }
  if (!meshService) {
    logger.warn(
      'mention_agent: missing required service injection — mention skipped',
    );
    return;
  }

  try {
    const result = await meshService.mentionAgent({
      workflow_run_id: client.workflowRunId,
      requester_execution_id: client.stepId,
      target_agent_profile: payload.target_agent_profile,
      message: payload.message,
      context_id: payload.context_id,
      urgency: payload.urgency,
      thread_id: payload.thread_id,
      correlation_id: payload.correlation_id,
      metadata: payload.context_files
        ? {
            context_files: payload.context_files,
          }
        : undefined,
    });

    client.emit('mention_agent_result', result);

    for (const lifecycleEvent of result.lifecycle_events ?? []) {
      await processAndBroadcastEvent(client.workflowRunId, {
        event_type: lifecycleEvent.event_type,
        payload: lifecycleEvent.payload,
      });
    }
  } catch (error) {
    client.emit('mention_agent_error', {
      message: (error as Error).message,
    });
  }
}

export async function handleCheckAgentMentionsCompat(params: {
  client: AuthenticatedSocket;
  payload: CheckAgentMentionsGatewayPayload;
  logger: Logger;
  meshService?: MeshServiceLike;
}): Promise<void> {
  const { client, payload, logger, meshService } = params;

  if (client.role !== 'agent' || !client.workflowRunId) {
    return;
  }
  if (!meshService) {
    logger.warn(
      'check_agent_mentions: missing required service injection — mention check skipped',
    );
    return;
  }

  try {
    const result = await meshService.checkAgentMentions({
      workflow_run_id: client.workflowRunId,
      requester_execution_id: client.stepId,
      thread_id: payload.thread_id,
    });

    client.emit('check_agent_mentions_result', result);
  } catch (error) {
    client.emit('check_agent_mentions_error', {
      message: (error as Error).message,
    });
  }
}

export async function handleResolveAgentThreadCompat(params: {
  client: AuthenticatedSocket;
  payload: ResolveAgentThreadGatewayPayload;
  logger: Logger;
  meshService?: MeshServiceLike;
  processAndBroadcastEvent: ProcessAndBroadcastEvent;
}): Promise<void> {
  const { client, payload, logger, meshService, processAndBroadcastEvent } =
    params;

  if (client.role !== 'agent' || !client.workflowRunId) {
    return;
  }
  if (!meshService) {
    logger.warn(
      'resolve_agent_thread: missing required service injection — thread resolution skipped',
    );
    return;
  }

  try {
    const result = await meshService.resolveAgentThread({
      workflow_run_id: client.workflowRunId,
      thread_id: payload.thread_id,
      requester_execution_id: client.stepId,
      resolver_execution_id: client.stepId,
      resolution_note: payload.resolution_note,
    });

    client.emit('resolve_agent_thread_result', result);

    for (const lifecycleEvent of result.lifecycle_events ?? []) {
      await processAndBroadcastEvent(client.workflowRunId, {
        event_type: lifecycleEvent.event_type,
        payload: lifecycleEvent.payload,
      });
    }
  } catch (error) {
    client.emit('resolve_agent_thread_error', {
      message: (error as Error).message,
    });
  }
}
