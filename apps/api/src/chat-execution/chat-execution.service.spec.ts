import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatExecutionService } from './chat-execution.service';
import {
  ChatSessionStatus,
  ContainerTier,
  PI_CAPABILITIES,
  CLAUDE_CODE_CAPABILITIES,
} from '@nexus/core';

const mockChatSessionRepo = {
  findById: vi.fn(),
  update: vi.fn(),
};

const mockContainerOrchestrator = {
  killContainer: vi.fn(),
  removeContainer: vi.fn(),
};

const mockChatSessionContext = {
  injectContextMessage: vi.fn(),
};

const mockAiConfig = {
  resolveStepSettings: vi.fn(),
  resolveRunnerProviderConfig: vi.fn(),
};

const mockToolMounting = {
  prepareToolMount: vi.fn().mockReturnValue('/tmp/tools'),
  writeSdkToolAllowlist: vi.fn(),
  canProfileUseTool: vi.fn().mockReturnValue(true),
  cleanupToolMount: vi.fn(),
};

const mockToolRegistry = {
  getToolsForTier: vi.fn().mockResolvedValue([]),
};

const mockSystemSettings = {
  get: vi.fn(),
};

const mockAgentTokenService = {
  mintAgentToken: vi.fn().mockReturnValue('mock-jwt-token'),
};

const mockContainerConfigBuilder = {
  build: vi.fn().mockReturnValue({
    image: 'nexus-light:latest',
    tier: ContainerTier.LIGHT,
    env: {},
    volumes: [],
    labels: {},
  }),
};

const mockChatQueue = {
  add: vi.fn(),
  getJob: vi.fn(),
  getJobs: vi.fn().mockResolvedValue([]),
};

const mockExecutionDispatchService = {
  dispatch: vi.fn(),
};

function buildService(): ChatExecutionService {
  return new ChatExecutionService(
    mockChatSessionRepo as any,
    mockContainerOrchestrator as any,
    mockChatSessionContext as any,
    mockAiConfig as any,
    mockToolMounting as any,
    mockToolRegistry as any,
    mockSystemSettings as any,
    mockAgentTokenService,
    mockContainerConfigBuilder as any,
    mockChatQueue as any,
    { emit: vi.fn() } as any, // eventEmitter
    mockExecutionDispatchService as any,
    undefined, // budgetDecisionService
  );
}

describe('ChatExecutionService fire-and-poll dispatch', () => {
  let service: ChatExecutionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = buildService();
  });

  it('constructs successfully with all dependencies mocked', () => {
    expect(service).toBeDefined();
  });

  it('dispatches via ExecutionDispatchService and stores execution_id without awaiting agent completion', async () => {
    const chatSessionId = 'sess-dispatch-1';
    const executionId = 'exec-uuid-abc';

    mockChatSessionRepo.findById.mockResolvedValue({
      id: chatSessionId,
      workflow_run_id: null,
    });
    mockAiConfig.resolveStepSettings.mockResolvedValue({
      model: 'claude-3-5-sonnet',
      systemPrompt: 'You are helpful.',
      providerName: 'anthropic',
      providerId: null,
      providerSource: null,
    });
    mockAiConfig.resolveRunnerProviderConfig.mockResolvedValue({
      provider: 'anthropic',
      apiKey: 'sk-test',
      auth: { type: 'api_key' },
      baseUrl: null,
      providerConfig: null,
      providerEnv: {},
    });
    mockChatSessionRepo.update.mockResolvedValue(undefined);
    mockChatSessionContext.injectContextMessage.mockResolvedValue(undefined);
    mockExecutionDispatchService.dispatch.mockResolvedValue({ executionId });
    mockSystemSettings.get = vi.fn().mockResolvedValue({
      autoRetry: { enabled: false, maxAttempts: 3, maxInFlight: 5 },
    });

    const jobData = {
      chatSessionId,
      initialMessage: 'Hello',
      agentProfileName: 'default',
      containerTier: 1,
      contextId: null,
    };

    await service.executeChatSession(jobData as any);

    // Dispatch service should be called with correct params
    expect(mockExecutionDispatchService.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'adhoc_chat',
        chatSessionId,
        containerTier: 1,
      }),
    );

    // execution_id must be persisted on the chat session row
    expect(mockChatSessionRepo.update).toHaveBeenCalledWith(
      chatSessionId,
      expect.objectContaining({ execution_id: executionId }),
    );

    // Container provisioning is NOT done directly — that's the dispatch service's job
    expect(mockContainerOrchestrator.removeContainer).not.toHaveBeenCalled();
  });

  it('uses workflow_chat kind when session has a workflow_run_id', async () => {
    const chatSessionId = 'sess-workflow-1';
    const executionId = 'exec-uuid-workflow';

    mockChatSessionRepo.findById.mockResolvedValue({
      id: chatSessionId,
      workflow_run_id: 'wf-run-123',
    });
    mockAiConfig.resolveStepSettings.mockResolvedValue({
      model: 'claude-3-5-sonnet',
      systemPrompt: 'prompt',
      providerName: 'anthropic',
      providerId: null,
      providerSource: null,
    });
    mockAiConfig.resolveRunnerProviderConfig.mockResolvedValue({
      provider: 'anthropic',
      apiKey: 'sk-test',
      auth: { type: 'api_key' },
      baseUrl: null,
      providerConfig: null,
      providerEnv: {},
    });
    mockChatSessionRepo.update.mockResolvedValue(undefined);
    mockChatSessionContext.injectContextMessage.mockResolvedValue(undefined);
    mockExecutionDispatchService.dispatch.mockResolvedValue({ executionId });
    mockSystemSettings.get = vi.fn().mockResolvedValue({
      autoRetry: { enabled: false, maxAttempts: 3, maxInFlight: 5 },
    });

    const jobData = {
      chatSessionId,
      initialMessage: 'Hello',
      agentProfileName: 'default',
      containerTier: 1,
      contextId: null,
    };

    await service.executeChatSession(jobData as any);

    expect(mockExecutionDispatchService.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'workflow_chat',
        workflowRunId: 'wf-run-123',
      }),
    );
  });

  it('marks session FAILED and rethrows when dispatch throws', async () => {
    const chatSessionId = 'sess-dispatch-fail';

    mockChatSessionRepo.findById.mockResolvedValue({
      id: chatSessionId,
      workflow_run_id: null,
    });
    mockAiConfig.resolveStepSettings.mockResolvedValue({
      model: 'claude-3-5-sonnet',
      systemPrompt: 'prompt',
      providerName: 'anthropic',
      providerId: null,
      providerSource: null,
    });
    mockAiConfig.resolveRunnerProviderConfig.mockResolvedValue({
      provider: 'anthropic',
      apiKey: 'sk-test',
      auth: { type: 'api_key' },
      baseUrl: null,
      providerConfig: null,
      providerEnv: {},
    });
    mockChatSessionRepo.update.mockResolvedValue(undefined);
    mockChatSessionContext.injectContextMessage.mockResolvedValue(undefined);
    mockExecutionDispatchService.dispatch.mockRejectedValue(
      new Error('dispatch error'),
    );
    mockSystemSettings.get = vi.fn().mockResolvedValue({
      autoRetry: { enabled: false, maxAttempts: 3, maxInFlight: 5 },
    });

    const jobData = {
      chatSessionId,
      initialMessage: 'Hello',
      agentProfileName: 'default',
      containerTier: 1,
      contextId: null,
    };

    await expect(service.executeChatSession(jobData as any)).rejects.toThrow(
      'dispatch error',
    );

    expect(mockChatSessionRepo.update).toHaveBeenCalledWith(
      chatSessionId,
      expect.objectContaining({ status: ChatSessionStatus.FAILED }),
    );
  });

  it('throws NotFoundException when chat session does not exist', async () => {
    mockChatSessionRepo.findById.mockResolvedValue(null);

    const jobData = {
      chatSessionId: 'nonexistent',
      initialMessage: 'Hello',
      agentProfileName: 'default',
      containerTier: 1,
      contextId: null,
    };

    await expect(service.executeChatSession(jobData as any)).rejects.toThrow(
      'nonexistent',
    );
  });
});

function buildSetupMocks(
  sessionOverrides: Record<string, unknown> = {},
  jobData: Record<string, unknown> = {},
) {
  const chatSessionId = 'sess-thinking-1';
  const executionId = 'exec-thinking-uuid';

  mockChatSessionRepo.findById.mockResolvedValue({
    id: chatSessionId,
    workflow_run_id: null,
    ...sessionOverrides,
  });
  mockAiConfig.resolveStepSettings.mockResolvedValue({
    model: 'claude-3-5-sonnet',
    systemPrompt: 'prompt',
    providerName: 'anthropic',
    providerId: null,
    providerSource: null,
  });
  mockAiConfig.resolveRunnerProviderConfig.mockResolvedValue({
    provider: 'anthropic',
    apiKey: 'sk-test',
    auth: { type: 'api_key' },
    baseUrl: null,
    providerConfig: null,
    providerEnv: {},
  });
  mockChatSessionRepo.update.mockResolvedValue(undefined);
  mockChatSessionContext.injectContextMessage.mockResolvedValue(undefined);
  mockExecutionDispatchService.dispatch.mockResolvedValue({ executionId });
  mockSystemSettings.get = vi.fn().mockResolvedValue({
    autoRetry: { enabled: false, maxAttempts: 3, maxInFlight: 5 },
  });

  return {
    chatSessionId,
    jobData: {
      chatSessionId,
      initialMessage: 'Hello',
      agentProfileName: 'research-agent',
      containerTier: 1,
      contextId: null,
      ...jobData,
    } as any,
  };
}

describe('ChatExecutionService thinking-level capability dispatch', () => {
  let service: ChatExecutionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = buildService();
  });

  it('passes agentProfileName from jobData to the dispatch call', async () => {
    const { chatSessionId, jobData } = buildSetupMocks(
      {},
      { agentProfileName: 'research-agent' },
    );

    await service.executeChatSession(jobData);

    expect(mockExecutionDispatchService.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ agentProfileName: 'research-agent' }),
    );
    void chatSessionId;
  });

  it('passes supportsThinkingLevels: true for pi harness sessions', async () => {
    const { jobData } = buildSetupMocks({ harness_id: 'pi' });

    await service.executeChatSession(jobData);

    expect(mockExecutionDispatchService.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilities: {
          supportsThinkingLevels: PI_CAPABILITIES.supportsThinkingLevels,
        },
      }),
    );
  });

  it('passes supportsThinkingLevels: false for claude-code harness sessions', async () => {
    const { jobData } = buildSetupMocks({ harness_id: 'claude-code' });

    await service.executeChatSession(jobData);

    expect(mockExecutionDispatchService.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilities: {
          supportsThinkingLevels:
            CLAUDE_CODE_CAPABILITIES.supportsThinkingLevels,
        },
      }),
    );
  });

  it('defaults to pi capabilities when harness_id is null (pre-harness_id sessions)', async () => {
    const { jobData } = buildSetupMocks({ harness_id: null });

    await service.executeChatSession(jobData);

    expect(mockExecutionDispatchService.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilities: {
          supportsThinkingLevels: PI_CAPABILITIES.supportsThinkingLevels,
        },
      }),
    );
  });

  it('defaults to supportsThinkingLevels: false for unknown custom harnesses', async () => {
    const { jobData } = buildSetupMocks({ harness_id: 'custom-harness-xyz' });

    await service.executeChatSession(jobData);

    expect(mockExecutionDispatchService.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilities: { supportsThinkingLevels: false },
      }),
    );
  });
});
