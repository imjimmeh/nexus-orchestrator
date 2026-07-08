import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ContainerTier } from '@nexus/core';
import { ExecutionDispatchService } from './execution-dispatch.service';
import type {
  AgentConfig,
  DispatchParams,
  IOrchestratorIpResolver,
} from './execution-dispatch.service.types';
import type { IContainerConfig } from '@nexus/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContainerConfig(
  overrides: Partial<IContainerConfig> = {},
): IContainerConfig {
  return {
    image: 'nexus-light:latest',
    tier: ContainerTier.LIGHT,
    ...overrides,
  };
}

function makeAgentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    provider: 'anthropic',
    model: 'claude-3-haiku-20240307',
    auth: { type: 'api_key', apiKey: 'sk-test' },
    apiKey: 'sk-test',
    systemPrompt: 'You are a helpful assistant.',
    initialPrompt: 'Hello!',
    ...overrides,
  };
}

function makeDispatchParams(
  overrides: Partial<DispatchParams> = {},
): DispatchParams {
  return {
    kind: 'adhoc_chat',
    agentConfig: makeAgentConfig(),
    containerConfig: makeContainerConfig(),
    containerTier: 2,
    chatSessionId: 'session-abc',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

const ORCHESTRATOR_URL = 'http://orchestrator.local:3010';
const RESOLVED_IP = '172.17.0.2';

function makeMocks() {
  const executionRepository = {
    create: vi.fn().mockResolvedValue({}),
    applyTransition: vi.fn().mockResolvedValue({}),
  };

  const eventPublisher = {
    created: vi.fn().mockResolvedValue(undefined),
    provisioning: vi.fn().mockResolvedValue(undefined),
    provisioned: vi.fn().mockResolvedValue(undefined),
    running: vi.fn().mockResolvedValue(undefined),
    failed: vi.fn().mockResolvedValue(undefined),
  };

  const containerOrchestrator = {
    provisionContainer: vi.fn().mockResolvedValue('container-123'),
    fetchContainerLogSnapshot: vi.fn().mockResolvedValue('logs'),
    getContainerStatus: vi.fn().mockResolvedValue({ id: 'container-123' }),
    killContainer: vi.fn().mockResolvedValue(undefined),
    removeContainer: vi.fn().mockResolvedValue(undefined),
  };

  const containerHttpClient = {
    buildBaseUrl: vi.fn().mockReturnValue(`http://${RESOLVED_IP}:8374`),
    waitForHealth: vi.fn().mockResolvedValue(undefined),
    executeAgent: vi.fn().mockResolvedValue({ ok: true, response: 'ack' }),
  };

  // Default: no thinking level requested → dropped:false → fall back to
  // params.agentConfig.thinkingLevel (undefined in most tests).
  const thinkingLevelResolver = {
    resolve: vi.fn().mockResolvedValue({ dropped: false }),
  };

  const aiConfigurationService = {
    getAgentProfileByName: vi.fn().mockResolvedValue(null),
    getModelDefaultThinkingLevel: vi.fn().mockResolvedValue(null),
  };

  return {
    executionRepository,
    eventPublisher,
    containerOrchestrator,
    containerHttpClient,
    thinkingLevelResolver,
    aiConfigurationService,
  };
}

/**
 * Mock orchestrator IP resolver bound to the `ORCHESTRATOR_IP_RESOLVER`
 * token. The mock replaces the default URL-parse resolver with a
 * deterministic value so the dispatch service can complete its polling
 * loop without consulting the network.
 */
function makeIpResolver(): {
  resolver: IOrchestratorIpResolver;
  resolve: ReturnType<typeof vi.fn>;
} {
  const resolve = vi.fn().mockResolvedValue(RESOLVED_IP);
  return { resolver: { resolve }, resolve };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExecutionDispatchService', () => {
  let mocks: ReturnType<typeof makeMocks>;
  let ipResolver: ReturnType<typeof makeIpResolver>;
  let service: ExecutionDispatchService;
  let originalOrchestratorUrl: string | undefined;

  beforeEach(() => {
    mocks = makeMocks();
    ipResolver = makeIpResolver();

    originalOrchestratorUrl = process.env.ORCHESTRATOR_URL;
    process.env.ORCHESTRATOR_URL = ORCHESTRATOR_URL;

    service = new ExecutionDispatchService(
      mocks.executionRepository as never,
      mocks.eventPublisher as never,
      mocks.containerOrchestrator as never,
      mocks.containerHttpClient as never,
      ipResolver.resolver,
      mocks.thinkingLevelResolver as never,
      mocks.aiConfigurationService as never,
    );
  });

  afterEach(() => {
    if (originalOrchestratorUrl === undefined) {
      delete process.env.ORCHESTRATOR_URL;
    } else {
      process.env.ORCHESTRATOR_URL = originalOrchestratorUrl;
    }
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe('happy path', () => {
    it('returns an executionId immediately', async () => {
      const result = await service.dispatch(makeDispatchParams());

      expect(typeof result.executionId).toBe('string');
      expect(result.executionId.length).toBeGreaterThan(0);
    });

    it('persists an Execution record with the correct kind and state', async () => {
      await service.dispatch(
        makeDispatchParams({ kind: 'adhoc_chat', chatSessionId: 'sess-1' }),
      );

      expect(mocks.executionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'adhoc_chat',
          state: 'pending',
          chat_session_id: 'sess-1',
        }),
      );
    });

    it('emits execution.created synchronously before returning', async () => {
      await service.dispatch(makeDispatchParams({ chatSessionId: 'sess-2' }));

      expect(mocks.eventPublisher.created).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          kind: 'adhoc_chat',
          chat_session_id: 'sess-2',
        }),
      );
    });

    it('provisions a container and emits provisioning/provisioned after dispatch resolves', async () => {
      // Allow the background work to settle
      await service.dispatch(makeDispatchParams());
      await flushMicrotasks();

      expect(mocks.eventPublisher.provisioning).toHaveBeenCalled();
      expect(
        mocks.containerOrchestrator.provisionContainer,
      ).toHaveBeenCalledWith(makeContainerConfig(), true, true, undefined);
      expect(mocks.eventPublisher.provisioned).toHaveBeenCalledWith(
        expect.any(String),
        'container-123',
      );
    });

    it('calls executeAgent with background:true', async () => {
      const params = makeDispatchParams();
      await service.dispatch(params);
      await flushMicrotasks();

      expect(mocks.containerHttpClient.executeAgent).toHaveBeenCalledWith(
        `http://${RESOLVED_IP}:8374`,
        expect.objectContaining({
          background: true,
          provider: params.agentConfig.provider,
          model: params.agentConfig.model,
          stepId: expect.any(String),
        }),
      );
    });

    it('emits execution.running after a successful agent kickoff', async () => {
      await service.dispatch(makeDispatchParams());
      await flushMicrotasks();

      expect(mocks.eventPublisher.running).toHaveBeenCalledTimes(1);
    });

    it('drives state through events only — ExecutionProjector owns row transitions', async () => {
      await service.dispatch(makeDispatchParams());
      await flushMicrotasks();

      expect(mocks.eventPublisher.provisioning).toHaveBeenCalledWith(
        expect.any(String),
      );
      expect(mocks.eventPublisher.provisioned).toHaveBeenCalledWith(
        expect.any(String),
        'container-123',
      );
      expect(mocks.executionRepository.applyTransition).not.toHaveBeenCalled();
    });

    it('persists resolved provider/model from agentConfig on create', async () => {
      await service.dispatch(
        makeDispatchParams({
          kind: 'adhoc_chat',
          chatSessionId: 'chat-1',
          agentConfig: makeAgentConfig({
            provider: 'anthropic',
            model: 'claude-opus-4-8',
          }),
        }),
      );

      expect(mocks.executionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'anthropic',
          model: 'claude-opus-4-8',
        }),
      );
    });

    it('passes workflow_run_id when provided', async () => {
      await service.dispatch(
        makeDispatchParams({ kind: 'workflow_step', workflowRunId: 'run-99' }),
      );

      expect(mocks.executionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ workflow_run_id: 'run-99' }),
      );
      expect(mocks.eventPublisher.created).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ workflow_run_id: 'run-99' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // IP resolver wiring (Milestone 2)
  // -------------------------------------------------------------------------

  describe('orchestrator IP resolver wiring', () => {
    it('delegates IP resolution to the injected resolver using the orchestrator URL from env', async () => {
      await service.dispatch(makeDispatchParams());
      await flushMicrotasks();

      expect(ipResolver.resolve).toHaveBeenCalledWith(ORCHESTRATOR_URL);
    });

    it('uses the resolved IP when building the container base URL', async () => {
      await service.dispatch(makeDispatchParams());
      await flushMicrotasks();

      expect(mocks.containerHttpClient.buildBaseUrl).toHaveBeenCalledWith(
        RESOLVED_IP,
      );
    });

    it('does not invoke the resolver when the ORCHESTRATOR_URL env var is unset', async () => {
      delete process.env.ORCHESTRATOR_URL;

      await service.dispatch(makeDispatchParams());
      await flushMicrotasks();

      expect(ipResolver.resolve).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // thinkingLevel resolution
  // -------------------------------------------------------------------------

  describe('thinkingLevel resolution', () => {
    it('forwards the resolved thinking level to the agent request when the resolver returns a level', async () => {
      mocks.thinkingLevelResolver.resolve.mockResolvedValue({
        level: 'medium',
      });

      await service.dispatch(
        makeDispatchParams({ capabilities: { supportsThinkingLevels: true } }),
      );
      await flushMicrotasks();

      expect(mocks.containerHttpClient.executeAgent).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ thinkingLevel: 'medium' }),
      );
    });

    it('falls back to agentConfig.thinkingLevel when the resolver drops the level', async () => {
      mocks.thinkingLevelResolver.resolve.mockResolvedValue({ dropped: true });

      await service.dispatch(
        makeDispatchParams({
          agentConfig: makeAgentConfig({ thinkingLevel: 'low' }),
          capabilities: { supportsThinkingLevels: false },
        }),
      );
      await flushMicrotasks();

      expect(mocks.containerHttpClient.executeAgent).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ thinkingLevel: 'low' }),
      );
    });

    it('passes agentProfileName to aiConfigurationService when provided', async () => {
      await service.dispatch(
        makeDispatchParams({ agentProfileName: 'my-profile' }),
      );
      await flushMicrotasks();

      expect(
        mocks.aiConfigurationService.getAgentProfileByName,
      ).toHaveBeenCalledWith('my-profile');
    });

    it('skips profile lookup when agentProfileName is absent', async () => {
      await service.dispatch(makeDispatchParams());
      await flushMicrotasks();

      expect(
        mocks.aiConfigurationService.getAgentProfileByName,
      ).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Failure path: container provision fails
  // -------------------------------------------------------------------------

  describe('failure path — container provision fails', () => {
    beforeEach(() => {
      mocks.containerOrchestrator.provisionContainer.mockRejectedValue(
        new Error('Docker out of resources'),
      );
    });

    it('emits execution.failed with provision_failed reason', async () => {
      await service.dispatch(makeDispatchParams());
      await flushMicrotasks();

      expect(mocks.eventPublisher.failed).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          failure_reason: 'provision_failed',
          error_message: expect.stringContaining('Docker out of resources'),
        }),
      );
    });

    it('does not write row state directly on failure — the failed event drives it', async () => {
      await service.dispatch(makeDispatchParams());
      await flushMicrotasks();

      expect(mocks.executionRepository.applyTransition).not.toHaveBeenCalled();
    });

    it('does NOT emit execution.running', async () => {
      await service.dispatch(makeDispatchParams());
      await flushMicrotasks();

      expect(mocks.eventPublisher.running).not.toHaveBeenCalled();
    });

    it('does NOT attempt container cleanup when provision failed (no containerId)', async () => {
      await service.dispatch(makeDispatchParams());
      await flushMicrotasks();

      expect(mocks.containerOrchestrator.killContainer).not.toHaveBeenCalled();
      expect(
        mocks.containerOrchestrator.removeContainer,
      ).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Failure path: executeAgent returns non-ok
  // -------------------------------------------------------------------------

  describe('failure path — agent kickoff returns non-ok', () => {
    beforeEach(() => {
      mocks.containerHttpClient.executeAgent.mockResolvedValue({
        ok: false,
        response: '',
        error: 'harness refused to start',
      });
    });

    it('emits execution.failed when the agent endpoint returns ok:false', async () => {
      await service.dispatch(makeDispatchParams());
      await flushMicrotasks();

      expect(mocks.eventPublisher.failed).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ failure_reason: 'provision_failed' }),
      );
    });

    it('cleans up the container when a container was already started', async () => {
      await service.dispatch(makeDispatchParams());
      await flushMicrotasks();

      expect(mocks.containerOrchestrator.killContainer).toHaveBeenCalledWith(
        'container-123',
      );
      expect(mocks.containerOrchestrator.removeContainer).toHaveBeenCalledWith(
        'container-123',
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Utility: drain the microtask queue so fire-and-forget promises settle
// ---------------------------------------------------------------------------

async function flushMicrotasks(): Promise<void> {
  // Yield to the event loop multiple times to allow chained promises and
  // setImmediate callbacks to resolve.
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}
