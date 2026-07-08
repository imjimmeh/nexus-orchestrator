import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { vi } from 'vitest';
import { ChatSessionSource } from '@nexus/core';
import { ChatSessionContextService } from './chat-session-context.service';
import { ChatSessionRepository } from '../chat/database/repositories/chat-session.repository';
import { ChatMessageRepository } from '../chat/database/repositories/chat-message.repository';
import { ChatSession } from '../chat/database/entities/chat-session.entity';
import {
  ChatContextBlock,
  type IChatContextProvider,
} from './chat-context-providers/chat-context.provider.interface';
import { MemoryTokenBudgetResolver } from '../memory/memory-token-budget.resolver';
import { TokenCounterService } from '../memory/token-counter.service';
import type { MemoryTokenBudget } from '../memory/memory-token-budget.resolver.types';
import { AiConfigurationService } from '../ai-config/ai-configuration.service';
import { SystemPromptAssemblyService } from '../system-prompt/system-prompt-assembly.service';

/**
 * Build a content string that produces a target token count.
 *
 * The recipe is borrowed from the existing
 * `token-counter.service.spec.ts` and
 * `memory-token-budget.integration.spec.ts` so token counts are
 * deterministic across the test suite: tiktoken's `cl100k_base` /
 * model-specific encoder produces a fixed number of tokens per
 * character run, and `repeat(N)` linearly scales the output.
 *
 * Empirical calibration (matching the
 * `token-counter.service.spec.ts` `repeat(80)` × 30 entries =
 * ~140_000 tokens finding):
 *   - `repeat(86)`  ≈ 5_000 tokens per block
 *   - `repeat(688)` ≈ 40_000 tokens per block
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

describe('ChatSessionContextService', () => {
  let service: ChatSessionContextService;
  let mockChatSessionRepo: {
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let mockChatMessageRepo: {
    create: ReturnType<typeof vi.fn>;
  };
  let mockAiConfig: {
    getModelForUseCase: ReturnType<typeof vi.fn>;
    getTokenLimit: ReturnType<typeof vi.fn>;
  };
  let resolver: MemoryTokenBudgetResolver;
  let tokenCounter: TokenCounterService;
  let mockProjectContextProvider: {
    name: string;
    priority: number;
    cacheTtlSeconds: number;
    canProvide: ReturnType<typeof vi.fn>;
    getContext: ReturnType<typeof vi.fn>;
  };
  let mockExternalContextProvider: {
    name: string;
    priority: number;
    cacheTtlSeconds: number;
    canProvide: ReturnType<typeof vi.fn>;
    getContext: ReturnType<typeof vi.fn>;
  };
  let mockSteeringContextProvider: {
    name: string;
    priority: number;
    cacheTtlSeconds: number;
    canProvide: ReturnType<typeof vi.fn>;
    getContext: ReturnType<typeof vi.fn>;
  };

  const mockSession: ChatSession = {
    id: 'sess-123',
    scopeId: 'proj-123',
    agent_profile_id: 'ap-123',
    agent_profile_name: 'test-agent',
    initial_message: 'test message',
    status: 'RUNNING' as any,
    execution_state: 'starting',
    container_tier: 2,
    source: ChatSessionSource.AD_HOC,
    session_type: 'general' as any,
    created_at: new Date(),
    updated_at: new Date(),
  };

  const mockProjectBlock: ChatContextBlock = {
    title: 'Project Context',
    content: 'Test project context',
    priority: 200,
    metadata: { provider: 'project' },
  };

  const mockExternalBlock: ChatContextBlock = {
    title: 'Active Work Items',
    content: 'Test work items',
    priority: 150,
    metadata: { provider: 'external' },
  };

  /**
   * Build a chat session that carries a `model` so the
   * `MemoryTokenBudgetResolver`-driven cap can resolve the right
   * token limit. The model name is forwarded to
   * `TokenCounterService.countTokens` by the chat path's
   * `boundBlocksByMemoryBudget` method.
   */
  function makeSessionWithModel(id: string, model: string | null): ChatSession {
    return {
      ...mockSession,
      id,
      model,
    };
  }

  /**
   * Build a `MemoryTokenBudget` slice with the supplied `memory`
   * slice. The other slices are filled so the three-way invariant
   * `memory + working + reserved === contextWindow` holds and the
   * resolver-shaped types stay internally consistent for any
   * downstream consumer.
   */
  function makeBudget(
    memory: number,
    contextWindow: number,
  ): MemoryTokenBudget {
    const working = Math.floor(0.3 * contextWindow);
    const reserved = contextWindow - memory - working;
    return {
      contextWindow,
      memory,
      working,
      reserved,
      memoryPercent: 60,
      workingPercent: 30,
      reservedPercent: 10,
    };
  }

  beforeEach(async () => {
    mockChatSessionRepo = {
      findById: vi.fn(),
      update: vi.fn(),
    };

    mockChatMessageRepo = {
      create: vi.fn(),
    };

    // The default mock `AiConfigurationService` is wired so the
    // resolver falls into its documented 128_000-token fallback path.
    // Tests that exercise a specific model override the
    // `getTokenLimit` mock below.
    mockAiConfig = {
      getModelForUseCase: vi.fn().mockResolvedValue(''),
      getTokenLimit: vi.fn().mockResolvedValue(0),
    };

    resolver = MemoryTokenBudgetResolver.create(
      mockAiConfig as unknown as AiConfigurationService,
    );
    tokenCounter = new TokenCounterService(
      mockAiConfig as unknown as AiConfigurationService,
      resolver,
    );

    mockProjectContextProvider = {
      name: 'project',
      priority: 200,
      cacheTtlSeconds: 300,
      canProvide: vi.fn(),
      getContext: vi.fn(),
    };

    mockExternalContextProvider = {
      name: 'external',
      priority: 150,
      cacheTtlSeconds: 600,
      canProvide: vi.fn(),
      getContext: vi.fn(),
    };

    mockSteeringContextProvider = {
      name: 'steering',
      priority: 175,
      cacheTtlSeconds: 300,
      canProvide: vi.fn(),
      getContext: vi.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        ChatSessionContextService,
        TokenCounterService,
        SystemPromptAssemblyService,
        { provide: ChatSessionRepository, useValue: mockChatSessionRepo },
        { provide: ChatMessageRepository, useValue: mockChatMessageRepo },
        { provide: AiConfigurationService, useValue: mockAiConfig },
        { provide: MemoryTokenBudgetResolver, useValue: resolver },
      ],
    }).compile();

    service = module.get(ChatSessionContextService);
    service.onModuleInit();
    service.registerProvider('project', mockProjectContextProvider);
    service.registerProvider('external', mockExternalContextProvider);
    service.registerProvider('steering', mockSteeringContextProvider);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('buildContextMessage', () => {
    it('returns formatted markdown message with blocks from applicable providers', async () => {
      mockChatSessionRepo.findById.mockResolvedValue(mockSession);
      mockProjectContextProvider.canProvide.mockResolvedValue(true);
      mockProjectContextProvider.getContext.mockResolvedValue(mockProjectBlock);
      mockExternalContextProvider.canProvide.mockResolvedValue(true);
      mockExternalContextProvider.getContext.mockResolvedValue(
        mockExternalBlock,
      );

      const result = await service.buildContextMessage('sess-123');

      expect(result).toContain('# Session Context');
      expect(result).toContain('## Project Context');
      expect(result).toContain('Test project context');
      expect(result).toContain('## Active Work Items');
      expect(result).toContain('Test work items');
    });

    it('throws if session not found', async () => {
      mockChatSessionRepo.findById.mockResolvedValue(null);

      await expect(service.buildContextMessage('missing')).rejects.toThrow(
        'Chat session missing not found',
      );
    });

    it('sorts blocks by priority (higher first)', async () => {
      mockChatSessionRepo.findById.mockResolvedValue(mockSession);
      mockProjectContextProvider.canProvide.mockResolvedValue(true);
      mockProjectContextProvider.getContext.mockResolvedValue({
        ...mockProjectBlock,
        priority: 100,
      });
      mockExternalContextProvider.canProvide.mockResolvedValue(true);
      mockExternalContextProvider.getContext.mockResolvedValue({
        ...mockExternalBlock,
        priority: 200,
      });

      const result = await service.buildContextMessage('sess-123');

      // Higher priority (200) should appear first
      const projectIndex = result.indexOf('## Active Work Items');
      const externalIndex = result.indexOf('## Project Context');
      expect(projectIndex).toBeLessThan(externalIndex);
    });

    it('handles provider failures gracefully', async () => {
      mockChatSessionRepo.findById.mockResolvedValue(mockSession);
      mockProjectContextProvider.canProvide.mockResolvedValue(true);
      mockProjectContextProvider.getContext.mockRejectedValue(
        new Error('Provider error'),
      );
      mockExternalContextProvider.canProvide.mockResolvedValue(true);
      mockExternalContextProvider.getContext.mockResolvedValue(
        mockExternalBlock,
      );

      const result = await service.buildContextMessage('sess-123');

      expect(result).toContain('## project (Error)');
      expect(result).toContain('Provider error');
      expect(result).toContain('## Active Work Items');
    });

    it('caches blocks and respects TTL', async () => {
      mockChatSessionRepo.findById.mockResolvedValue(mockSession);
      mockProjectContextProvider.canProvide.mockResolvedValue(true);
      mockProjectContextProvider.getContext.mockResolvedValue(mockProjectBlock);
      mockExternalContextProvider.canProvide.mockResolvedValue(true);
      mockExternalContextProvider.getContext.mockResolvedValue(
        mockExternalBlock,
      );

      // First call
      await service.buildContextMessage('sess-123');
      expect(mockProjectContextProvider.getContext).toHaveBeenCalledTimes(1);

      // Second call should use cache
      await service.buildContextMessage('sess-123');
      expect(mockProjectContextProvider.getContext).toHaveBeenCalledTimes(1);

      // Verify cache key was set
      expect(mockChatSessionRepo.findById).toHaveBeenCalledTimes(2);
    });
  });

  describe('injectContextMessage', () => {
    it('creates system message and updates session metadata', async () => {
      mockChatSessionRepo.findById.mockResolvedValue(mockSession);
      mockProjectContextProvider.canProvide.mockResolvedValue(true);
      mockProjectContextProvider.getContext.mockResolvedValue(mockProjectBlock);
      mockExternalContextProvider.canProvide.mockResolvedValue(false);

      await service.injectContextMessage('sess-123');

      expect(mockChatMessageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          chat_session_id: 'sess-123',
          direction: 'outbound',
          sender: 'system',
          event_type: 'context_injected',
          text: expect.stringContaining('# Session Context'),
          channel: 'api',
          metadata: expect.objectContaining({
            auto_generated: true,
            version: 'v1',
          }),
        }),
      );

      expect(mockChatSessionRepo.update).toHaveBeenCalledWith(
        'sess-123',
        expect.objectContaining({
          context_metadata: expect.objectContaining({
            providers_used: ['project'],
            block_count: 1,
            version: 'v1',
          }),
        }),
      );
    });
  });

  describe('refreshContextMessage', () => {
    it('clears cache and creates refresh message', async () => {
      mockChatSessionRepo.findById.mockResolvedValue(mockSession);
      mockProjectContextProvider.canProvide.mockResolvedValue(true);
      mockProjectContextProvider.getContext.mockResolvedValue(mockProjectBlock);
      mockExternalContextProvider.canProvide.mockResolvedValue(false);

      // Prime the cache
      await service.buildContextMessage('sess-123');
      expect(mockProjectContextProvider.getContext).toHaveBeenCalledTimes(1);

      // Refresh should clear cache and reload
      await service.refreshContextMessage('sess-123', 'test reason');

      expect(mockProjectContextProvider.getContext).toHaveBeenCalledTimes(2);

      expect(mockChatMessageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: 'context_refreshed',
          metadata: expect.objectContaining({
            reason: 'test reason',
          }),
        }),
      );
    });
  });

  describe('registerProvider', () => {
    it('allows registering custom providers at runtime', async () => {
      const customProvider = {
        name: 'custom',
        priority: 50,
        canProvide: vi.fn().mockResolvedValue(true),
        getContext: vi.fn().mockResolvedValue({
          title: 'Custom',
          content: 'Custom context',
          priority: 50,
        }),
      };

      service.registerProvider('custom', customProvider);

      mockChatSessionRepo.findById.mockResolvedValue(mockSession);
      mockProjectContextProvider.canProvide.mockResolvedValue(false);
      mockExternalContextProvider.canProvide.mockResolvedValue(false);

      const result = await service.buildContextMessage('sess-123');

      expect(result).toContain('## Custom');
      expect(result).toContain('Custom context');
      expect(customProvider.getContext).toHaveBeenCalled();
    });
  });

  /**
   * Contract tests for the Milestone 2 / M2 wiring: the chat-side
   * `Session Context` message must be bounded by `budget.memory` for
   * the active model so the block that ships to the agent prompt
   * never exceeds the resolver's memory slice. The full prompt-
   * rendering path integration test lives in M3
   * (`chat-memory-token-budget.integration.spec.ts`); the unit-level
   * contract below asserts the chat service honours the cap on its
   * own.
   */
  describe('memory token budget cap (M2 wiring)', () => {
    it('keeps every block when the assembled message fits within budget.memory', async () => {
      const session = makeSessionWithModel('sess-fits', 'unknown-model');
      mockChatSessionRepo.findById.mockResolvedValue(session);
      mockProjectContextProvider.canProvide.mockResolvedValue(true);
      mockProjectContextProvider.getContext.mockResolvedValue(mockProjectBlock);
      mockExternalContextProvider.canProvide.mockResolvedValue(true);
      mockExternalContextProvider.getContext.mockResolvedValue(
        mockExternalBlock,
      );

      const result = await service.buildContextMessage('sess-fits');

      expect(result).toContain('## Project Context');
      expect(result).toContain('## Active Work Items');
    });

    it('drops the lowest-priority block when the assembled message exceeds budget.memory', async () => {
      // Configure the resolver to report a tiny memory slice so the
      // single small block also needs trimming. The drop order is
      // priority-ascending (lowest first), so the
      // `mockExternalContextProvider` block (priority 150) is dropped
      // before the `mockProjectContextProvider` block (priority 200).
      const tinyResolver = {
        resolve: vi.fn().mockResolvedValue(makeBudget(1, 100)),
      };

      const module = await Test.createTestingModule({
        providers: [
          ChatSessionContextService,
          TokenCounterService,
          SystemPromptAssemblyService,
          { provide: ChatSessionRepository, useValue: mockChatSessionRepo },
          { provide: ChatMessageRepository, useValue: mockChatMessageRepo },
          { provide: AiConfigurationService, useValue: mockAiConfig },
          { provide: MemoryTokenBudgetResolver, useValue: tinyResolver },
        ],
      }).compile();

      const localService = module.get(ChatSessionContextService);
      localService.onModuleInit();
      localService.registerProvider(
        'project',
        mockProjectContextProvider as unknown as IChatContextProvider,
      );
      localService.registerProvider(
        'external',
        mockExternalContextProvider as unknown as IChatContextProvider,
      );
      localService.registerProvider(
        'steering',
        mockSteeringContextProvider as unknown as IChatContextProvider,
      );

      const session = makeSessionWithModel('sess-tight', 'unknown-model');
      mockChatSessionRepo.findById.mockResolvedValue(session);
      mockProjectContextProvider.canProvide.mockResolvedValue(true);
      mockProjectContextProvider.getContext.mockResolvedValue(mockProjectBlock);
      mockExternalContextProvider.canProvide.mockResolvedValue(true);
      mockExternalContextProvider.getContext.mockResolvedValue(
        mockExternalBlock,
      );
      mockSteeringContextProvider.canProvide.mockResolvedValue(true);
      mockSteeringContextProvider.getContext.mockResolvedValue({
        title: 'Steering',
        content: 'Steering context',
        priority: 175,
        metadata: { provider: 'steering' },
      });

      const result = await localService.buildContextMessage('sess-tight');

      // Steering (175) and External (150) are both dropped before
      // Project (200). With the configured 1-token cap the chat
      // path keeps only the highest-priority block.
      expect(result).toContain('## Project Context');
      expect(result).not.toContain('## Active Work Items');
      expect(result).not.toContain('## Steering');
      expect(tinyResolver.resolve).toHaveBeenCalled();
    });

    it('caps a 200k-context model to the 60% memory slice (budget.memory === 120_000)', async () => {
      // Configure the resolver to report a 200k-context budget with
      // the documented 60% memory slice (120_000 tokens). Three
      // ~45_000-token blocks together exceed the slice; the chat
      // path must drop the lowest-priority block to fit.
      const twoHundredKResolver = {
        resolve: vi.fn().mockResolvedValue(makeBudget(120_000, 200_000)),
      };

      const module = await Test.createTestingModule({
        providers: [
          ChatSessionContextService,
          TokenCounterService,
          SystemPromptAssemblyService,
          { provide: ChatSessionRepository, useValue: mockChatSessionRepo },
          { provide: ChatMessageRepository, useValue: mockChatMessageRepo },
          { provide: AiConfigurationService, useValue: mockAiConfig },
          { provide: MemoryTokenBudgetResolver, useValue: twoHundredKResolver },
        ],
      }).compile();

      const localService = module.get(ChatSessionContextService);
      localService.onModuleInit();

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
      localService.registerProvider('project', providerA);
      localService.registerProvider('tasks', providerB);
      localService.registerProvider('history', providerC);

      const session = makeSessionWithModel(
        'sess-cap-200k',
        'claude-sonnet-4-5',
      );
      mockChatSessionRepo.findById.mockResolvedValue(session);

      const formatted = await localService.buildContextMessage('sess-cap-200k');

      const tokenCount = tokenCounter.countTokens(
        formatted,
        'claude-sonnet-4-5',
      );
      expect(tokenCount).toBeLessThanOrEqual(120_000);

      // Lowest-priority block dropped first.
      expect(formatted).toContain('## Project Context');
      expect(formatted).toContain('## Active Tasks');
      expect(formatted).not.toContain('## History');
    });

    it('caps a 128k-context model to its 60% memory slice (budget.memory === 76_800)', async () => {
      // Same 3 × ~45_000-token payload on a 128k-context model. The
      // 60% slice is 76_800 tokens — the chat path must drop two
      // blocks to fit.
      const oneTwentyEightKResolver = {
        resolve: vi.fn().mockResolvedValue(makeBudget(76_800, 128_000)),
      };

      const module = await Test.createTestingModule({
        providers: [
          ChatSessionContextService,
          TokenCounterService,
          SystemPromptAssemblyService,
          { provide: ChatSessionRepository, useValue: mockChatSessionRepo },
          { provide: ChatMessageRepository, useValue: mockChatMessageRepo },
          { provide: AiConfigurationService, useValue: mockAiConfig },
          {
            provide: MemoryTokenBudgetResolver,
            useValue: oneTwentyEightKResolver,
          },
        ],
      }).compile();

      const localService = module.get(ChatSessionContextService);
      localService.onModuleInit();

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
      localService.registerProvider('project', providerA);
      localService.registerProvider('tasks', providerB);
      localService.registerProvider('history', providerC);

      const session = makeSessionWithModel(
        'sess-cap-128k',
        'claude-sonnet-128k',
      );
      mockChatSessionRepo.findById.mockResolvedValue(session);

      const formatted = await localService.buildContextMessage('sess-cap-128k');

      const tokenCount = tokenCounter.countTokens(
        formatted,
        'claude-sonnet-128k',
      );
      expect(tokenCount).toBeLessThanOrEqual(76_800);

      expect(formatted).toContain('## Project Context');
      expect(formatted).not.toContain('## Active Tasks');
      expect(formatted).not.toContain('## History');
    });

    it('falls back to unconstrained blocks and logs a warning when the resolver throws', async () => {
      const throwingResolver = {
        resolve: vi.fn().mockRejectedValue(new Error('no active model')),
      };

      const module = await Test.createTestingModule({
        providers: [
          ChatSessionContextService,
          TokenCounterService,
          SystemPromptAssemblyService,
          { provide: ChatSessionRepository, useValue: mockChatSessionRepo },
          { provide: ChatMessageRepository, useValue: mockChatMessageRepo },
          { provide: AiConfigurationService, useValue: mockAiConfig },
          { provide: MemoryTokenBudgetResolver, useValue: throwingResolver },
        ],
      }).compile();

      const localService = module.get(ChatSessionContextService);
      localService.onModuleInit();
      localService.registerProvider(
        'project',
        mockProjectContextProvider as unknown as IChatContextProvider,
      );

      const session = makeSessionWithModel('sess-throws', 'unknown-model');
      mockChatSessionRepo.findById.mockResolvedValue(session);
      mockProjectContextProvider.canProvide.mockResolvedValue(true);
      mockProjectContextProvider.getContext.mockResolvedValue(mockProjectBlock);

      // The chat path logs the resolver failure on the service's
      // `Logger`. Spying on `Logger.prototype.warn` mirrors the
      // pattern in the resolver-failure integration test.
      const warnSpy = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      const formatted = await localService.buildContextMessage('sess-throws');

      expect(formatted).toContain('## Project Context');
      expect(throwingResolver.resolve).toHaveBeenCalledTimes(1);

      const warnMessages = warnSpy.mock.calls
        .map((call) => call[0])
        .filter((value): value is string => typeof value === 'string');
      expect(
        warnMessages.some(
          (message) =>
            message.includes('MemoryTokenBudgetResolver') &&
            message.includes('sess-throws'),
        ),
      ).toBe(true);
    });
  });
});

describe('ChatSessionContextService delegates to the assembly seam', () => {
  let mockChatSessionRepo: {
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let mockChatMessageRepo: {
    create: ReturnType<typeof vi.fn>;
  };
  let mockAiConfig: {
    getModelForUseCase: ReturnType<typeof vi.fn>;
    getTokenLimit: ReturnType<typeof vi.fn>;
  };
  let resolver: MemoryTokenBudgetResolver;
  let tokenCounter: TokenCounterService;

  beforeEach(() => {
    mockChatSessionRepo = {
      findById: vi.fn(),
      update: vi.fn(),
    };
    mockChatMessageRepo = {
      create: vi.fn(),
    };
    mockAiConfig = {
      getModelForUseCase: vi.fn().mockResolvedValue(''),
      getTokenLimit: vi.fn().mockResolvedValue(0),
    };
    resolver = MemoryTokenBudgetResolver.create(
      mockAiConfig as unknown as AiConfigurationService,
    );
    tokenCounter = new TokenCounterService(
      mockAiConfig as unknown as AiConfigurationService,
      resolver,
    );
  });

  it('registers providers on the shared assembly service', () => {
    const assembly = new SystemPromptAssemblyService();
    const svc = new ChatSessionContextService(
      mockChatSessionRepo as any,
      mockChatMessageRepo as any,
      resolver,
      tokenCounter,
      assembly,
    );
    svc.registerProvider('p', {
      name: 'p',
      canProvide: () => Promise.resolve(true),
      getContext: () =>
        Promise.resolve({ title: 'P', content: 'b', priority: 100 }),
    });
    expect(assembly.getRegisteredNames()).toContain('p');
    expect(svc.getRegisteredProviderNames()).toContain('p');
  });

  it('assertRegistryNonEmpty throws when the shared registry is empty', () => {
    const assembly = new SystemPromptAssemblyService();
    const svc = new ChatSessionContextService(
      mockChatSessionRepo as any,
      mockChatMessageRepo as any,
      resolver,
      tokenCounter,
      assembly,
    );
    expect(() => {
      svc.assertRegistryNonEmpty('test');
    }).toThrow(/registry is empty/i);
  });
});
