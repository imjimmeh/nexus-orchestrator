import { describe, expect, it, vi } from 'vitest';
import { TelegramIngressService } from './telegram-ingress.service';

function createService() {
  const telegramAdapter = {
    extractInboundMessage: vi.fn(),
    extractCallbackQuery: vi.fn().mockReturnValue(null),
  };
  const settings = {
    getSettings: vi.fn().mockResolvedValue({
      ingressMode: 'webhook',
      defaultAgentProfile: 'architect-agent',
      defaultScopeId: 'project-1',
      allowedUserIds: ['88'],
      pollTimeoutSeconds: 50,
      pollRetryDelayMs: 1000,
      pollBackoffMaxMs: 30000,
      outboundRelayEnabled: true,
      outboundRelayIntervalMs: 3000,
      outboundRelayBatchSize: 20,
      botToken: 'token',
      webhookSecret: null,
      commandsEnabled: true,
      enabledCommands: ['help', 'new', 'resume', 'agent'],
      commandResumeListLimit: 8,
      uxTypingEnabled: true,
      uxTypingHeartbeatMs: 4000,
      uxStatusUpdatesEnabled: true,
      uxStatusMode: 'single_message',
      uxHideThinking: true,
      uxExposeToolNames: false,
      uxCommandMenuSyncEnabled: true,
      uxProgressEventsAllowlist: ['job_start', 'tool_execution_start'],
      uxProgressUpdateThrottleMs: 1500,
      uxMaxProgressUpdatesPerRun: 40,
    }),
  };
  const commandRouter = {
    handleIfCommand: vi.fn().mockResolvedValue(null),
  };
  const chatSessions = {
    resolveOrCreatePreferredChannelSession: vi.fn(),
  };
  const chatMessages = {
    sendChatMessage: vi.fn(),
  };
  const telegramSender = {
    sendChatAction: vi.fn().mockResolvedValue(undefined),
  };
  const toolApprovalHandler = {
    handleCallbackQuery: vi.fn().mockResolvedValue(undefined),
  };
  const telegramSettings = {
    registerChannelIdentity: vi.fn().mockResolvedValue(undefined),
  };

  const service = new TelegramIngressService(
    telegramAdapter as never,
    settings as never,
    commandRouter as never,
    chatSessions as never,
    chatMessages as never,
    telegramSender as never,
    toolApprovalHandler as never,
    telegramSettings as never,
  );

  return {
    service,
    settings,
    commandRouter,
    telegramAdapter,
    chatSessions,
    chatMessages,
    telegramSender,
    toolApprovalHandler,
    telegramSettings,
  };
}

describe('TelegramIngressService', () => {
  it('acknowledges ignored payloads when adapter cannot parse a message', async () => {
    const { service, telegramAdapter, chatSessions, chatMessages } =
      createService();
    telegramAdapter.extractInboundMessage.mockReturnValue(null);

    const result = await service.handlePayload(
      { update_id: 100 },
      'telegram_polling',
    );

    expect(
      chatSessions.resolveOrCreatePreferredChannelSession,
    ).not.toHaveBeenCalled();
    expect(chatMessages.sendChatMessage).not.toHaveBeenCalled();
    expect(result).toEqual({
      acknowledged: true,
      ignored: true,
    });
  });

  it('ignores inbound payloads from users outside configured allowlist', async () => {
    const { service, telegramAdapter, chatSessions, chatMessages } =
      createService();
    telegramAdapter.extractInboundMessage.mockReturnValue({
      provider: 'telegram',
      channel: 'telegram',
      externalUserId: '99',
      externalThreadId: '77',
      providerMessageId: '55',
      correlationId: 'telegram:102',
      text: 'hello blocked',
      metadata: {
        username: 'unauthorized',
        chatType: 'private',
      },
    });

    const result = await service.handlePayload(
      { update_id: 102 },
      'telegram_polling',
    );

    expect(
      chatSessions.resolveOrCreatePreferredChannelSession,
    ).not.toHaveBeenCalled();
    expect(chatMessages.sendChatMessage).not.toHaveBeenCalled();
    expect(result).toEqual({
      acknowledged: true,
      ignored: true,
    });
  });

  it('resolves session and dispatches inbound Telegram message', async () => {
    const {
      service,
      settings,
      commandRouter,
      telegramAdapter,
      chatSessions,
      chatMessages,
      telegramSender,
    } = createService();
    telegramAdapter.extractInboundMessage.mockReturnValue({
      provider: 'telegram',
      channel: 'telegram',
      externalUserId: '88',
      externalThreadId: '77',
      providerMessageId: '55',
      correlationId: 'telegram:101',
      text: 'hello world',
      metadata: {
        username: 'jimme',
        chatType: 'private',
      },
    });
    chatSessions.resolveOrCreatePreferredChannelSession.mockResolvedValue({
      id: 'chat-1',
    });
    chatMessages.sendChatMessage.mockResolvedValue({
      acknowledged: true,
      messageId: 'msg-1',
      runId: 'run-1',
      runStatus: 'PENDING',
    });

    const result = await service.handlePayload(
      { update_id: 101 },
      'telegram_polling',
    );

    expect(settings.getSettings).toHaveBeenCalledOnce();

    expect(commandRouter.handleIfCommand).toHaveBeenCalledOnce();
    expect(
      chatSessions.resolveOrCreatePreferredChannelSession,
    ).toHaveBeenCalledWith({
      provider: 'telegram',
      externalThreadId: '77',
      externalUserId: '88',
      initialMessage: 'hello world',
      defaultAgentProfileName: 'architect-agent',
      scopeId: 'project-1',
    });
    expect(chatMessages.sendChatMessage).toHaveBeenCalledWith(
      'chat-1',
      'hello world',
      expect.objectContaining({
        channel: 'telegram',
        providerMessageId: '55',
        correlationId: 'telegram:101',
        externalUserId: '88',
        requestedBy: 'telegram_polling',
        metadata: {
          username: 'jimme',
          chatType: 'private',
          externalThreadId: '77',
          externalUserId: '88',
          provider: 'telegram',
        },
      }),
    );
    expect(telegramSender.sendChatAction).toHaveBeenCalledWith({
      externalThreadId: '77',
      action: 'typing',
    });
    expect(result).toEqual({
      acknowledged: true,
      chatSessionId: 'chat-1',
      messageId: 'msg-1',
      runId: 'run-1',
      runStatus: 'PENDING',
    });
  });

  it('short-circuits normal dispatch when a slash command is handled', async () => {
    const {
      service,
      commandRouter,
      telegramAdapter,
      chatSessions,
      chatMessages,
    } = createService();
    telegramAdapter.extractInboundMessage.mockReturnValue({
      provider: 'telegram',
      channel: 'telegram',
      externalUserId: '88',
      externalThreadId: '77',
      providerMessageId: '55',
      correlationId: 'telegram:101',
      text: '/help',
      metadata: {
        username: 'jimme',
        chatType: 'private',
      },
    });
    commandRouter.handleIfCommand.mockResolvedValue({
      acknowledged: true,
      chatSessionId: 'chat-cmd-1',
      messageId: 'msg-cmd-1',
      runId: null,
      runStatus: null,
    });

    const result = await service.handlePayload(
      { update_id: 101 },
      'telegram_polling',
    );

    expect(
      chatSessions.resolveOrCreatePreferredChannelSession,
    ).not.toHaveBeenCalled();
    expect(chatMessages.sendChatMessage).not.toHaveBeenCalled();
    expect(result).toEqual({
      acknowledged: true,
      chatSessionId: 'chat-cmd-1',
      messageId: 'msg-cmd-1',
      runId: null,
      runStatus: null,
    });
  });

  it('routes callback queries to the tool approval handler', async () => {
    const {
      service,
      telegramAdapter,
      chatSessions,
      chatMessages,
      toolApprovalHandler,
    } = createService();
    telegramAdapter.extractCallbackQuery.mockReturnValue({
      callbackQueryId: 'cq-1',
      externalThreadId: '77',
      providerMessageId: '55',
      externalUserId: '88',
      data: 'approve_tool:req-1',
    });

    const result = await service.handlePayload(
      {
        update_id: 101,
        callback_query: { id: 'cq-1', data: 'approve_tool:req-1' },
      },
      'telegram_webhook',
    );

    expect(toolApprovalHandler.handleCallbackQuery).toHaveBeenCalledWith({
      callbackQueryId: 'cq-1',
      externalThreadId: '77',
      providerMessageId: '55',
      externalUserId: '88',
      data: 'approve_tool:req-1',
    });
    expect(
      chatSessions.resolveOrCreatePreferredChannelSession,
    ).not.toHaveBeenCalled();
    expect(chatMessages.sendChatMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ acknowledged: true });
  });
});
