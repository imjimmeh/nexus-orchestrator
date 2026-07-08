import { describe, expect, it, vi } from 'vitest';
import { ChatMessagesService } from './chat-messages.service';

function buildServiceContext() {
  const chatSessions = {
    findById: vi.fn(),
    update: vi.fn(),
  };
  const chatMessages = {
    findByProviderMessage: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findBySessionId: vi.fn(),
    findPendingRunLinks: vi.fn(),
  };
  const chatActions = {
    requestAction: vi.fn(),
    continueWorkflowRunWithMessage: vi.fn(),
    getWorkflowRunStatus: vi.fn(),
    getWorkflowRunEvents: vi.fn(),
    submitWorkflowRunQuestionAnswers: vi.fn(),
  };
  const memoryLifecycle = {
    buildActionContext: vi.fn(),
    recordInboundMessage: vi.fn(),
    recordOutboundMessage: vi.fn(),
  };
  const telemetryGateway = {
    sendQuestionResponseCommand: vi.fn().mockResolvedValue(undefined),
    hasActiveAgentSocket: vi.fn().mockReturnValue(false),
  };
  const attachmentsService = {
    link: vi.fn().mockResolvedValue(undefined),
  };

  const service = new ChatMessagesService(
    chatSessions as never,
    chatMessages as never,
    chatActions as never,
    memoryLifecycle as never,
    telemetryGateway as never,
    attachmentsService as never,
  );

  chatMessages.findPendingRunLinks.mockResolvedValue([]);

  return {
    service,
    chatSessions,
    chatMessages,
    chatActions,
    memoryLifecycle,
    telemetryGateway,
    attachmentsService,
  };
}

describe('ChatMessagesService', () => {
  it('persists inbound messages and stores run linkage', async () => {
    const {
      service,
      chatSessions,
      chatMessages,
      chatActions,
      memoryLifecycle,
    } = buildServiceContext();

    chatSessions.findById.mockResolvedValue({
      id: 'chat-1',
      scope_id: 'project-1',
      agent_profile_id: 'profile-1',
      agent_profile_name: 'ceo-agent',
    });
    chatMessages.findByProviderMessage.mockResolvedValue(null);
    chatMessages.create.mockResolvedValue({
      id: 'msg-1',
      run_id: null,
      run_status: null,
      metadata: null,
    });
    memoryLifecycle.recordInboundMessage.mockResolvedValue(undefined);
    memoryLifecycle.buildActionContext.mockResolvedValue({
      retrieval: {
        retrievalId: 'ret-1',
        requestedAt: '2026-04-13T00:00:00.000Z',
        tokenBudget: 600,
        hitCount: 1,
        sessionHitCount: 1,
        profileHitCount: 0,
        consumedCharacters: 22,
      },
      slices: [
        {
          memoryId: 'mem-1',
          source: 'session',
          memoryType: 'history',
          content: 'previous context',
          score: 0.88,
          createdAt: '2026-04-13T00:00:00.000Z',
        },
      ],
    });
    chatActions.requestAction.mockResolvedValue({
      runId: 'run-1',
      workflowId: 'workflow-chat-default',
      runStatus: 'PENDING',
      correlationId: 'corr-1',
    });
    chatMessages.update.mockResolvedValue({
      id: 'msg-1',
      run_id: 'run-1',
      run_status: 'PENDING',
      metadata: {
        memory: {
          retrievalId: 'ret-1',
          hitCount: 1,
          sessionHitCount: 1,
          profileHitCount: 0,
          tokenBudget: 600,
          sliceIds: ['mem-1'],
        },
      },
    });

    const result = await service.sendChatMessage('chat-1', 'hello', {
      channel: 'telegram',
      providerMessageId: '55',
      externalUserId: 'tg-user-1',
      metadata: { locale: 'en' },
    });

    expect(chatMessages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        chat_session_id: 'chat-1',
        channel: 'telegram',
        provider_message_id: '55',
        event_type: 'user_message',
      }),
    );
    const firstActionCall = chatActions.requestAction.mock.calls[0];
    expect(firstActionCall).toBeDefined();
    const dispatchedPayload = firstActionCall[0] as unknown;
    expect(isRecord(dispatchedPayload)).toBe(true);

    if (!isRecord(dispatchedPayload)) {
      throw new Error('Expected chat action request payload object');
    }

    expect(dispatchedPayload.chatSessionId).toBe('chat-1');
    expect(dispatchedPayload.messageId).toBe('msg-1');
    expect(dispatchedPayload.channel).toBe('telegram');
    expect(isRecord(dispatchedPayload.memoryContext)).toBe(true);

    if (!isRecord(dispatchedPayload.memoryContext)) {
      throw new Error('Expected chat action request memory context');
    }

    expect(dispatchedPayload.memoryContext.retrievalId).toBe('ret-1');
    expect(dispatchedPayload.memoryContext.hitCount).toBe(1);
    expect(memoryLifecycle.recordInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatSessionId: 'chat-1',
        profileId: 'profile-1',
      }),
    );
    expect(chatSessions.update).toHaveBeenCalledWith('chat-1', {
      workflow_run_id: 'run-1',
    });
    expect(result).toEqual({
      acknowledged: true,
      messageId: 'msg-1',
      runId: 'run-1',
      runStatus: 'PENDING',
    });
  });

  it('continues the existing workflow run for follow-up messages', async () => {
    const {
      service,
      chatSessions,
      chatMessages,
      chatActions,
      memoryLifecycle,
    } = buildServiceContext();

    chatSessions.findById.mockResolvedValue({
      id: 'chat-1',
      scope_id: 'project-1',
      agent_profile_id: 'profile-1',
      agent_profile_name: 'ceo-agent',
      workflow_run_id: 'run-existing-1',
    });
    chatMessages.findByProviderMessage.mockResolvedValue(null);
    chatMessages.create.mockResolvedValue({
      id: 'msg-follow-1',
      run_id: null,
      run_status: null,
      metadata: null,
    });
    memoryLifecycle.recordInboundMessage.mockResolvedValue(undefined);
    memoryLifecycle.buildActionContext.mockResolvedValue(null);
    chatActions.continueWorkflowRunWithMessage.mockResolvedValue({
      runId: 'run-existing-1',
      workflowId: 'workflow-chat-default',
      runStatus: 'RUNNING',
      correlationId: 'corr-follow-1',
    });
    chatMessages.update.mockResolvedValue({
      id: 'msg-follow-1',
      run_id: 'run-existing-1',
      run_status: 'RUNNING',
      metadata: null,
    });
    chatSessions.update.mockResolvedValue({
      id: 'chat-1',
      workflow_run_id: 'run-existing-1',
    });

    const result = await service.sendChatMessage('chat-1', 'follow-up', {
      channel: 'telegram',
      providerMessageId: '65',
      correlationId: 'telegram:65',
      externalUserId: 'tg-user-1',
    });

    expect(chatActions.continueWorkflowRunWithMessage).toHaveBeenCalledWith({
      runId: 'run-existing-1',
      message: 'follow-up',
      correlationId: 'telegram:65',
    });
    expect(chatActions.requestAction).not.toHaveBeenCalled();
    expect(chatSessions.update).toHaveBeenCalledWith('chat-1', {
      workflow_run_id: 'run-existing-1',
    });
    expect(result).toEqual({
      acknowledged: true,
      messageId: 'msg-follow-1',
      runId: 'run-existing-1',
      runStatus: 'RUNNING',
    });
  });

  it('falls back to a new run when continuation fails', async () => {
    const {
      service,
      chatSessions,
      chatMessages,
      chatActions,
      memoryLifecycle,
    } = buildServiceContext();

    chatSessions.findById.mockResolvedValue({
      id: 'chat-1',
      scope_id: 'project-1',
      agent_profile_id: 'profile-1',
      agent_profile_name: 'ceo-agent',
      workflow_run_id: 'run-stale-1',
    });
    chatMessages.findByProviderMessage.mockResolvedValue(null);
    chatMessages.create.mockResolvedValue({
      id: 'msg-fallback-1',
      run_id: null,
      run_status: null,
      metadata: null,
    });
    memoryLifecycle.recordInboundMessage.mockResolvedValue(undefined);
    memoryLifecycle.buildActionContext.mockResolvedValue(null);
    chatActions.continueWorkflowRunWithMessage.mockRejectedValue(
      new Error('run not found'),
    );
    chatActions.requestAction.mockResolvedValue({
      runId: 'run-new-1',
      workflowId: 'workflow-chat-default',
      runStatus: 'PENDING',
      correlationId: 'corr-new-1',
    });
    chatMessages.update.mockResolvedValue({
      id: 'msg-fallback-1',
      run_id: 'run-new-1',
      run_status: 'PENDING',
      metadata: null,
    });
    chatSessions.update.mockResolvedValue({
      id: 'chat-1',
      workflow_run_id: 'run-new-1',
    });

    const result = await service.sendChatMessage('chat-1', 'fresh prompt', {
      channel: 'telegram',
      providerMessageId: '66',
      externalUserId: 'tg-user-1',
    });

    expect(chatActions.continueWorkflowRunWithMessage).toHaveBeenCalledWith({
      runId: 'run-stale-1',
      message: 'fresh prompt',
      correlationId: null,
    });
    expect(chatActions.requestAction).toHaveBeenCalledOnce();
    expect(chatSessions.update).toHaveBeenCalledWith('chat-1', {
      workflow_run_id: 'run-new-1',
    });
    expect(result).toEqual({
      acknowledged: true,
      messageId: 'msg-fallback-1',
      runId: 'run-new-1',
      runStatus: 'PENDING',
    });
  });

  it('forwards chat replies to pending workflow questions', async () => {
    const {
      service,
      chatSessions,
      chatMessages,
      chatActions,
      memoryLifecycle,
    } = buildServiceContext();

    chatSessions.findById.mockResolvedValue({
      id: 'chat-1',
      scope_id: null,
      agent_profile_id: 'profile-1',
      agent_profile_name: 'ceo-agent',
    });
    chatMessages.findByProviderMessage.mockResolvedValue(null);
    chatMessages.findPendingRunLinks.mockResolvedValue([
      {
        id: 'pending-1',
        run_id: 'run-pending-1',
        run_status: 'RUNNING',
        correlation_id: 'corr-pending-1',
      },
    ]);
    chatMessages.create.mockResolvedValue({
      id: 'msg-qa-1',
      run_id: null,
      run_status: null,
      metadata: null,
    });
    chatActions.getWorkflowRunStatus.mockResolvedValue({
      runId: 'run-pending-1',
      workflowId: 'workflow-chat-default',
      status: 'RUNNING',
      updatedAt: '2026-04-14T14:23:20.000Z',
      metadata: {
        correlationId: 'corr-pending-1',
      },
    });
    chatActions.getWorkflowRunEvents.mockResolvedValue([
      {
        event_type: 'tool_execution_start',
        timestamp: '2026-04-14T14:23:18.947Z',
        payload: {
          toolName: 'ask_user_questions',
          args: {
            questions: [
              {
                question: 'How should I proceed?',
                options: ['Check workspace', 'Review projects'],
              },
            ],
          },
          toolCallId: 'call-1',
        },
      },
    ]);
    chatActions.submitWorkflowRunQuestionAnswers.mockResolvedValue(undefined);
    chatMessages.update.mockResolvedValue({
      id: 'msg-qa-1',
      run_id: 'run-pending-1',
      run_status: 'RUNNING',
      metadata: {
        questionAnswerForRunId: 'run-pending-1',
      },
    });
    memoryLifecycle.recordInboundMessage.mockResolvedValue(undefined);

    const result = await service.sendChatMessage('chat-1', 'Check workspace', {
      channel: 'api',
      providerMessageId: '56',
      correlationId: 'api:56',
      metadata: { locale: 'en' },
    });

    expect(chatActions.submitWorkflowRunQuestionAnswers).toHaveBeenCalledWith(
      'run-pending-1',
      'corr-pending-1',
      [
        {
          questionIndex: 0,
          selectedOption: 'Check workspace',
          freeTextAnswer: null,
        },
      ],
    );
    expect(chatActions.requestAction).not.toHaveBeenCalled();
    expect(memoryLifecycle.buildActionContext).not.toHaveBeenCalled();
    expect(chatMessages.update).toHaveBeenCalledWith(
      'msg-qa-1',
      expect.objectContaining({
        event_type: 'user_question_answers',
        run_id: 'run-pending-1',
        run_status: 'RUNNING',
      }),
    );
    expect(result).toEqual({
      acknowledged: true,
      messageId: 'msg-qa-1',
      runId: 'run-pending-1',
      runStatus: 'RUNNING',
    });
  });

  it('forwards submitted question card answers to the pending workflow run', async () => {
    const { service, chatSessions, chatMessages, chatActions } =
      buildServiceContext();

    chatSessions.findById.mockResolvedValue({
      id: 'chat-1',
      scope_id: null,
      agent_profile_id: 'profile-1',
      agent_profile_name: 'ceo-agent',
    });
    chatMessages.create.mockResolvedValue({
      id: 'msg-answer-1',
      run_id: null,
      run_status: null,
      metadata: null,
    });
    chatMessages.findPendingRunLinks.mockResolvedValue([
      {
        id: 'pending-2',
        run_id: 'run-pending-2',
        run_status: 'RUNNING',
        correlation_id: 'corr-pending-2',
      },
    ]);
    chatActions.getWorkflowRunStatus.mockResolvedValue({
      runId: 'run-pending-2',
      workflowId: 'workflow-chat-default',
      status: 'RUNNING',
      updatedAt: '2026-04-14T14:23:20.000Z',
      metadata: {
        correlationId: 'corr-pending-2',
      },
    });
    chatActions.getWorkflowRunEvents.mockResolvedValue([
      {
        event_type: 'user_questions_posed',
        timestamp: '2026-04-14T14:23:18.947Z',
        payload: {
          questions: [
            {
              question: 'How should I proceed?',
              options: ['Check workspace', 'Review projects'],
            },
          ],
        },
      },
    ]);
    chatActions.submitWorkflowRunQuestionAnswers.mockResolvedValue(undefined);
    chatMessages.update.mockResolvedValue({
      id: 'msg-answer-1',
      run_id: 'run-pending-2',
      run_status: 'RUNNING',
      metadata: {
        questionAnswerForRunId: 'run-pending-2',
      },
    });
    chatSessions.update.mockResolvedValue({
      id: 'chat-1',
      workflow_run_id: 'run-pending-2',
    });

    const result = await service.submitQuestionAnswers('chat-1', [
      {
        questionIndex: 0,
        selectedOption: 'Check workspace',
        freeTextAnswer: null,
      },
    ]);

    expect(chatActions.submitWorkflowRunQuestionAnswers).toHaveBeenCalledWith(
      'run-pending-2',
      'corr-pending-2',
      [
        {
          questionIndex: 0,
          selectedOption: 'Check workspace',
          freeTextAnswer: null,
        },
      ],
    );
    expect(chatSessions.update).toHaveBeenCalledWith('chat-1', {
      workflow_run_id: 'run-pending-2',
    });
    expect(chatMessages.update).toHaveBeenCalledWith(
      'msg-answer-1',
      expect.objectContaining({
        run_id: 'run-pending-2',
        run_status: 'RUNNING',
      }),
    );
    expect(result).toEqual({ acknowledged: true });
  });

  it('routes question answers via WebSocket for ad-hoc sessions without workflow run', async () => {
    const {
      service,
      chatSessions,
      chatMessages,
      chatActions,
      telemetryGateway,
    } = buildServiceContext();

    chatSessions.findById.mockResolvedValue({
      id: 'chat-adhoc',
      scope_id: null,
      agent_profile_id: 'profile-1',
      agent_profile_name: 'ceo-agent',
    });
    chatMessages.create.mockResolvedValue({
      id: 'msg-ws-1',
      run_id: null,
      run_status: null,
      metadata: null,
    });
    // No messages with run_id → findPendingQuestionRun returns null
    chatMessages.findPendingRunLinks.mockResolvedValue([]);

    const result = await service.submitQuestionAnswers('chat-adhoc', [
      {
        questionIndex: 0,
        selectedOption: 'React/Next.js',
        freeTextAnswer: null,
      },
    ]);

    expect(chatActions.submitWorkflowRunQuestionAnswers).not.toHaveBeenCalled();
    expect(telemetryGateway.sendQuestionResponseCommand).toHaveBeenCalledWith(
      'chat-adhoc',
      'chat-adhoc',
      [
        {
          questionIndex: 0,
          selectedOption: 'React/Next.js',
          freeTextAnswer: null,
        },
      ],
    );
    expect(chatMessages.update).toHaveBeenCalledWith(
      'msg-ws-1',
      expect.objectContaining({
        metadata: expect.objectContaining({
          questionAnswerForwardedViaChatSocket: true,
        }),
      }),
    );
    expect(result).toEqual({ acknowledged: true });
  });

  it('returns acknowledged even if WebSocket delivery fails for ad-hoc session', async () => {
    const { service, chatSessions, chatMessages, telemetryGateway } =
      buildServiceContext();

    chatSessions.findById.mockResolvedValue({
      id: 'chat-adhoc',
      scope_id: null,
      agent_profile_id: 'profile-1',
      agent_profile_name: 'ceo-agent',
    });
    chatMessages.create.mockResolvedValue({
      id: 'msg-ws-2',
      run_id: null,
      run_status: null,
      metadata: null,
    });
    chatMessages.findPendingRunLinks.mockResolvedValue([]);
    telemetryGateway.sendQuestionResponseCommand.mockRejectedValue(
      new Error('No active agent socket'),
    );

    const result = await service.submitQuestionAnswers('chat-adhoc', [
      { questionIndex: 0, selectedOption: 'Yes', freeTextAnswer: null },
    ]);

    expect(result).toEqual({ acknowledged: true });
  });

  it('routes text messages as question answers via WebSocket for ad-hoc sessions with active container', async () => {
    const {
      service,
      chatSessions,
      chatMessages,
      chatActions,
      telemetryGateway,
    } = buildServiceContext();

    chatSessions.findById.mockResolvedValue({
      id: 'chat-adhoc',
      scope_id: null,
      agent_profile_id: 'profile-1',
      agent_profile_name: 'ceo-agent',
      container_id: 'container-abc',
      workflow_run_id: null,
    });
    chatMessages.findByProviderMessage.mockResolvedValue(null);
    chatMessages.create.mockResolvedValue({
      id: 'msg-text-1',
      run_id: null,
      run_status: null,
      metadata: null,
    });
    chatMessages.findPendingRunLinks.mockResolvedValue([]);
    telemetryGateway.hasActiveAgentSocket.mockReturnValue(true);
    chatMessages.update.mockResolvedValue({
      id: 'msg-text-1',
      run_id: null,
      run_status: null,
      metadata: { questionAnswerForwardedViaChatSocket: true },
    });

    const result = await service.sendChatMessage('chat-adhoc', 'React/Next.js');

    expect(telemetryGateway.hasActiveAgentSocket).toHaveBeenCalledWith(
      'chat-adhoc',
      'chat-adhoc',
    );
    expect(telemetryGateway.sendQuestionResponseCommand).toHaveBeenCalledWith(
      'chat-adhoc',
      'chat-adhoc',
      [
        {
          questionIndex: 0,
          selectedOption: null,
          freeTextAnswer: 'React/Next.js',
        },
      ],
    );
    expect(chatActions.requestAction).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({ acknowledged: true, messageId: 'msg-text-1' }),
    );
  });

  it('falls through to new workflow when no active agent socket exists for ad-hoc session', async () => {
    const {
      service,
      chatSessions,
      chatMessages,
      chatActions,
      telemetryGateway,
    } = buildServiceContext();

    chatSessions.findById.mockResolvedValue({
      id: 'chat-adhoc',
      scope_id: null,
      agent_profile_id: 'profile-1',
      agent_profile_name: 'ceo-agent',
      container_id: 'container-abc',
      workflow_run_id: null,
    });
    chatMessages.findByProviderMessage.mockResolvedValue(null);
    chatMessages.create.mockResolvedValue({
      id: 'msg-text-2',
      run_id: null,
      run_status: null,
      metadata: null,
    });
    chatMessages.findPendingRunLinks.mockResolvedValue([]);
    telemetryGateway.hasActiveAgentSocket.mockReturnValue(false);
    chatActions.requestAction.mockResolvedValue({
      runId: 'run-new-1',
      workflowId: 'workflow-chat-default',
      runStatus: 'PENDING',
      correlationId: 'corr-new-1',
    });
    chatMessages.update.mockResolvedValue({
      id: 'msg-text-2',
      run_id: 'run-new-1',
      run_status: 'PENDING',
      metadata: null,
    });
    chatSessions.update.mockResolvedValue({
      id: 'chat-adhoc',
      workflow_run_id: 'run-new-1',
    });

    const result = await service.sendChatMessage('chat-adhoc', 'hello');

    expect(telemetryGateway.hasActiveAgentSocket).toHaveBeenCalledWith(
      'chat-adhoc',
      'chat-adhoc',
    );
    expect(telemetryGateway.sendQuestionResponseCommand).not.toHaveBeenCalled();
    expect(chatActions.requestAction).toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({ acknowledged: true, runId: 'run-new-1' }),
    );
  });

  it('returns existing message when provider idempotency key already exists', async () => {
    const { service, chatSessions, chatMessages, memoryLifecycle } =
      buildServiceContext();

    chatSessions.findById.mockResolvedValue({
      id: 'chat-1',
      scope_id: null,
      agent_profile_id: 'profile-1',
      agent_profile_name: 'ceo-agent',
    });
    chatMessages.findByProviderMessage.mockResolvedValue({
      id: 'msg-existing',
      run_id: 'run-existing',
      run_status: 'RUNNING',
    });

    const result = await service.sendChatMessage('chat-1', 'duplicate', {
      channel: 'telegram',
      providerMessageId: '55',
    });

    expect(chatMessages.create).not.toHaveBeenCalled();
    expect(memoryLifecycle.recordInboundMessage).not.toHaveBeenCalled();
    expect(result).toEqual({
      acknowledged: true,
      messageId: 'msg-existing',
      runId: 'run-existing',
      runStatus: 'RUNNING',
    });
  });

  it('polls pending run statuses when reading event history', async () => {
    const { service, chatSessions, chatMessages, chatActions } =
      buildServiceContext();

    chatSessions.findById.mockResolvedValue({ id: 'chat-1' });
    chatMessages.findPendingRunLinks.mockResolvedValue([
      {
        id: 'msg-1',
        run_id: 'run-1',
        run_status: 'PENDING',
        correlation_id: 'corr-1',
      },
    ]);
    chatActions.getWorkflowRunStatus.mockResolvedValue({
      runId: 'run-1',
      workflowId: 'workflow-chat-default',
      status: 'COMPLETED',
      updatedAt: '2026-04-13T00:00:00.000Z',
      metadata: {
        correlationId: 'corr-1',
      },
    });
    chatMessages.update.mockResolvedValue(null);
    chatMessages.findBySessionId.mockResolvedValue([
      {
        id: 'msg-1',
        event_type: 'user_message',
        created_at: new Date('2026-04-13T00:00:00.000Z'),
        direction: 'inbound',
        sender: 'user',
        channel: 'telegram',
        text: 'hello',
        run_id: 'run-1',
        run_status: 'COMPLETED',
        metadata: { locale: 'en' },
      },
    ]);

    const events = await service.getEventHistory('chat-1');

    expect(chatActions.getWorkflowRunStatus).toHaveBeenCalledWith(
      'run-1',
      'corr-1',
    );
    expect(events[0].payload.runStatus).toBe('COMPLETED');
    expect(events[0].payload.runId).toBe('run-1');
  });

  it('marks message as failed when core action request throws', async () => {
    const { service, chatSessions, chatMessages, chatActions } =
      buildServiceContext();

    chatSessions.findById.mockResolvedValue({
      id: 'chat-1',
      scope_id: null,
      agent_profile_id: 'profile-1',
      agent_profile_name: 'ceo-agent',
    });
    chatMessages.findByProviderMessage.mockResolvedValue(null);
    chatMessages.create.mockResolvedValue({
      id: 'msg-1',
      run_id: null,
      run_status: null,
      metadata: null,
    });
    chatActions.requestAction.mockRejectedValue(new Error('core unavailable'));
    chatMessages.update.mockResolvedValue({
      id: 'msg-1',
      run_id: null,
      run_status: 'FAILED',
    });

    await expect(service.sendChatMessage('chat-1', 'hello')).rejects.toThrow(
      'core unavailable',
    );
    expect(chatMessages.update).toHaveBeenCalledWith('msg-1', {
      run_status: 'FAILED',
    });
  });

  it('links each attachment to the created message when attachmentIds are provided', async () => {
    const {
      service,
      chatSessions,
      chatMessages,
      chatActions,
      memoryLifecycle,
      attachmentsService,
    } = buildServiceContext();

    chatSessions.findById.mockResolvedValue({
      id: 'chat-1',
      scope_id: null,
      agent_profile_id: 'profile-1',
      agent_profile_name: 'ceo-agent',
    });
    chatMessages.findByProviderMessage.mockResolvedValue(null);
    chatMessages.create.mockResolvedValue({
      id: 'msg-attach-1',
      run_id: null,
      run_status: null,
      metadata: null,
    });
    memoryLifecycle.recordInboundMessage.mockResolvedValue(undefined);
    memoryLifecycle.buildActionContext.mockResolvedValue(null);
    chatActions.requestAction.mockResolvedValue({
      runId: 'run-1',
      workflowId: 'workflow-chat-default',
      runStatus: 'PENDING',
      correlationId: 'corr-1',
    });
    chatMessages.update.mockResolvedValue({
      id: 'msg-attach-1',
      run_id: 'run-1',
      run_status: 'PENDING',
      metadata: null,
    });

    await service.sendChatMessage('chat-1', 'hello with files', {
      attachmentIds: [
        'a0000000-0000-0000-0000-000000000001',
        'a0000000-0000-0000-0000-000000000002',
      ],
    });

    expect(attachmentsService.link).toHaveBeenCalledTimes(2);
    expect(attachmentsService.link).toHaveBeenCalledWith(
      'a0000000-0000-0000-0000-000000000001',
      'chat_message',
      'msg-attach-1',
    );
    expect(attachmentsService.link).toHaveBeenCalledWith(
      'a0000000-0000-0000-0000-000000000002',
      'chat_message',
      'msg-attach-1',
    );
  });

  it('does not call attachmentsService when no attachmentIds are provided', async () => {
    const {
      service,
      chatSessions,
      chatMessages,
      chatActions,
      memoryLifecycle,
      attachmentsService,
    } = buildServiceContext();

    chatSessions.findById.mockResolvedValue({
      id: 'chat-1',
      scope_id: null,
      agent_profile_id: 'profile-1',
      agent_profile_name: 'ceo-agent',
    });
    chatMessages.findByProviderMessage.mockResolvedValue(null);
    chatMessages.create.mockResolvedValue({
      id: 'msg-no-attach-1',
      run_id: null,
      run_status: null,
      metadata: null,
    });
    memoryLifecycle.recordInboundMessage.mockResolvedValue(undefined);
    memoryLifecycle.buildActionContext.mockResolvedValue(null);
    chatActions.requestAction.mockResolvedValue({
      runId: 'run-1',
      workflowId: 'workflow-chat-default',
      runStatus: 'PENDING',
      correlationId: 'corr-1',
    });
    chatMessages.update.mockResolvedValue({
      id: 'msg-no-attach-1',
      run_id: 'run-1',
      run_status: 'PENDING',
      metadata: null,
    });

    await service.sendChatMessage('chat-1', 'hello no files');

    expect(attachmentsService.link).not.toHaveBeenCalled();
  });

  it('does not reject when attachment linking fails', async () => {
    const {
      service,
      chatSessions,
      chatMessages,
      chatActions,
      memoryLifecycle,
      attachmentsService,
    } = buildServiceContext();

    chatSessions.findById.mockResolvedValue({
      id: 'chat-1',
      scope_id: null,
      agent_profile_id: 'profile-1',
      agent_profile_name: 'ceo-agent',
    });
    chatMessages.findByProviderMessage.mockResolvedValue(null);
    chatMessages.create.mockResolvedValue({
      id: 'msg-link-fail-1',
      run_id: null,
      run_status: null,
      metadata: null,
    });
    memoryLifecycle.recordInboundMessage.mockResolvedValue(undefined);
    memoryLifecycle.buildActionContext.mockResolvedValue(null);
    chatActions.requestAction.mockResolvedValue({
      runId: 'run-1',
      workflowId: 'workflow-chat-default',
      runStatus: 'PENDING',
      correlationId: 'corr-1',
    });
    chatMessages.update.mockResolvedValue({
      id: 'msg-link-fail-1',
      run_id: 'run-1',
      run_status: 'PENDING',
      metadata: null,
    });
    vi.mocked(attachmentsService.link).mockRejectedValue(
      new Error('storage error'),
    );

    await expect(
      service.sendChatMessage('chat-1', 'hello with files', {
        attachmentIds: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'],
      }),
    ).resolves.not.toThrow();
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
