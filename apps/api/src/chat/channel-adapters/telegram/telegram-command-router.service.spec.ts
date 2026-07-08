import { describe, expect, it, vi } from 'vitest';
import { TelegramAgentCommandHandler } from './telegram-agent-command.handler';
import { TelegramHelpCommandHandler } from './telegram-help-command.handler';
import { TelegramNewCommandHandler } from './telegram-new-command.handler';
import { TelegramCommandRouterService } from './telegram-command-router.service';
import { TelegramResumeCommandHandler } from './telegram-resume-command.handler';
import type { ChatSessionsService } from '../../chat-sessions/chat-sessions.service';
import type { TelegramChannelRuntimeSettings } from './telegram-runtime-settings.types';

function createSettings(
  overrides: Partial<TelegramChannelRuntimeSettings> = {},
): TelegramChannelRuntimeSettings {
  return {
    ingressMode: 'webhook',
    defaultAgentProfile: 'ceo-agent',
    defaultScopeId: 'project-1',
    allowedUserIds: [],
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
    ...overrides,
  };
}

function createInbound(text: string, args: string[] = []) {
  const maybeCommand = text.startsWith('/')
    ? {
        name: text.slice(1).split('@')[0]?.split(' ')[0] ?? '',
        args,
      }
    : null;

  return {
    provider: 'telegram',
    channel: 'telegram',
    externalUserId: '88',
    externalThreadId: '77',
    providerMessageId: '55',
    correlationId: 'telegram:101',
    text,
    metadata: {
      username: 'jimme',
      chatType: 'private',
      telegramCommand: maybeCommand,
    },
  };
}

function createService() {
  const chatSessions = {
    resolveOrCreatePreferredChannelSession: vi.fn(),
    createAndActivateChannelSession: vi.fn(),
    listRecentChannelSessions: vi.fn(),
    canAccessChannelSession: vi.fn(),
    activateChannelSession: vi.fn(),
  };
  const chatMessages = {
    findByProviderMessage: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const chatMessageActions = {
    appendOutboundMessage: vi.fn(),
  };
  const telegramSender = {
    sendMessage: vi.fn(),
  };
  const chatSessionsService = chatSessions as unknown as ChatSessionsService;

  const service = new TelegramCommandRouterService(
    chatSessions as never,
    chatMessages as never,
    chatMessageActions as never,
    telegramSender as never,
    new TelegramHelpCommandHandler(),
    new TelegramNewCommandHandler(chatSessionsService),
    new TelegramResumeCommandHandler(chatSessionsService),
    new TelegramAgentCommandHandler(chatSessionsService),
  );

  return {
    service,
    chatSessions,
    chatMessages,
    chatMessageActions,
    telegramSender,
  };
}

function readLastSentText(telegramSender: {
  sendMessage: ReturnType<typeof vi.fn>;
}): string {
  const calls = telegramSender.sendMessage.mock.calls as unknown[];
  const lastCall = calls.at(-1);
  if (!Array.isArray(lastCall) || lastCall.length === 0) {
    return '';
  }

  const payload = (lastCall as unknown[])[0];
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const maybeText = (payload as { text?: unknown }).text;
  return typeof maybeText === 'string' ? maybeText : '';
}

describe('TelegramCommandRouterService', () => {
  it('returns null for non-command messages', async () => {
    const { service, chatSessions, chatMessages } = createService();

    const result = await service.handleIfCommand({
      inbound: createInbound('hello world'),
      settings: createSettings(),
      requestedBy: 'telegram_polling',
    });

    expect(result).toBeNull();
    expect(chatMessages.create).not.toHaveBeenCalled();
    expect(
      chatSessions.resolveOrCreatePreferredChannelSession,
    ).not.toHaveBeenCalled();
  });

  it('handles /new by creating and activating a fresh session', async () => {
    const {
      service,
      chatSessions,
      chatMessages,
      chatMessageActions,
      telegramSender,
    } = createService();

    chatMessages.findByProviderMessage.mockResolvedValue(null);
    chatSessions.resolveOrCreatePreferredChannelSession.mockResolvedValue({
      id: 'chat-context',
      agentProfileName: 'ceo-agent',
      status: 'RUNNING',
      scope_id: 'project-1',
      projectName: 'Project One',
      displayName: 'telegram:77',
      initialMessage: 'hello',
      createdAt: new Date('2026-04-14T10:00:00.000Z'),
      completedAt: null,
    });
    chatMessages.create.mockResolvedValue({
      id: 'cmd-1',
      chat_session_id: 'chat-context',
      metadata: {},
    });
    chatSessions.createAndActivateChannelSession.mockResolvedValue({
      id: 'chat-new',
      agentProfileName: 'ceo-agent',
      status: 'RUNNING',
      scope_id: 'project-1',
      projectName: 'Project One',
      displayName: 'telegram:77',
      initialMessage: 'Telegram /new command',
      createdAt: new Date('2026-04-14T10:01:00.000Z'),
      completedAt: null,
    });
    telegramSender.sendMessage.mockResolvedValue({
      providerMessageId: 'tg-999',
    });
    chatMessageActions.appendOutboundMessage.mockResolvedValue({
      messageId: 'out-1',
    });
    chatMessages.update.mockResolvedValue({ id: 'cmd-1' });

    const result = await service.handleIfCommand({
      inbound: createInbound('/new'),
      settings: createSettings(),
      requestedBy: 'telegram_webhook',
    });

    expect(chatSessions.createAndActivateChannelSession).toHaveBeenCalledWith({
      provider: 'telegram',
      externalThreadId: '77',
      externalUserId: '88',
      agentProfileName: 'ceo-agent',
      initialMessage: 'Telegram /new command',
      scopeId: 'project-1',
    });
    expect(telegramSender.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'telegram',
        externalThreadId: '77',
      }),
    );
    expect(result).toEqual({
      acknowledged: true,
      chatSessionId: 'chat-new',
      messageId: 'cmd-1',
      runId: null,
      runStatus: null,
    });
  });

  it('handles /resume with no argument by returning a session list', async () => {
    const {
      service,
      chatSessions,
      chatMessages,
      chatMessageActions,
      telegramSender,
    } = createService();

    chatMessages.findByProviderMessage.mockResolvedValue(null);
    chatSessions.resolveOrCreatePreferredChannelSession.mockResolvedValue({
      id: 'chat-active',
      agentProfileName: 'ceo-agent',
      status: 'RUNNING',
      scope_id: 'project-1',
      projectName: 'Project One',
      displayName: 'telegram:77',
      initialMessage: 'hello',
      createdAt: new Date('2026-04-14T10:00:00.000Z'),
      completedAt: null,
    });
    chatMessages.create.mockResolvedValue({
      id: 'cmd-2',
      chat_session_id: 'chat-active',
      metadata: {},
    });
    chatSessions.listRecentChannelSessions.mockResolvedValue([
      {
        id: 'chat-active',
        agentProfileName: 'ceo-agent',
        status: 'RUNNING',
        scope_id: 'project-1',
        projectName: 'Project One',
        displayName: 'telegram:77',
        initialMessage: 'hello',
        createdAt: new Date('2026-04-14T10:00:00.000Z'),
        completedAt: null,
      },
    ]);
    telegramSender.sendMessage.mockResolvedValue({ providerMessageId: 'tg-2' });
    chatMessageActions.appendOutboundMessage.mockResolvedValue({
      messageId: 'out-2',
    });
    chatMessages.update.mockResolvedValue({ id: 'cmd-2' });

    await service.handleIfCommand({
      inbound: createInbound('/resume'),
      settings: createSettings({ commandResumeListLimit: 5 }),
      requestedBy: 'telegram_polling',
    });

    expect(chatSessions.listRecentChannelSessions).toHaveBeenCalledWith({
      provider: 'telegram',
      externalThreadId: '77',
      externalUserId: '88',
      limit: 5,
    });
    expect(readLastSentText(telegramSender)).toContain('Recent sessions:');
  });

  it('handles /resume <index> by activating the selected session', async () => {
    const {
      service,
      chatSessions,
      chatMessages,
      chatMessageActions,
      telegramSender,
    } = createService();

    chatMessages.findByProviderMessage.mockResolvedValue(null);
    chatSessions.resolveOrCreatePreferredChannelSession.mockResolvedValue({
      id: 'chat-active',
      agentProfileName: 'ceo-agent',
      status: 'RUNNING',
      scope_id: 'project-1',
      projectName: 'Project One',
      displayName: 'telegram:77',
      initialMessage: 'hello',
      createdAt: new Date('2026-04-14T10:00:00.000Z'),
      completedAt: null,
    });
    chatMessages.create.mockResolvedValue({
      id: 'cmd-3',
      chat_session_id: 'chat-active',
      metadata: {},
    });
    chatSessions.listRecentChannelSessions.mockResolvedValue([
      {
        id: 'chat-1',
        agentProfileName: 'ceo-agent',
        status: 'RUNNING',
        scope_id: 'project-1',
        projectName: 'Project One',
        displayName: 'telegram:77',
        initialMessage: 'hello',
        createdAt: new Date('2026-04-14T10:00:00.000Z'),
        completedAt: null,
      },
      {
        id: 'chat-2',
        agentProfileName: 'architect-agent',
        status: 'RUNNING',
        scope_id: 'project-1',
        projectName: 'Project One',
        displayName: 'telegram:77',
        initialMessage: 'hello',
        createdAt: new Date('2026-04-14T10:00:00.000Z'),
        completedAt: null,
      },
    ]);
    chatSessions.activateChannelSession.mockResolvedValue({
      id: 'chat-2',
      agentProfileName: 'architect-agent',
      status: 'RUNNING',
      scope_id: 'project-1',
      projectName: 'Project One',
      displayName: 'telegram:77',
      initialMessage: 'hello',
      createdAt: new Date('2026-04-14T10:00:00.000Z'),
      completedAt: null,
    });
    telegramSender.sendMessage.mockResolvedValue({ providerMessageId: 'tg-3' });
    chatMessageActions.appendOutboundMessage.mockResolvedValue({
      messageId: 'out-3',
    });
    chatMessages.update.mockResolvedValue({ id: 'cmd-3' });

    await service.handleIfCommand({
      inbound: createInbound('/resume 2', ['2']),
      settings: createSettings(),
      requestedBy: 'telegram_polling',
    });

    expect(chatSessions.activateChannelSession).toHaveBeenCalledWith({
      provider: 'telegram',
      externalThreadId: '77',
      externalUserId: '88',
      chatSessionId: 'chat-2',
    });
    expect(readLastSentText(telegramSender)).toContain(
      'Resumed session chat-2',
    );
  });

  it('returns early when command message is a duplicate provider message', async () => {
    const { service, chatSessions, chatMessages } = createService();

    chatMessages.findByProviderMessage.mockResolvedValue({
      id: 'cmd-existing',
      chat_session_id: 'chat-existing',
      run_id: null,
      run_status: null,
    });

    const result = await service.handleIfCommand({
      inbound: createInbound('/help'),
      settings: createSettings(),
      requestedBy: 'telegram_polling',
    });

    expect(
      chatSessions.resolveOrCreatePreferredChannelSession,
    ).not.toHaveBeenCalled();
    expect(chatMessages.create).not.toHaveBeenCalled();
    expect(result).toEqual({
      acknowledged: true,
      chatSessionId: 'chat-existing',
      messageId: 'cmd-existing',
      runId: null,
      runStatus: null,
    });
  });
});
