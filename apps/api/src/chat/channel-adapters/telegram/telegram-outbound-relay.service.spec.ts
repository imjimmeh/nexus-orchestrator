import { describe, expect, it, vi } from 'vitest';
import { TelegramOutboundRelayService } from './telegram-outbound-relay.service';
import type { ChatChannelProvider } from '../chat-channel-provider.types';

type WorkflowRunStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';
type RelayEvent = {
  event_type: string;
  timestamp: string;
  payload: Record<string, unknown>;
};

interface RelayCandidate {
  id: string;
  chat_session_id: string;
  run_id?: string | null;
  run_status?: string | null;
  correlation_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

type RelayUpdatedMessage = RelayCandidate;

interface RelayRunStatus {
  runId: string;
  workflowId: string;
  status: WorkflowRunStatus;
  updatedAt: string;
  metadata: { correlationId: string };
}

interface ChatActionsMock {
  getWorkflowRunStatus: ReturnType<
    typeof vi.fn<
      (runId: string, correlationId: string) => Promise<RelayRunStatus>
    >
  >;
  getWorkflowRunEvents: ReturnType<
    typeof vi.fn<
      (runId: string, correlationId: string) => Promise<RelayEvent[]>
    >
  >;
  getWorkflowRunDetails: ReturnType<
    typeof vi.fn<
      (runId: string, correlationId: string) => Promise<Record<string, unknown>>
    >
  >;
}

interface ChatMessageRepoMock {
  findPendingRelayCandidates: ReturnType<
    typeof vi.fn<
      (
        provider: ChatChannelProvider,
        limit: number,
      ) => Promise<RelayCandidate[]>
    >
  >;
  findTelegramRelayOutboundByInboundMessageId: ReturnType<
    typeof vi.fn<
      (inboundMessageId: string) => Promise<{
        id: string;
        provider_message_id?: string | null;
        metadata?: Record<string, unknown> | null;
      } | null>
    >
  >;
  update: ReturnType<
    typeof vi.fn<
      (
        id: string,
        data: Record<string, unknown>,
      ) => Promise<RelayUpdatedMessage | null>
    >
  >;
}

interface ChatSessionRepoMock {
  findById: ReturnType<
    typeof vi.fn<
      (id: string) => Promise<{ display_name?: string | null } | null>
    >
  >;
}

interface ChatMessagesMock {
  appendOutboundMessage: ReturnType<
    typeof vi.fn<
      (params: Record<string, unknown>) => Promise<{ messageId: string }>
    >
  >;
}

interface TelegramSenderMock {
  sendMessage: ReturnType<
    typeof vi.fn<
      (params: {
        channel: string;
        externalThreadId: string;
        text: string;
      }) => Promise<{ providerMessageId: string | null }>
    >
  >;
  sendChatAction: ReturnType<
    typeof vi.fn<
      (params: { externalThreadId: string; action: 'typing' }) => Promise<void>
    >
  >;
  editMessageText: ReturnType<
    typeof vi.fn<
      (params: {
        externalThreadId: string;
        providerMessageId: string;
        text: string;
      }) => Promise<boolean>
    >
  >;
  setMyCommands: ReturnType<
    typeof vi.fn<
      (commands: { command: string; description: string }[]) => Promise<void>
    >
  >;
  clearMyCommands: ReturnType<typeof vi.fn<() => Promise<void>>>;
}

interface RuntimeSettingsMock {
  getSettings: ReturnType<
    typeof vi.fn<
      () => Promise<{
        ingressMode: 'webhook' | 'polling' | 'hybrid';
        defaultAgentProfile: string;
        defaultScopeId: string | null;
        allowedUserIds: string[];
        pollTimeoutSeconds: number;
        pollRetryDelayMs: number;
        pollBackoffMaxMs: number;
        outboundRelayEnabled: boolean;
        outboundRelayIntervalMs: number;
        outboundRelayBatchSize: number;
        botToken: string | null;
        webhookSecret: string | null;
        commandsEnabled: boolean;
        enabledCommands: string[];
        commandResumeListLimit: number;
        uxTypingEnabled: boolean;
        uxTypingHeartbeatMs: number;
        uxStatusUpdatesEnabled: boolean;
        uxStatusMode: 'single_message' | 'multi_message';
        uxHideThinking: boolean;
        uxExposeToolNames: boolean;
        uxCommandMenuSyncEnabled: boolean;
        uxProgressEventsAllowlist: string[];
        uxProgressUpdateThrottleMs: number;
        uxMaxProgressUpdatesPerRun: number;
      }>
    >
  >;
}

interface ServiceContext {
  service: TelegramOutboundRelayService;
  settings: RuntimeSettingsMock;
  chatActions: ChatActionsMock;
  chatMessageRepo: ChatMessageRepoMock;
  chatSessionRepo: ChatSessionRepoMock;
  chatMessages: ChatMessagesMock;
  telegramSender: TelegramSenderMock;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function extractUpdatedMetadata(
  chatMessageRepo: ChatMessageRepoMock,
  messageId: string,
): Record<string, unknown> {
  for (
    let index = chatMessageRepo.update.mock.calls.length - 1;
    index >= 0;
    index -= 1
  ) {
    const [updatedMessageId, updatePayload] =
      chatMessageRepo.update.mock.calls[index];
    if (updatedMessageId !== messageId) {
      continue;
    }
    const metadata = asRecord(updatePayload.metadata);
    if (metadata) {
      return metadata;
    }
  }
  throw new Error(`Expected update payload metadata for message ${messageId}`);
}

function createServiceContext(): ServiceContext {
  const chatActions: ChatActionsMock = {
    getWorkflowRunStatus:
      vi.fn<
        (runId: string, correlationId: string) => Promise<RelayRunStatus>
      >(),
    getWorkflowRunEvents:
      vi.fn<(runId: string, correlationId: string) => Promise<RelayEvent[]>>(),
    getWorkflowRunDetails:
      vi.fn<
        (
          runId: string,
          correlationId: string,
        ) => Promise<Record<string, unknown>>
      >(),
  };
  const chatMessageRepo: ChatMessageRepoMock = {
    findPendingRelayCandidates:
      vi.fn<
        (
          provider: ChatChannelProvider,
          limit: number,
        ) => Promise<RelayCandidate[]>
      >(),
    findTelegramRelayOutboundByInboundMessageId: vi.fn<
      (inboundMessageId: string) => Promise<{
        id: string;
        provider_message_id?: string | null;
        metadata?: Record<string, unknown> | null;
      } | null>
    >(),
    update:
      vi.fn<
        (
          id: string,
          data: Record<string, unknown>,
        ) => Promise<RelayUpdatedMessage | null>
      >(),
  };
  const chatSessionRepo: ChatSessionRepoMock = {
    findById:
      vi.fn<(id: string) => Promise<{ display_name?: string | null } | null>>(),
  };
  const chatMessages: ChatMessagesMock = {
    appendOutboundMessage:
      vi.fn<
        (params: Record<string, unknown>) => Promise<{ messageId: string }>
      >(),
  };
  const telegramSender: TelegramSenderMock = {
    sendMessage:
      vi.fn<
        (params: {
          channel: string;
          externalThreadId: string;
          text: string;
        }) => Promise<{ providerMessageId: string | null }>
      >(),
    sendChatAction:
      vi.fn<
        (params: {
          externalThreadId: string;
          action: 'typing';
        }) => Promise<void>
      >(),
    editMessageText:
      vi.fn<
        (params: {
          externalThreadId: string;
          providerMessageId: string;
          text: string;
        }) => Promise<boolean>
      >(),
    setMyCommands:
      vi.fn<
        (commands: { command: string; description: string }[]) => Promise<void>
      >(),
    clearMyCommands: vi.fn<() => Promise<void>>(),
  };
  const settings: RuntimeSettingsMock = {
    getSettings: vi.fn().mockResolvedValue({
      ingressMode: 'webhook',
      defaultAgentProfile: 'ceo-agent',
      defaultScopeId: null,
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
    }),
  };

  const service = new TelegramOutboundRelayService(
    settings as never,
    chatActions as never,
    chatMessageRepo as never,
    chatSessionRepo as never,
    chatMessages as never,
    telegramSender as never,
  );
  return {
    service,
    settings,
    chatActions,
    chatMessageRepo,
    chatSessionRepo,
    chatMessages,
    telegramSender,
  };
}

describe('TelegramOutboundRelayService', () => {
  it('sends outbound Telegram message when a run completes', async () => {
    const context: ServiceContext = createServiceContext();
    const {
      service,
      chatActions,
      chatMessageRepo,
      chatMessages,
      telegramSender,
    } = context;

    chatMessageRepo.findPendingRelayCandidates.mockResolvedValue([
      {
        id: 'msg-1',
        chat_session_id: 'chat-1',
        run_id: 'run-1',
        run_status: 'PENDING',
        correlation_id: 'corr-1',
        metadata: { externalThreadId: '77' },
      },
    ]);
    chatActions.getWorkflowRunStatus.mockResolvedValue({
      runId: 'run-1',
      workflowId: 'workflow-1',
      status: 'COMPLETED',
      updatedAt: '2026-04-13T00:00:00.000Z',
      metadata: {
        correlationId: 'corr-1',
      },
    });
    chatActions.getWorkflowRunDetails.mockResolvedValue({
      id: 'run-1',
      state_variables: {
        jobs: {
          delegate: {
            output: {
              finalStepId: 'delegated_task',
              outputs: {
                delegated_task: {
                  response: 'assistant response',
                },
              },
            },
          },
        },
      },
    });
    chatMessageRepo.findTelegramRelayOutboundByInboundMessageId.mockResolvedValue(
      null,
    );
    chatMessageRepo.update.mockResolvedValue({
      id: 'msg-1',
      chat_session_id: 'chat-1',
      run_id: 'run-1',
      run_status: 'COMPLETED',
      correlation_id: 'corr-1',
      metadata: { externalThreadId: '77' },
    });
    telegramSender.sendMessage.mockResolvedValue({
      providerMessageId: 'tg-10',
    });
    chatMessages.appendOutboundMessage.mockResolvedValue({
      messageId: 'out-1',
    });

    await service.pollOnce();

    expect(telegramSender.sendMessage).toHaveBeenCalledWith({
      channel: 'telegram',
      externalThreadId: '77',
      text: 'assistant response',
    });
    expect(chatMessages.appendOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'chat-1',
        channel: 'telegram',
        text: 'assistant response',
      }),
    );
    expect(chatMessageRepo.update).toHaveBeenCalledWith(
      'msg-1',
      expect.anything(),
    );
    const metadata = extractUpdatedMetadata(chatMessageRepo, 'msg-1');
    expect(typeof metadata.telegramRelaySentAt).toBe('string');
    expect(metadata.telegramRelayStatus).toBe('COMPLETED');
    expect(metadata.telegramRelayOutboundMessageId).toBe('out-1');
  });

  it('edits the latest status message into terminal output when available', async () => {
    const context: ServiceContext = createServiceContext();
    const {
      service,
      chatActions,
      chatMessageRepo,
      chatMessages,
      telegramSender,
    } = context;

    chatMessageRepo.findPendingRelayCandidates.mockResolvedValue([
      {
        id: 'msg-edit-1',
        chat_session_id: 'chat-edit-1',
        run_id: 'run-edit-1',
        run_status: 'RUNNING',
        correlation_id: 'corr-edit-1',
        metadata: {
          externalThreadId: '771',
          telegramUxStatusMessageId: 'status-msg-1',
          telegramUxStatusProviderMessageId: 'tg-status-1',
        },
      },
    ]);
    chatActions.getWorkflowRunStatus.mockResolvedValue({
      runId: 'run-edit-1',
      workflowId: 'workflow-1',
      status: 'COMPLETED',
      updatedAt: '2026-04-15T00:00:00.000Z',
      metadata: {
        correlationId: 'corr-edit-1',
      },
    });
    chatActions.getWorkflowRunDetails.mockResolvedValue({
      id: 'run-edit-1',
      state_variables: {
        jobs: {
          delegate: {
            output: {
              finalStepId: 'delegated_task',
              outputs: {
                delegated_task: {
                  response: 'final relay response',
                },
              },
            },
          },
        },
      },
    });
    chatMessageRepo.findTelegramRelayOutboundByInboundMessageId.mockResolvedValue(
      null,
    );
    chatMessageRepo.update.mockImplementation((id) => {
      if (id === 'msg-edit-1') {
        return Promise.resolve({
          id: 'msg-edit-1',
          chat_session_id: 'chat-edit-1',
          run_id: 'run-edit-1',
          run_status: 'COMPLETED',
          correlation_id: 'corr-edit-1',
          metadata: {
            externalThreadId: '771',
            telegramUxStatusMessageId: 'status-msg-1',
            telegramUxStatusProviderMessageId: 'tg-status-1',
          },
        });
      }

      return Promise.resolve(null);
    });
    telegramSender.editMessageText.mockResolvedValue(true);

    await service.pollOnce();

    expect(telegramSender.editMessageText).toHaveBeenCalledWith({
      externalThreadId: '771',
      providerMessageId: 'tg-status-1',
      text: 'final relay response',
    });
    expect(chatMessageRepo.update).toHaveBeenCalledWith('status-msg-1', {
      text: 'final relay response',
    });
    expect(telegramSender.sendMessage).not.toHaveBeenCalled();
    expect(chatMessages.appendOutboundMessage).not.toHaveBeenCalled();

    const metadata = extractUpdatedMetadata(chatMessageRepo, 'msg-edit-1');
    expect(metadata.telegramRelayStatus).toBe('COMPLETED');
    expect(metadata.telegramRelayOutboundMessageId).toBe('status-msg-1');
    expect(metadata.telegramRelayProviderMessageId).toBe('tg-status-1');
  });

  it('falls back to sending a new terminal message when status edit is unavailable', async () => {
    const context: ServiceContext = createServiceContext();
    const {
      service,
      chatActions,
      chatMessageRepo,
      chatMessages,
      telegramSender,
    } = context;

    chatMessageRepo.findPendingRelayCandidates.mockResolvedValue([
      {
        id: 'msg-edit-fallback-1',
        chat_session_id: 'chat-edit-fallback-1',
        run_id: 'run-edit-fallback-1',
        run_status: 'RUNNING',
        correlation_id: 'corr-edit-fallback-1',
        metadata: {
          externalThreadId: '772',
          telegramUxStatusMessageId: 'status-msg-fallback-1',
          telegramUxStatusProviderMessageId: 'tg-status-fallback-1',
        },
      },
    ]);
    chatActions.getWorkflowRunStatus.mockResolvedValue({
      runId: 'run-edit-fallback-1',
      workflowId: 'workflow-1',
      status: 'COMPLETED',
      updatedAt: '2026-04-15T00:00:00.000Z',
      metadata: {
        correlationId: 'corr-edit-fallback-1',
      },
    });
    chatActions.getWorkflowRunDetails.mockResolvedValue({
      id: 'run-edit-fallback-1',
      state_variables: {
        jobs: {
          delegate: {
            output: {
              outputs: {
                delegated_task: {
                  response: 'fallback terminal response',
                },
              },
            },
          },
        },
      },
    });
    chatMessageRepo.findTelegramRelayOutboundByInboundMessageId.mockResolvedValue(
      null,
    );
    chatMessageRepo.update.mockResolvedValue(null);
    telegramSender.editMessageText.mockResolvedValue(false);
    telegramSender.sendMessage.mockResolvedValue({
      providerMessageId: 'tg-out-fallback-1',
    });
    chatMessages.appendOutboundMessage.mockResolvedValue({
      messageId: 'out-fallback-1',
    });

    await service.pollOnce();

    expect(telegramSender.editMessageText).toHaveBeenCalledWith({
      externalThreadId: '772',
      providerMessageId: 'tg-status-fallback-1',
      text: 'fallback terminal response',
    });
    expect(telegramSender.sendMessage).toHaveBeenCalledWith({
      channel: 'telegram',
      externalThreadId: '772',
      text: 'fallback terminal response',
    });
    expect(chatMessages.appendOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'chat-edit-fallback-1',
        channel: 'telegram',
        text: 'fallback terminal response',
      }),
    );
  });

  it('skips relay when terminal run cannot resolve external thread id', async () => {
    const context: ServiceContext = createServiceContext();
    const {
      service,
      chatActions,
      chatMessageRepo,
      chatSessionRepo,
      telegramSender,
      chatMessages,
    } = context;

    chatMessageRepo.findPendingRelayCandidates.mockResolvedValue([
      {
        id: 'msg-2',
        chat_session_id: 'chat-2',
        run_id: 'run-2',
        run_status: 'RUNNING',
        correlation_id: 'corr-2',
        metadata: {},
      },
    ]);
    chatActions.getWorkflowRunStatus.mockResolvedValue({
      runId: 'run-2',
      workflowId: 'workflow-1',
      status: 'CANCELLED',
      updatedAt: '2026-04-13T00:00:00.000Z',
      metadata: {
        correlationId: 'corr-2',
      },
    });
    chatMessageRepo.findTelegramRelayOutboundByInboundMessageId.mockResolvedValue(
      null,
    );
    chatSessionRepo.findById.mockResolvedValue({ display_name: null });
    chatMessageRepo.update.mockResolvedValue(null);

    await service.pollOnce();

    expect(telegramSender.sendMessage).not.toHaveBeenCalled();
    expect(chatMessages.appendOutboundMessage).not.toHaveBeenCalled();
    expect(chatMessageRepo.update).toHaveBeenCalledWith(
      'msg-2',
      expect.anything(),
    );
    const metadata = extractUpdatedMetadata(chatMessageRepo, 'msg-2');
    expect(metadata.telegramRelaySkipReason).toBe('missing_external_thread_id');
  });

  it('relays pending ask_user_questions prompts while run is active', async () => {
    const context: ServiceContext = createServiceContext();
    const {
      service,
      chatActions,
      chatMessageRepo,
      telegramSender,
      chatMessages,
    } = context;

    chatMessageRepo.findPendingRelayCandidates.mockResolvedValue([
      {
        id: 'msg-qa-1',
        chat_session_id: 'chat-qa-1',
        run_id: 'run-qa-1',
        run_status: 'RUNNING',
        correlation_id: 'corr-qa-1',
        metadata: { externalThreadId: '99' },
      },
    ]);
    chatActions.getWorkflowRunStatus.mockResolvedValue({
      runId: 'run-qa-1',
      workflowId: 'workflow-1',
      status: 'RUNNING',
      updatedAt: '2026-04-14T14:23:20.000Z',
      metadata: {
        correlationId: 'corr-qa-1',
      },
    });
    chatActions.getWorkflowRunEvents.mockResolvedValue([
      {
        event_type: 'tool_execution_start',
        timestamp: '2026-04-14T14:23:18.947Z',
        payload: {
          toolName: 'ask_user_questions',
          toolCallId: 'call-qa-1',
          args: {
            questions: [
              {
                question: 'How should I proceed?',
                options: ['Check workspace', 'Review projects'],
              },
            ],
          },
        },
      },
    ]);
    telegramSender.sendMessage.mockResolvedValue({
      providerMessageId: 'tg-qa-1',
    });
    chatMessages.appendOutboundMessage.mockResolvedValue({
      messageId: 'out-qa-1',
    });
    chatMessageRepo.update.mockResolvedValue(null);

    await service.pollOnce();

    expect(telegramSender.sendMessage).toHaveBeenCalledTimes(1);
    expect(chatMessages.appendOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'chat-qa-1',
        channel: 'telegram',
      }),
    );

    const metadata = extractUpdatedMetadata(chatMessageRepo, 'msg-qa-1');
    expect(typeof metadata.telegramQuestionRelaySentAt).toBe('string');
    expect(metadata.telegramQuestionRelayQuestionCount).toBe(1);
    expect(metadata.telegramQuestionRelayOutboundMessageId).toBe('out-qa-1');
  });

  it('does not send outbound message while run is still active', async () => {
    const context: ServiceContext = createServiceContext();
    const {
      service,
      chatActions,
      chatMessageRepo,
      telegramSender,
      chatMessages,
    } = context;

    chatMessageRepo.findPendingRelayCandidates.mockResolvedValue([
      {
        id: 'msg-3',
        chat_session_id: 'chat-3',
        run_id: 'run-3',
        run_status: 'PENDING',
        correlation_id: 'corr-3',
        metadata: { externalThreadId: '88' },
      },
    ]);
    chatActions.getWorkflowRunStatus.mockResolvedValue({
      runId: 'run-3',
      workflowId: 'workflow-1',
      status: 'RUNNING',
      updatedAt: '2026-04-13T00:00:00.000Z',
      metadata: {
        correlationId: 'corr-3',
      },
    });
    chatActions.getWorkflowRunEvents.mockResolvedValue([]);
    chatMessageRepo.update.mockResolvedValue(null);

    await service.pollOnce();

    expect(telegramSender.sendMessage).not.toHaveBeenCalled();
    expect(chatMessages.appendOutboundMessage).not.toHaveBeenCalled();
    expect(telegramSender.sendChatAction).toHaveBeenCalledWith({
      externalThreadId: '88',
      action: 'typing',
    });
  });

  it('relays allowlisted progress updates while run is active', async () => {
    const context: ServiceContext = createServiceContext();
    const {
      service,
      chatActions,
      chatMessageRepo,
      telegramSender,
      chatMessages,
    } = context;

    chatMessageRepo.findPendingRelayCandidates.mockResolvedValue([
      {
        id: 'msg-progress-1',
        chat_session_id: 'chat-progress-1',
        run_id: 'run-progress-1',
        run_status: 'RUNNING',
        correlation_id: 'corr-progress-1',
        metadata: { externalThreadId: '101' },
      },
    ]);
    chatActions.getWorkflowRunStatus.mockResolvedValue({
      runId: 'run-progress-1',
      workflowId: 'workflow-1',
      status: 'RUNNING',
      updatedAt: '2026-04-14T14:23:20.000Z',
      metadata: {
        correlationId: 'corr-progress-1',
      },
    });
    chatActions.getWorkflowRunEvents.mockResolvedValue([
      {
        event_type: 'job_start',
        timestamp: '2026-04-14T14:23:18.947Z',
        payload: {},
      },
    ]);
    telegramSender.sendMessage.mockResolvedValue({
      providerMessageId: 'tg-progress-1',
    });
    chatMessages.appendOutboundMessage.mockResolvedValue({
      messageId: 'out-progress-1',
    });
    chatMessageRepo.update.mockResolvedValue(null);

    await service.pollOnce();

    expect(telegramSender.sendMessage).toHaveBeenCalledWith({
      channel: 'telegram',
      externalThreadId: '101',
      text: 'Started processing your request.',
    });
    expect(chatMessages.appendOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'chat-progress-1',
        channel: 'telegram',
        text: 'Started processing your request.',
      }),
    );
  });

  it('appends new tool event text to existing status message text', async () => {
    const context: ServiceContext = createServiceContext();
    const {
      service,
      chatActions,
      chatMessageRepo,
      telegramSender,
      chatMessages,
      settings,
    } = context;

    settings.getSettings.mockResolvedValue({
      ingressMode: 'webhook',
      defaultAgentProfile: 'ceo-agent',
      defaultScopeId: null,
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
      uxExposeToolNames: true,
      uxCommandMenuSyncEnabled: true,
      uxProgressEventsAllowlist: [
        'job_start',
        'tool_execution_start',
        'tool_execution_end',
      ],
      uxProgressUpdateThrottleMs: 0,
      uxMaxProgressUpdatesPerRun: 40,
    });

    const startCursor = '2026-04-15T11:59:58.000Z|tool_execution_start|0';

    chatMessageRepo.findPendingRelayCandidates.mockResolvedValue([
      {
        id: 'msg-acc-1',
        chat_session_id: 'chat-acc-1',
        run_id: 'run-acc-1',
        run_status: 'RUNNING',
        correlation_id: 'corr-acc-1',
        metadata: {
          externalThreadId: '200',
          telegramUxStatusMessageId: 'status-acc-1',
          telegramUxStatusProviderMessageId: 'tg-status-acc-1',
          telegramUxStatusText: 'Running tool: bash.',
          telegramUxLastRelayedEventCursor: startCursor,
        },
      },
    ]);
    chatActions.getWorkflowRunStatus.mockResolvedValue({
      runId: 'run-acc-1',
      workflowId: 'workflow-1',
      status: 'RUNNING',
      updatedAt: '2026-04-15T12:00:01.000Z',
      metadata: { correlationId: 'corr-acc-1' },
    });
    chatActions.getWorkflowRunEvents.mockResolvedValue([
      {
        event_type: 'tool_execution_start',
        timestamp: '2026-04-15T11:59:58.000Z',
        payload: { toolName: 'bash' },
      },
      {
        event_type: 'tool_execution_end',
        timestamp: '2026-04-15T12:00:01.000Z',
        payload: { toolName: 'bash' },
      },
    ]);
    chatMessageRepo.update.mockResolvedValue(null);
    telegramSender.editMessageText.mockResolvedValue(true);

    await service.pollOnce();

    expect(telegramSender.editMessageText).toHaveBeenCalledWith({
      externalThreadId: '200',
      providerMessageId: 'tg-status-acc-1',
      text: 'Running tool: bash.\nCompleted tool: bash.',
    });
    expect(telegramSender.sendMessage).not.toHaveBeenCalled();
    expect(chatMessages.appendOutboundMessage).not.toHaveBeenCalled();
  });

  it('aggregates consecutive tool-use updates into one status message', async () => {
    const context: ServiceContext = createServiceContext();
    const {
      service,
      settings,
      chatActions,
      chatMessageRepo,
      telegramSender,
      chatMessages,
    } = context;

    settings.getSettings.mockResolvedValue({
      ingressMode: 'webhook',
      defaultAgentProfile: 'ceo-agent',
      defaultScopeId: null,
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
      uxExposeToolNames: true,
      uxCommandMenuSyncEnabled: true,
      uxProgressEventsAllowlist: ['job_start', 'tool_execution_start'],
      uxProgressUpdateThrottleMs: 1500,
      uxMaxProgressUpdatesPerRun: 40,
    });

    chatMessageRepo.findPendingRelayCandidates.mockResolvedValue([
      {
        id: 'msg-tool-batch-1',
        chat_session_id: 'chat-tool-batch-1',
        run_id: 'run-tool-batch-1',
        run_status: 'RUNNING',
        correlation_id: 'corr-tool-batch-1',
        metadata: {
          externalThreadId: '111',
          telegramUxStatusMessageId: 'status-tool-batch-1',
          telegramUxStatusProviderMessageId: 'tg-status-tool-batch-1',
        },
      },
    ]);
    chatActions.getWorkflowRunStatus.mockResolvedValue({
      runId: 'run-tool-batch-1',
      workflowId: 'workflow-1',
      status: 'RUNNING',
      updatedAt: '2026-04-15T12:00:00.000Z',
      metadata: {
        correlationId: 'corr-tool-batch-1',
      },
    });
    chatActions.getWorkflowRunEvents.mockResolvedValue([
      {
        event_type: 'tool_execution_start',
        timestamp: '2026-04-15T11:59:58.000Z',
        payload: {
          toolName: 'search_codebase',
        },
      },
      {
        event_type: 'tool_execution_start',
        timestamp: '2026-04-15T11:59:59.000Z',
        payload: {
          toolName: 'read',
        },
      },
    ]);
    chatMessageRepo.update.mockResolvedValue(null);
    telegramSender.editMessageText.mockResolvedValue(true);

    await service.pollOnce();

    expect(telegramSender.editMessageText).toHaveBeenCalledWith({
      externalThreadId: '111',
      providerMessageId: 'tg-status-tool-batch-1',
      text: 'Running tools: search_codebase, read.',
    });
    expect(telegramSender.sendMessage).not.toHaveBeenCalled();
    expect(chatMessages.appendOutboundMessage).not.toHaveBeenCalled();
  });

  it('sanitizes terminal completed response when hide-thinking mode is enabled', async () => {
    const context: ServiceContext = createServiceContext();
    const {
      service,
      chatActions,
      chatMessageRepo,
      chatMessages,
      telegramSender,
    } = context;

    chatMessageRepo.findPendingRelayCandidates.mockResolvedValue([
      {
        id: 'msg-hide-1',
        chat_session_id: 'chat-hide-1',
        run_id: 'run-hide-1',
        run_status: 'PENDING',
        correlation_id: 'corr-hide-1',
        metadata: { externalThreadId: '77' },
      },
    ]);
    chatActions.getWorkflowRunStatus.mockResolvedValue({
      runId: 'run-hide-1',
      workflowId: 'workflow-1',
      status: 'COMPLETED',
      updatedAt: '2026-04-13T00:00:00.000Z',
      metadata: {
        correlationId: 'corr-hide-1',
      },
    });
    chatActions.getWorkflowRunDetails.mockResolvedValue({
      id: 'run-hide-1',
      state_variables: {
        jobs: {
          delegate: {
            output: {
              outputs: {
                delegated_task: {
                  response:
                    '<thinking>internal reasoning</thinking>Final user reply',
                },
              },
            },
          },
        },
      },
    });
    chatMessageRepo.findTelegramRelayOutboundByInboundMessageId.mockResolvedValue(
      null,
    );
    chatMessageRepo.update.mockResolvedValue(null);
    telegramSender.sendMessage.mockResolvedValue({
      providerMessageId: 'tg-hide-1',
    });
    chatMessages.appendOutboundMessage.mockResolvedValue({
      messageId: 'out-hide-1',
    });

    await service.pollOnce();

    expect(telegramSender.sendMessage).toHaveBeenCalledWith({
      channel: 'telegram',
      externalThreadId: '77',
      text: 'Final user reply',
    });
  });
});
