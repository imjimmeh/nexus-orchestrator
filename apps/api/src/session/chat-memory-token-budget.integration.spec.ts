import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { ChatSessionSource } from '@nexus/core';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';
import { ChatSessionContextService } from './chat-session-context.service';
import { ChatSessionContextRefreshListener } from './chat-session-context-refresh.listener';
import { ChatSessionRepository } from '../chat/database/repositories/chat-session.repository';
import { ChatMessageRepository } from '../chat/database/repositories/chat-message.repository';
import { ChatSession } from '../chat/database/entities/chat-session.entity';
import {
  type ChatContextBlock,
  type IChatContextProvider,
} from './chat-context-providers/chat-context.provider.interface';
import { TokenCounterService } from '../memory/token-counter.service';
import { MemoryTokenBudgetResolver } from '../memory/memory-token-budget.resolver';
import { AiConfigurationService } from '../ai-config/ai-configuration.service';
import { ChatMemoryContextAssemblerService } from '../chat/memory/chat-memory-context-assembler.service';
import { ChatSessionMemoryRepository } from '../chat/database/repositories/chat-session-memory.repository';
import { ChatProfileMemoryRepository } from '../chat/database/repositories/chat-profile-memory.repository';
import { ChatMemoryMetricsService } from '../chat/memory/chat-memory-metrics.service';
import { SystemPromptAssemblyService } from '../system-prompt/system-prompt-assembly.service';

/**
 * Integration test for the **chat-side** `Session Context` and
 * `memory_context` paths that ship to the agent prompt.
 *
 * Milestone 1 wired `DistillationConsumer` and milestone 2 wired
 * `ChatSessionContextService` to consume `MemoryTokenBudgetResolver`.
 * The existing `apps/api/src/memory/memory-token-budget.integration.spec.ts`
 * only covers the resolver slice, `TokenCounterService.isOverThreshold`,
 * and `MemoryManagerService` (the distillation-side path) — it does
 * NOT cover the chat prompt rendering path that this milestone
 * (post-34c52b34) is responsible for.
 *
 * This spec exercises the **real** resolver + **real** token counter
 * + **real** `ChatSessionContextService` + **real**
 * `ChatMemoryContextAssemblerService` through NestJS DI (per the
 * project convention in `memory-token-budget.integration.spec.ts`),
 * stubbing only the persistence layer and the `IChatContextProvider`
 * registrations needed to produce a non-trivial set of blocks.
 *
 * Acceptance criteria for Milestone 3:
 *   1. The chat path's `Session Context` system message is bounded
 *      by `budget.memory` for a 200k-context model.
 *   2. The chat path's `Session Context` system message is bounded
 *      by `budget.memory` for a 128k-context model — this is the
 *      "explicit bug-fix evidence" pattern: before M2 the chat path
 *      had no cap, so a 150k payload would have been injected
 *      unchanged; the new resolver-driven path trims it to the
 *      model's 60% memory slice.
 *   3. The chat path's `memory_context` workflow-input block (assembled
 *      by `ChatMemoryContextAssemblerService`) agrees with the
 *      session-context path: both are bounded by `budget.memory`.
 *   4. The chat path is non-fatal when the resolver throws: it
 *      falls back to the unconstrained blocks and logs a warning,
 *      mirroring the resolver-failure semantics in the existing
 *      `ChatSessionContextService` unit spec and the resolver-failure
 *      test in `ChatMemoryContextAssemblerService`.
 *   5. The chat path's refresh path (`refreshContextMessage`,
 *      exercised directly so the listener is not required) is also
 *      bounded by `budget.memory`.
 */

interface ChatSessionRepoMock {
  findById: Mock;
  update: Mock;
  findAll: Mock;
}

interface ChatMessageRepoMock {
  create: Mock;
}

interface AiConfigMock {
  getModelForUseCase: Mock;
  getTokenLimit: Mock;
}

interface SessionMemoryRepoMock {
  findRecentBySession: Mock;
  touchAccessed: Mock;
}

interface ProfileMemoryRepoMock {
  findActiveByProfile: Mock;
  touchAccessed: Mock;
}

interface MetricsMock {
  recordRetrieval: Mock;
}

function makeAiConfigMock(
  tokenLimits: Record<string, number>,
  modelName: string,
): AiConfigMock {
  return {
    getModelForUseCase: vi.fn().mockResolvedValue(modelName),
    getTokenLimit: vi
      .fn()
      .mockImplementation((name: string) =>
        Promise.resolve(tokenLimits[name] ?? 0),
      ),
  };
}

function makeChatSessionRepoMock(): ChatSessionRepoMock {
  return {
    findById: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
    findAll: vi.fn().mockResolvedValue([]),
  };
}

function makeChatMessageRepoMock(): ChatMessageRepoMock {
  return {
    create: vi.fn().mockResolvedValue(undefined),
  };
}

function makeSessionMemoryRepoMock(): SessionMemoryRepoMock {
  return {
    findRecentBySession: vi.fn().mockResolvedValue([]),
    touchAccessed: vi.fn().mockResolvedValue(undefined),
  };
}

function makeProfileMemoryRepoMock(): ProfileMemoryRepoMock {
  return {
    findActiveByProfile: vi.fn().mockResolvedValue([]),
    touchAccessed: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMetricsMock(): MetricsMock {
  return {
    recordRetrieval: vi.fn(),
  };
}

/**
 * Build a content string that produces a target token count.
 *
 * The recipe is borrowed from the existing
 * `token-counter.service.spec.ts` and
 * `memory-token-budget.integration.spec.ts` so token counts are
 * deterministic across the test suite: the
 * `cl100k_base`/model-specific encoder produces a fixed number of
 * tokens per character run, and `repeat(N)` linearly scales the
 * output.
 *
 * Empirical calibration (matching the
 * `token-counter.service.spec.ts` `repeat(80)` × 30 entries =
 * ~140_000 tokens finding):
 *   - `repeat(80)`  ≈ 4_700 tokens per block
 *   - `repeat(86)`  ≈ 5_000 tokens per block
 *   - `repeat(688)` ≈ 40_000 tokens per block
 *   - `repeat(774)` ≈ 45_000 tokens per block
 *
 * The helper rounds to multiples of 86 to keep the diff between
 * "what we asked for" and "what tiktoken returned" sub-1% for the
 * sizes used by the assertions below.
 */
function buildLargeContent(targetTokens: number): string {
  const line =
    'apple banana cherry dog elephant fox grape house igloo jungle ' +
    'kettle lemon mango nest orange pear queen rabbit snake tree ' +
    'umbrella violet whale xenon yellow zebra alpha beta gamma delta ' +
    'epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho ' +
    'sigma tau upsilon phi chi psi omega';
  const repeats = Math.max(1, Math.round((targetTokens / 5_000) * 86));
  return line.repeat(repeats);
}

/**
 * Build a minimal `ChatSession` whose `model` field is forwarded to
 * `TokenCounterService.countTokens` by the chat path's
 * `boundBlocksByMemoryBudget` method. The session's `id` doubles as
 * the cache key, so it must be stable across calls within a test.
 */
function makeChatSession(id: string, model: string | null): ChatSession {
  return {
    id,
    scopeId: 'proj-200k',
    agent_profile_id: 'ap-200k',
    agent_profile_name: 'integration-agent',
    initial_message: 'integration test',
    status: 'RUNNING' as never,
    execution_state: 'starting',
    container_tier: 2,
    source: ChatSessionSource.AD_HOC,
    session_type: 'general' as never,
    model,
    created_at: new Date('2026-06-15T00:00:00.000Z'),
    updated_at: new Date('2026-06-15T00:00:00.000Z'),
  };
}

/**
 * Build a fresh `TestingModule` for the chat-session-context
 * service. The resolver, token counter, and chat-session-context
 * service are REAL; the persistence repositories are stubbed
 * in-memory; and the `AiConfigurationService` mock is configured
 * to surface a specific `modelName` and context window.
 *
 * Tests that need a non-default resolver (e.g. throw-on-resolve
 * for the resolver-failure test) can pass `resolverOverride` to
 * install a different provider at the `MemoryTokenBudgetResolver`
 * DI token.
 */
async function buildChatContextModule(options: {
  modelName: string;
  contextWindow: number;
  session: ChatSession;
  resolverOverride?: { resolve: Mock };
}): Promise<{
  module: TestingModule;
  service: ChatSessionContextService;
  resolver: MemoryTokenBudgetResolver;
  tokenCounter: TokenCounterService;
  chatSessionRepo: ChatSessionRepoMock;
  chatMessageRepo: ChatMessageRepoMock;
}> {
  const aiConfig = makeAiConfigMock(
    { [options.modelName]: options.contextWindow },
    options.modelName,
  );

  const chatSessionRepo = makeChatSessionRepoMock();
  chatSessionRepo.findById.mockResolvedValue(options.session);

  const chatMessageRepo = makeChatMessageRepoMock();

  const resolverOverride = options.resolverOverride;
  const resolverProvider = resolverOverride
    ? { provide: MemoryTokenBudgetResolver, useValue: resolverOverride }
    : {
        provide: MemoryTokenBudgetResolver,
        useFactory: (
          aiCfg: AiConfigurationService,
        ): MemoryTokenBudgetResolver => MemoryTokenBudgetResolver.create(aiCfg),
        inject: [AiConfigurationService],
      };

  const module = await Test.createTestingModule({
    providers: [
      ChatSessionContextService,
      TokenCounterService,
      SystemPromptAssemblyService,
      { provide: AiConfigurationService, useValue: aiConfig },
      { provide: ChatSessionRepository, useValue: chatSessionRepo },
      { provide: ChatMessageRepository, useValue: chatMessageRepo },
      resolverProvider,
    ],
  }).compile();

  const service = module.get<ChatSessionContextService>(
    ChatSessionContextService,
  );
  service.onModuleInit();

  const resolver = module.get<MemoryTokenBudgetResolver>(
    MemoryTokenBudgetResolver,
  );
  const tokenCounter = module.get<TokenCounterService>(TokenCounterService);

  return {
    module,
    service,
    resolver,
    tokenCounter,
    chatSessionRepo,
    chatMessageRepo,
  };
}

describe('ChatSessionContextService (chat-side memory token budget integration)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Test 1 (a): The dominant correctness assertion for the
   * 200k-context model. Three providers whose combined output is
   * ~135k tokens are registered; the chat path's
   * `boundBlocksByMemoryBudget` must drop blocks until the formatted
   * `Session Context` message fits inside `budget.memory` (60% of
   * 200_000 = 120_000 tokens).
   */
  it('caps the chat-path Session Context message to budget.memory for a 200k model', async () => {
    const session = makeChatSession('sess-200k', 'claude-sonnet-4-5');
    const {
      service,
      resolver,
      tokenCounter,
      chatMessageRepo,
      chatSessionRepo,
    } = await buildChatContextModule({
      modelName: 'claude-sonnet-4-5',
      contextWindow: 200_000,
      session,
    });

    const budget = await resolver.resolve();
    expect(budget.memory).toBe(120_000);

    const providerA: IChatContextProvider = {
      name: 'project',
      priority: 300,
      canProvide: vi.fn().mockResolvedValue(true),
      getContext: vi.fn().mockResolvedValue({
        title: 'Project Context',
        content: buildLargeContent(45_000),
        priority: 300,
        metadata: { provider: 'project' },
      }),
    };
    const providerB: IChatContextProvider = {
      name: 'tasks',
      priority: 200,
      canProvide: vi.fn().mockResolvedValue(true),
      getContext: vi.fn().mockResolvedValue({
        title: 'Active Tasks',
        content: buildLargeContent(45_000),
        priority: 200,
        metadata: { provider: 'tasks' },
      }),
    };
    const providerC: IChatContextProvider = {
      name: 'history',
      priority: 100,
      canProvide: vi.fn().mockResolvedValue(true),
      getContext: vi.fn().mockResolvedValue({
        title: 'History',
        content: buildLargeContent(45_000),
        priority: 100,
        metadata: { provider: 'history' },
      }),
    };
    service.registerProvider('project', providerA);
    service.registerProvider('tasks', providerB);
    service.registerProvider('history', providerC);

    const formatted = await service.injectContextMessage('sess-200k');

    expect(resolver).toBeDefined();

    const finalTokenCount = tokenCounter.countTokens(
      formatted,
      'claude-sonnet-4-5',
    );
    expect(finalTokenCount).toBeLessThanOrEqual(120_000);

    // Drop strategy: lower-priority blocks dropped first. The
    // `history` block is dropped, retaining `project` and `tasks`.
    expect(formatted).toContain('## Project Context');
    expect(formatted).toContain('## Active Tasks');
    expect(formatted).not.toContain('## History');

    const createCall = chatMessageRepo.create.mock.calls[0]?.[0] as
      | { text: string }
      | undefined;
    expect(createCall).toBeDefined();
    expect(createCall?.text).toContain('## Project Context');
    expect(createCall?.text).not.toContain('## History');

    // The `chat_sessions.context_metadata` snapshot reflects the
    // bounded block set.
    const updateCall = chatSessionRepo.update.mock.calls[0];
    expect(updateCall).toBeDefined();
    const updatePayload = updateCall?.[1] as
      | {
          context_metadata?: {
            providers_used: string[];
            block_count: number;
          };
        }
      | undefined;
    expect(updatePayload?.context_metadata).toBeDefined();
    expect(updatePayload?.context_metadata?.block_count).toBe(2);
    expect(updatePayload?.context_metadata?.providers_used).toEqual([
      'project',
      'tasks',
    ]);
  });

  /**
   * Test 1 (b): Explicit bug-fix evidence.
   *
   * Before Milestone 2, the chat path had NO budget cap. A 135k
   * payload would have been injected as the first system message
   * unchanged, pushing the downstream agent prompt past the
   * active model's context window.
   *
   * With the resolver-driven cap wired through the chat path, the
   * same 135k payload on a 128k-context model is trimmed to the
   * model's 60% memory slice (76_800 tokens) — the lowest-priority
   * blocks are dropped one at a time until the formatted message
   * fits.
   */
  it('caps the chat-path Session Context message to budget.memory for a 128k model (bug-fix evidence)', async () => {
    const session = makeChatSession('sess-128k', 'claude-sonnet-128k');
    const { service, resolver, tokenCounter } = await buildChatContextModule({
      modelName: 'claude-sonnet-128k',
      contextWindow: 128_000,
      session,
    });

    const budget = await resolver.resolve();
    expect(budget.memory).toBe(76_800);
    expect(budget.memory).not.toBe(128_000);

    const providerA: IChatContextProvider = {
      name: 'project',
      priority: 300,
      canProvide: vi.fn().mockResolvedValue(true),
      getContext: vi.fn().mockResolvedValue({
        title: 'Project Context',
        content: buildLargeContent(45_000),
        priority: 300,
        metadata: { provider: 'project' },
      }),
    };
    const providerB: IChatContextProvider = {
      name: 'tasks',
      priority: 200,
      canProvide: vi.fn().mockResolvedValue(true),
      getContext: vi.fn().mockResolvedValue({
        title: 'Active Tasks',
        content: buildLargeContent(45_000),
        priority: 200,
        metadata: { provider: 'tasks' },
      }),
    };
    const providerC: IChatContextProvider = {
      name: 'history',
      priority: 100,
      canProvide: vi.fn().mockResolvedValue(true),
      getContext: vi.fn().mockResolvedValue({
        title: 'History',
        content: buildLargeContent(45_000),
        priority: 100,
        metadata: { provider: 'history' },
      }),
    };
    service.registerProvider('project', providerA);
    service.registerProvider('tasks', providerB);
    service.registerProvider('history', providerC);

    const formatted = await service.buildContextMessage('sess-128k');

    const finalTokenCount = tokenCounter.countTokens(
      formatted,
      'claude-sonnet-128k',
    );
    expect(finalTokenCount).toBeLessThanOrEqual(76_800);
    expect(finalTokenCount).toBeLessThan(150_000);

    // Drop strategy: 128k cap is tighter than 200k cap, so both
    // lower-priority blocks are dropped, leaving only `project`.
    expect(formatted).toContain('## Project Context');
    expect(formatted).not.toContain('## Active Tasks');
    expect(formatted).not.toContain('## History');
  });

  /**
   * Test 2: The chat path's `memory_context` workflow-input block
   * (assembled by `ChatMemoryContextAssemblerService`) MUST agree
   * with the session-context path: both are bounded by
   * `budget.memory`. The 200k model → 120_000-token memory slice.
   */
  it('agrees with ChatMemoryContextAssemblerService on budget.memory for a 200k model', async () => {
    const modelName = 'claude-sonnet-4-5';
    const contextWindow = 200_000;
    const aiConfig = makeAiConfigMock(
      { [modelName]: contextWindow },
      modelName,
    );

    const resolver = MemoryTokenBudgetResolver.create(
      aiConfig as unknown as AiConfigurationService,
    );
    const tokenCounter = new TokenCounterService(
      aiConfig as unknown as AiConfigurationService,
      resolver,
    );

    const sessionMemory = makeSessionMemoryRepoMock();
    const profileMemory = makeProfileMemoryRepoMock();
    const metrics = makeMetricsMock();

    const memoryContent = buildLargeContent(45_000);
    sessionMemory.findRecentBySession.mockResolvedValue([
      {
        id: 'session-memory-1',
        memory_type: 'history',
        content: memoryContent,
        normalized_content: memoryContent.toLowerCase(),
        importance_score: 95,
        created_at: new Date('2026-06-15T00:00:00.000Z'),
      },
      {
        id: 'session-memory-2',
        memory_type: 'fact',
        content: memoryContent,
        normalized_content: memoryContent.toLowerCase(),
        importance_score: 92,
        created_at: new Date('2026-06-15T00:00:00.000Z'),
      },
      {
        id: 'session-memory-3',
        memory_type: 'preference',
        content: memoryContent,
        normalized_content: memoryContent.toLowerCase(),
        importance_score: 90,
        created_at: new Date('2026-06-15T00:00:00.000Z'),
      },
    ]);

    const assembler = new ChatMemoryContextAssemblerService(
      sessionMemory as never,
      profileMemory as never,
      metrics as never,
      resolver,
    );

    const budget = await resolver.resolve();
    expect(budget.memory).toBe(120_000);

    const context = await assembler.assembleContext({
      chatSessionId: 'chat-200k',
      profileId: 'profile-200k',
      prompt: 'integration test query that matches none of the memory tokens',
    });

    expect(context.retrieval.tokenBudget).toBe(120_000);

    const totalCharacters = context.slices.reduce(
      (acc, slice) => acc + slice.content.length,
      0,
    );
    expect(totalCharacters).toBeLessThanOrEqual(120_000 * 4);

    const sessionContextBudget = await resolver.resolve();
    expect(context.retrieval.tokenBudget).toBe(sessionContextBudget.memory);

    const session = makeChatSession('sess-shared', modelName);
    const { service: chatService } = await buildChatContextModule({
      modelName,
      contextWindow,
      session,
    });

    const provider: IChatContextProvider = {
      name: 'memory',
      priority: 100,
      canProvide: vi.fn().mockResolvedValue(true),
      getContext: vi.fn().mockResolvedValue({
        title: 'Memory',
        content: buildLargeContent(10_000),
        priority: 100,
        metadata: { provider: 'memory' },
      }),
    };
    chatService.registerProvider('memory', provider);

    const chatMessage = await chatService.buildContextMessage('sess-shared');
    const chatMessageTokens = tokenCounter.countTokens(chatMessage, modelName);

    expect(chatMessageTokens).toBeLessThanOrEqual(120_000);

    expect(context.retrieval.tokenBudget).toBe(budget.memory);
  });

  /**
   * Test 3: The chat path is non-fatal when the resolver throws.
   * Mirrors the resolver-failure semantics in the existing
   * `ChatSessionContextService` unit spec and the
   * `ChatMemoryContextAssemblerService` resolver-failure test.
   */
  it('falls back to unconstrained blocks with a warning when the resolver throws', async () => {
    const session = makeChatSession('sess-throw', 'claude-sonnet-4-5');

    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    const resolverOverride: { resolve: Mock } = {
      resolve: vi.fn().mockRejectedValue(new Error('no active model')),
    };

    const { service } = await buildChatContextModule({
      modelName: 'claude-sonnet-4-5',
      contextWindow: 200_000,
      session,
      resolverOverride,
    });

    const provider: IChatContextProvider = {
      name: 'project',
      priority: 200,
      canProvide: vi.fn().mockResolvedValue(true),
      getContext: vi.fn().mockResolvedValue({
        title: 'Project Context',
        content: 'small content that would otherwise be retained',
        priority: 200,
        metadata: { provider: 'project' },
      }),
    };
    service.registerProvider('project', provider);

    const formatted = await service.buildContextMessage('sess-throw');

    expect(formatted).toContain('## Project Context');
    expect(formatted).toContain(
      'small content that would otherwise be retained',
    );

    const warnCalls = warn.mock.calls.flat();
    const warnMessages = warnCalls.filter(
      (value): value is string => typeof value === 'string',
    );
    expect(
      warnMessages.some(
        (message) =>
          message.includes('MemoryTokenBudgetResolver') &&
          message.includes('sess-throw'),
      ),
    ).toBe(true);

    expect(resolverOverride.resolve).toHaveBeenCalledTimes(1);
  });

  /**
   * Test 4: The refresh path is also bounded by `budget.memory`.
   *
   * `ChatSessionContextRefreshListener.refreshSessionContext` calls
   * `ChatSessionContextService.refreshContextMessage`, which clears
   * the cache and re-runs `buildContextMessage`. The cache clear
   * means the budget cap is re-evaluated for the new context
   * message; the assertion below is that the refresh path's
   * formatted message is bounded by the same `budget.memory` as
   * the initial build path.
   */
  it('caps the refreshed Session Context message to budget.memory for a 200k model', async () => {
    const session = makeChatSession('sess-refresh', 'claude-sonnet-4-5');
    const { service, chatMessageRepo } = await buildChatContextModule({
      modelName: 'claude-sonnet-4-5',
      contextWindow: 200_000,
      session,
    });

    const providerA: IChatContextProvider = {
      name: 'project',
      priority: 300,
      canProvide: vi.fn().mockResolvedValue(true),
      getContext: vi.fn().mockResolvedValue({
        title: 'Project Context',
        content: buildLargeContent(45_000),
        priority: 300,
        metadata: { provider: 'project' },
      }),
    };
    const providerB: IChatContextProvider = {
      name: 'tasks',
      priority: 200,
      canProvide: vi.fn().mockResolvedValue(true),
      getContext: vi.fn().mockResolvedValue({
        title: 'Active Tasks',
        content: buildLargeContent(45_000),
        priority: 200,
        metadata: { provider: 'tasks' },
      }),
    };
    const providerC: IChatContextProvider = {
      name: 'history',
      priority: 100,
      canProvide: vi.fn().mockResolvedValue(true),
      getContext: vi.fn().mockResolvedValue({
        title: 'History',
        content: buildLargeContent(45_000),
        priority: 100,
        metadata: { provider: 'history' },
      }),
    };
    service.registerProvider('project', providerA);
    service.registerProvider('tasks', providerB);
    service.registerProvider('history', providerC);

    const initial = await service.buildContextMessage('sess-refresh');
    expect(initial).toContain('## Project Context');
    expect(initial).not.toContain('## History');

    await service.refreshContextMessage('sess-refresh', 'integration test');

    const refreshCreateCall = chatMessageRepo.create.mock.calls.find((call) => {
      const arg = call[0] as { event_type?: string } | undefined;
      return arg?.event_type === 'context_refreshed';
    });
    expect(refreshCreateCall).toBeDefined();
    const refreshText = (refreshCreateCall?.[0] as { text: string }).text;
    expect(refreshText).toContain('## Project Context');
    expect(refreshText).not.toContain('## History');

    expect(providerA.getContext).toHaveBeenCalledTimes(2);
    expect(providerB.getContext).toHaveBeenCalledTimes(2);
    expect(providerC.getContext).toHaveBeenCalledTimes(2);

    expect(service).toBeDefined();
    const chatSessionRepo = makeChatSessionRepoMock();
    chatSessionRepo.findAll.mockResolvedValue([]);
    const listener = new ChatSessionContextRefreshListener(
      service,
      chatSessionRepo as never,
    );
    expect(listener).toBeDefined();
  });
});
