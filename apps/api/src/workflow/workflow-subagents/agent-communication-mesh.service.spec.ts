import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentCommunicationMeshService } from './agent-communication-mesh.service';

describe('AgentCommunicationMeshService', () => {
  const workflowRunRepository = {
    findById: vi.fn(),
  };
  const agentProfileRepository = {
    findByNameInsensitive: vi.fn(),
  };
  const agentCommunication = {
    upsertMentionThread: vi.fn(),
    createMentionMessages: vi.fn(),
    persistResolvedThread: vi.fn(),
    findByRunAndRequester: vi.fn(),
    findByThreadId: vi.fn(),
    countByRunAndKind: vi.fn(),
    countByThreadId: vi.fn(),
    updateByThreadId: vi.fn(),
    findMessagesByThreadIds: vi.fn(),
  };
  const systemSettings = {
    get: vi.fn(),
  };
  const workflowEventLog = {
    appendBestEffort: vi.fn(),
  };

  const createService = () =>
    new AgentCommunicationMeshService(
      workflowRunRepository as never,
      agentProfileRepository as never,
      agentCommunication,
      systemSettings as never,
      workflowEventLog as never,
    );

  beforeEach(() => {
    vi.clearAllMocks();

    workflowRunRepository.findById.mockResolvedValue({
      id: 'run-1',
      state_variables: {
        trigger: {
          scopeId: 'project-1',
          contextId: 'resource-1',
        },
      },
    });
    agentProfileRepository.findByNameInsensitive.mockResolvedValue({
      id: 'profile-1',
      name: 'reviewer-agent',
      is_active: true,
    });
    agentCommunication.upsertMentionThread.mockResolvedValue(undefined);
    agentCommunication.createMentionMessages.mockResolvedValue(undefined);
    agentCommunication.persistResolvedThread.mockResolvedValue(undefined);
    agentCommunication.findByThreadId.mockResolvedValue(null);
    agentCommunication.findByRunAndRequester.mockResolvedValue([]);
    agentCommunication.countByRunAndKind.mockResolvedValue(0);
    agentCommunication.countByThreadId.mockResolvedValue(0);
    agentCommunication.findMessagesByThreadIds.mockResolvedValue([]);
    agentCommunication.updateByThreadId.mockResolvedValue(null);
    systemSettings.get.mockImplementation(
      async (key: string, fallback: unknown) => {
        if (key === 'agent_mesh_max_message_chars') {
          return 4000;
        }
        if (key === 'agent_mesh_max_mentions_per_run') {
          return 50;
        }
        if (key === 'agent_mesh_policy_matrix') {
          return {};
        }
        if (key === 'agent_mesh_max_messages_per_thread') {
          return 100;
        }
        return fallback;
      },
    );
    workflowEventLog.appendBestEffort.mockResolvedValue(undefined);
  });

  it('accepts mentionAgent when trigger scope/profile/limits are valid and updates thread/messages/events', async () => {
    // Simulate existing-thread branch by returning the thread from the lookup.
    agentCommunication.findByThreadId.mockResolvedValue({
      id: 'row-thread-1',
      thread_id: 'thread-1',
      workflow_run_id: 'run-1',
      scopeId: 'project-1',
      contextId: 'resource-1',
      requester_execution_id: 'exec-1',
      target_agent_profile: 'reviewer-agent',
      urgency: 'normal',
      status: 'open',
      message_count: 3,
      correlation_id: 'corr-1',
      resolution_note: null,
      metadata: { source: 'unit-test' },
      last_message_at: new Date(),
      resolved_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const service = createService();
    const result = await service.mentionAgent({
      workflow_run_id: 'run-1',
      requester_execution_id: 'exec-1',
      target_agent_profile: 'reviewer-agent',
      message: 'please review this change',
      thread_id: 'thread-1',
      correlation_id: 'corr-1',
      context_id: 'resource-1',
      metadata: { source: 'unit-test' },
    });

    expect(result).toEqual({
      status: 'accepted',
      thread_id: 'thread-1',
      correlation_id: 'corr-1',
      thread_status: 'open',
      lifecycle_events: [
        {
          event_type: 'agent_mention_requested',
          payload: {
            thread_id: 'thread-1',
            target_agent_profile: 'reviewer-agent',
            requester_execution_id: 'exec-1',
          },
        },
        {
          event_type: 'agent_mention_received',
          payload: {
            thread_id: 'thread-1',
            target_agent_profile: 'reviewer-agent',
          },
        },
      ],
    });
    expect(agentCommunication.upsertMentionThread).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-1',
        workflowRunId: 'run-1',
        requesterExecutionId: 'exec-1',
        targetAgentProfile: 'reviewer-agent',
        urgency: 'normal',
        correlationId: 'corr-1',
        metadata: { source: 'unit-test' },
        existingThread: expect.objectContaining({ message_count: 3 }),
        body: 'please review this change',
      }),
      'resource-1',
      'project-1',
    );
    expect(agentCommunication.createMentionMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-1',
        workflowRunId: 'run-1',
        targetAgentProfile: 'reviewer-agent',
      }),
    );
    expect(workflowEventLog.appendBestEffort).toHaveBeenNthCalledWith(1, {
      workflowRunId: 'run-1',
      eventType: 'agent_mention_requested',
      actorId: 'exec-1',
      payload: {
        thread_id: 'thread-1',
        target_agent_profile: 'reviewer-agent',
        requester_execution_id: 'exec-1',
      },
    });
    expect(workflowEventLog.appendBestEffort).toHaveBeenNthCalledWith(2, {
      workflowRunId: 'run-1',
      eventType: 'agent_mention_received',
      actorId: 'exec-1',
      payload: {
        thread_id: 'thread-1',
        target_agent_profile: 'reviewer-agent',
      },
    });
  });

  it('accepts mentionAgent when payload context differs from trigger context', async () => {
    const service = createService();
    const result = await service.mentionAgent({
      workflow_run_id: 'run-1',
      requester_execution_id: 'exec-1',
      target_agent_profile: 'reviewer-agent',
      message: 'please review this change',
      thread_id: 'thread-scope',
      correlation_id: 'corr-scope',
      context_id: 'resource-2',
    });

    expect(result).toEqual({
      status: 'accepted',
      thread_id: 'thread-scope',
      correlation_id: 'corr-scope',
      thread_status: 'open',
      lifecycle_events: [
        {
          event_type: 'agent_mention_requested',
          payload: {
            thread_id: 'thread-scope',
            target_agent_profile: 'reviewer-agent',
            requester_execution_id: 'exec-1',
          },
        },
        {
          event_type: 'agent_mention_received',
          payload: {
            thread_id: 'thread-scope',
            target_agent_profile: 'reviewer-agent',
          },
        },
      ],
    });
    expect(agentCommunication.upsertMentionThread).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-scope',
        workflowRunId: 'run-1',
        scopeId: 'project-1',
        contextId: 'resource-2',
        existingThread: null,
      }),
      'resource-2',
      'project-1',
    );
    expect(workflowEventLog.appendBestEffort).toHaveBeenNthCalledWith(1, {
      workflowRunId: 'run-1',
      eventType: 'agent_mention_requested',
      actorId: 'exec-1',
      payload: {
        thread_id: 'thread-scope',
        target_agent_profile: 'reviewer-agent',
        requester_execution_id: 'exec-1',
      },
    });
  });

  it('accepts mentionAgent when trigger scope is unavailable and persists null scope', async () => {
    workflowRunRepository.findById.mockResolvedValue({
      id: 'run-1',
      state_variables: {},
    });

    const service = createService();
    const result = await service.mentionAgent({
      workflow_run_id: 'run-1',
      requester_execution_id: 'exec-1',
      target_agent_profile: 'reviewer-agent',
      message: 'please review this change',
      thread_id: 'thread-no-scope',
      correlation_id: 'corr-no-scope',
    });

    expect(result.status).toBe('accepted');
    expect(agentCommunication.upsertMentionThread).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-no-scope',
        scopeId: null,
        contextId: null,
      }),
      null,
      null,
    );
  });

  it('denies mentionAgent when max mentions per run is exceeded', async () => {
    agentCommunication.countByRunAndKind.mockResolvedValue(2);
    systemSettings.get.mockImplementation(async (key: string) => {
      if (key === 'agent_mesh_max_message_chars') {
        return 4000;
      }
      if (key === 'agent_mesh_max_mentions_per_run') {
        return 2;
      }
      if (key === 'agent_mesh_policy_matrix') {
        return {};
      }
      if (key === 'agent_mesh_max_messages_per_thread') {
        return 100;
      }
      return undefined;
    });

    const service = createService();
    const result = await service.mentionAgent({
      workflow_run_id: 'run-1',
      requester_execution_id: 'exec-1',
      target_agent_profile: 'reviewer-agent',
      message: 'please review this change',
      thread_id: 'thread-limit',
      correlation_id: 'corr-limit',
    });

    expect(result.status).toBe('denied');
    expect(result.denial_reason).toBe('mention_rate_limit_exceeded_for_run');
    expect(agentCommunication.upsertMentionThread).not.toHaveBeenCalled();
    expect(agentCommunication.createMentionMessages).not.toHaveBeenCalled();
    expect(workflowEventLog.appendBestEffort).toHaveBeenCalledWith({
      workflowRunId: 'run-1',
      eventType: 'agent_mention_denied',
      actorId: 'exec-1',
      payload: {
        thread_id: 'thread-limit',
        denial_reason: 'mention_rate_limit_exceeded_for_run',
        requester_execution_id: 'exec-1',
      },
    });
  });

  it('returns grouped thread summaries with message ordering in checkAgentMentions', async () => {
    const t1Created = new Date('2026-01-01T00:00:00.000Z');
    const t2Created = new Date('2026-01-01T00:05:00.000Z');
    agentCommunication.findByRunAndRequester.mockResolvedValue([
      {
        id: 'thread-row-1',
        thread_id: 'thread-a',
        workflow_run_id: 'run-1',
        scopeId: 'project-1',
        contextId: 'resource-1',
        requester_execution_id: 'exec-1',
        target_agent_profile: 'reviewer-agent',
        urgency: 'normal',
        status: 'open',
        message_count: 2,
        correlation_id: 'corr-a',
        resolution_note: null,
        metadata: null,
        last_message_at: t1Created,
        resolved_at: null,
        created_at: t1Created,
        updated_at: t1Created,
      },
      {
        id: 'thread-row-2',
        thread_id: 'thread-b',
        workflow_run_id: 'run-1',
        scopeId: 'project-1',
        contextId: null,
        requester_execution_id: 'exec-1',
        target_agent_profile: 'architect-agent',
        urgency: 'high',
        status: 'resolved',
        message_count: 1,
        correlation_id: 'corr-b',
        resolution_note: 'done',
        metadata: { lane: 'urgent' },
        last_message_at: t2Created,
        resolved_at: t2Created,
        created_at: t2Created,
        updated_at: t2Created,
      },
    ]);
    agentCommunication.findMessagesByThreadIds.mockResolvedValue([
      {
        id: 'm2',
        thread_id: 'thread-a',
        workflow_run_id: 'run-1',
        sender_execution_id: 'exec-1',
        recipient_profile: 'reviewer-agent',
        message_kind: 'system',
        body: 'second',
        correlation_id: 'corr-a',
        metadata: null,
        created_at: new Date('2026-01-01T00:00:02.000Z'),
      },
      {
        id: 'm1',
        thread_id: 'thread-a',
        workflow_run_id: 'run-1',
        sender_execution_id: 'exec-1',
        recipient_profile: 'reviewer-agent',
        message_kind: 'request',
        body: 'first',
        correlation_id: 'corr-a',
        metadata: null,
        created_at: new Date('2026-01-01T00:00:01.000Z'),
      },
      {
        id: 'm3',
        thread_id: 'thread-b',
        workflow_run_id: 'run-1',
        sender_execution_id: null,
        recipient_profile: 'architect-agent',
        message_kind: 'system',
        body: 'resolved',
        correlation_id: 'corr-b',
        metadata: { note: 'ok' },
        created_at: new Date('2026-01-01T00:05:01.000Z'),
      },
    ]);

    const service = createService();
    const result = await service.checkAgentMentions({
      workflow_run_id: 'run-1',
      requester_execution_id: 'exec-1',
    });

    expect(result.thread_count).toBe(2);
    expect(result.threads.map((thread) => thread.thread_id)).toEqual([
      'thread-a',
      'thread-b',
    ]);
    expect(result.threads[0].messages.map((message) => message.id)).toEqual([
      'm1',
      'm2',
    ]);
    expect(result.threads[1].messages.map((message) => message.id)).toEqual([
      'm3',
    ]);
    expect(agentCommunication.findMessagesByThreadIds).toHaveBeenCalledWith([
      'thread-a',
      'thread-b',
    ]);
  });

  it('resolves resolveAgentThread and appends system message + lifecycle event', async () => {
    agentCommunication.findByThreadId.mockResolvedValue({
      id: 'thread-row-1',
      thread_id: 'thread-resolve',
      workflow_run_id: 'run-1',
      requester_execution_id: 'exec-1',
      target_agent_profile: 'reviewer-agent',
      urgency: 'normal',
      status: 'open',
      message_count: 4,
      correlation_id: 'corr-resolve',
      resolution_note: null,
      metadata: null,
      last_message_at: new Date(),
      resolved_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const service = createService();
    const result = await service.resolveAgentThread({
      workflow_run_id: 'run-1',
      thread_id: 'thread-resolve',
      requester_execution_id: 'exec-1',
      resolver_execution_id: 'exec-2',
      resolution_note: 'All done',
      correlation_id: 'corr-resolve',
      metadata: { closedBy: 'exec-2' },
    });

    expect(result).toEqual({
      status: 'resolved',
      thread_id: 'thread-resolve',
      workflow_run_id: 'run-1',
      lifecycle_events: [
        {
          event_type: 'agent_thread_resolved',
          payload: {
            thread_id: 'thread-resolve',
            resolution_note: 'All done',
            requester_execution_id: 'exec-1',
          },
        },
      ],
    });
    expect(agentCommunication.persistResolvedThread).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-resolve',
        workflowRunId: 'run-1',
        requesterExecutionId: 'exec-1',
        resolverExecutionId: 'exec-2',
        resolutionNote: 'All done',
        correlationId: 'corr-resolve',
        metadata: { closedBy: 'exec-2' },
      }),
    );
    expect(workflowEventLog.appendBestEffort).toHaveBeenCalledWith({
      workflowRunId: 'run-1',
      eventType: 'agent_thread_resolved',
      actorId: 'exec-2',
      payload: {
        thread_id: 'thread-resolve',
        resolution_note: 'All done',
        requester_execution_id: 'exec-1',
      },
    });
  });

  it('denies resolveAgentThread when requester execution id does not match', async () => {
    agentCommunication.findByThreadId.mockResolvedValue({
      id: 'thread-row-1',
      thread_id: 'thread-resolve',
      workflow_run_id: 'run-1',
      requester_execution_id: 'exec-allowed',
      target_agent_profile: 'reviewer-agent',
      urgency: 'normal',
      status: 'open',
      message_count: 4,
      correlation_id: 'corr-denied',
      resolution_note: null,
      metadata: null,
      last_message_at: new Date(),
      resolved_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const service = createService();
    const result = await service.resolveAgentThread({
      workflow_run_id: 'run-1',
      thread_id: 'thread-resolve',
      requester_execution_id: 'exec-denied',
      correlation_id: 'corr-denied',
    });

    expect(result).toEqual({
      status: 'denied',
      thread_id: 'thread-resolve',
      workflow_run_id: 'run-1',
      denial_reason: 'requester_execution_id_mismatch',
      lifecycle_events: [],
    });
    expect(agentCommunication.persistResolvedThread).not.toHaveBeenCalled();
    expect(workflowEventLog.appendBestEffort).not.toHaveBeenCalled();
  });
});
