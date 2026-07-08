import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { TokenCounterService } from './token-counter.service';
import { AiConfigurationService } from '../ai-config/ai-configuration.service';
import {
  DEFAULT_MEMORY_BUDGET_FALLBACK_CONTEXT_WINDOW,
  MemoryTokenBudgetResolver,
} from './memory-token-budget.resolver';
import type { MemoryTokenBudget } from './memory-token-budget.resolver.types';

interface AiConfigMock {
  getTokenLimit: Mock;
  getModelForUseCase: Mock;
}

interface ResolverMock {
  resolve: Mock;
}

/**
 * Build a 128_000-token budget matching the resolver's documented
 * fallback. Tests can clone and tweak the values when they need a
 * non-default shape.
 */
function makeBudget(
  contextWindow: number = DEFAULT_MEMORY_BUDGET_FALLBACK_CONTEXT_WINDOW,
): MemoryTokenBudget {
  const memory = Math.floor(0.6 * contextWindow);
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

function createAiConfigMock(
  tokenLimits: Record<string, number> = {},
): AiConfigMock {
  return {
    getTokenLimit: vi
      .fn()
      .mockImplementation((name: string) =>
        Promise.resolve(tokenLimits[name] ?? 0),
      ),
    getModelForUseCase: vi.fn().mockResolvedValue('test-model'),
  };
}

function createResolverMock(budget: MemoryTokenBudget): ResolverMock {
  return {
    resolve: vi.fn().mockResolvedValue(budget),
  };
}

describe('TokenCounterService', () => {
  let service: TokenCounterService;
  let aiConfig: AiConfigMock;
  let resolver: ResolverMock;

  beforeEach(async () => {
    aiConfig = createAiConfigMock();
    resolver = createResolverMock(makeBudget());

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenCounterService,
        {
          provide: AiConfigurationService,
          useValue: aiConfig,
        },
        {
          provide: MemoryTokenBudgetResolver,
          useValue: resolver,
        },
      ],
    }).compile();

    service = module.get<TokenCounterService>(TokenCounterService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should count tokens for text', () => {
    const count = service.countTokens('Hello world');
    expect(count).toBeGreaterThan(0);
  });

  it('should count tokens for JSONL', () => {
    const jsonl = [
      { id: '1', content: 'hello' },
      { id: '2', content: 'world' },
    ];
    const count = service.countJSONLTokens(jsonl);
    expect(count).toBeGreaterThan(0);
  });

  describe('getTokenLimit', () => {
    it('returns the model-specific 200k context window, not 128k', async () => {
      aiConfig = createAiConfigMock({ 'claude-sonnet-4-5': 200_000 });
      resolver = createResolverMock(makeBudget(200_000));

      const module = await Test.createTestingModule({
        providers: [
          TokenCounterService,
          { provide: AiConfigurationService, useValue: aiConfig },
          { provide: MemoryTokenBudgetResolver, useValue: resolver },
        ],
      }).compile();
      const local = module.get<TokenCounterService>(TokenCounterService);

      const limit = await local.getTokenLimit('claude-sonnet-4-5');

      expect(limit).toBe(200_000);
      // The model-specific lookup must be the source of truth — the
      // 128k fallback must NOT be silently returned for a known model.
      expect(limit).not.toBe(128_000);
      expect(aiConfig.getTokenLimit).toHaveBeenCalledWith('claude-sonnet-4-5');
    });

    it('returns an 8k cap for an 8k-context model, not 128k', async () => {
      aiConfig = createAiConfigMock({ 'gpt-3.5': 8_000 });
      resolver = createResolverMock(makeBudget(8_000));

      const module = await Test.createTestingModule({
        providers: [
          TokenCounterService,
          { provide: AiConfigurationService, useValue: aiConfig },
          { provide: MemoryTokenBudgetResolver, useValue: resolver },
        ],
      }).compile();
      const local = module.get<TokenCounterService>(TokenCounterService);

      const limit = await local.getTokenLimit('gpt-3.5');

      expect(limit).toBe(8_000);
      expect(limit).not.toBe(128_000);
    });

    it('returns the resolver contextWindow (128k default) when the model name is empty', async () => {
      resolver = createResolverMock(makeBudget());

      const module = await Test.createTestingModule({
        providers: [
          TokenCounterService,
          { provide: AiConfigurationService, useValue: aiConfig },
          { provide: MemoryTokenBudgetResolver, useValue: resolver },
        ],
      }).compile();
      const local = module.get<TokenCounterService>(TokenCounterService);

      const limit = await local.getTokenLimit('');

      expect(limit).toBe(DEFAULT_MEMORY_BUDGET_FALLBACK_CONTEXT_WINDOW);
      expect(limit).toBe(128_000);
      // AI config must not be consulted when no model is supplied.
      expect(aiConfig.getTokenLimit).not.toHaveBeenCalled();
    });

    it('returns the resolver contextWindow (128k default) when the AI config reports zero', async () => {
      aiConfig = createAiConfigMock({ 'unknown-model': 0 });
      resolver = createResolverMock(makeBudget());

      const module = await Test.createTestingModule({
        providers: [
          TokenCounterService,
          { provide: AiConfigurationService, useValue: aiConfig },
          { provide: MemoryTokenBudgetResolver, useValue: resolver },
        ],
      }).compile();
      const local = module.get<TokenCounterService>(TokenCounterService);

      const limit = await local.getTokenLimit('unknown-model');

      expect(limit).toBe(DEFAULT_MEMORY_BUDGET_FALLBACK_CONTEXT_WINDOW);
      expect(limit).toBe(128_000);
    });

    it('returns the resolver contextWindow when the AI config reports a negative number', async () => {
      aiConfig = createAiConfigMock({ 'broken-model': -1 });
      resolver = createResolverMock(makeBudget());

      const module = await Test.createTestingModule({
        providers: [
          TokenCounterService,
          { provide: AiConfigurationService, useValue: aiConfig },
          { provide: MemoryTokenBudgetResolver, useValue: resolver },
        ],
      }).compile();
      const local = module.get<TokenCounterService>(TokenCounterService);

      const limit = await local.getTokenLimit('broken-model');

      expect(limit).toBe(DEFAULT_MEMORY_BUDGET_FALLBACK_CONTEXT_WINDOW);
    });

    it('honours a custom resolver fallbackContextWindow', async () => {
      aiConfig = createAiConfigMock({ 'unknown-model': 0 });
      resolver = createResolverMock(makeBudget(64_000));

      const module = await Test.createTestingModule({
        providers: [
          TokenCounterService,
          { provide: AiConfigurationService, useValue: aiConfig },
          { provide: MemoryTokenBudgetResolver, useValue: resolver },
        ],
      }).compile();
      const local = module.get<TokenCounterService>(TokenCounterService);

      const limit = await local.getTokenLimit('unknown-model');

      expect(limit).toBe(64_000);
    });
  });

  describe('isOverThreshold (model-aware)', () => {
    // The same payload (~140k tokens) is checked against two different
    // model caps. The 200k model must NOT trip the 80% threshold
    // (140k < 160k), while the 128k model MUST (140k > 102.4k). The
    // hardcoded 128k implementation could not distinguish between the
    // two.
    //
    // Use ~140k so it lands between 128k * 0.8 = 102.4k and
    // 200k * 0.8 = 160k. 30 entries × ~4.6k tokens ≈ 140k tokens.
    // NOTE: parentheses around the concatenated string — without them
    // `.repeat(80)` binds only to the final literal.
    const variedContent = (
      'apple banana cherry dog elephant fox grape house igloo jungle ' +
      'kettle lemon mango nest orange pear queen rabbit snake tree ' +
      'umbrella violet whale xenon yellow zebra alpha beta gamma delta ' +
      'epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho ' +
      'sigma tau upsilon phi chi psi omega'
    ).repeat(80);
    const payload = Array(30).fill({ id: '1', content: variedContent });

    it('does NOT trip at 80% of a 200k model for a ~140k-token payload', async () => {
      aiConfig = createAiConfigMock({ 'claude-sonnet-4-5': 200_000 });
      resolver = createResolverMock(makeBudget(200_000));

      const module = await Test.createTestingModule({
        providers: [
          TokenCounterService,
          { provide: AiConfigurationService, useValue: aiConfig },
          { provide: MemoryTokenBudgetResolver, useValue: resolver },
        ],
      }).compile();
      const local = module.get<TokenCounterService>(TokenCounterService);

      const isOver = await local.isOverThreshold(
        payload,
        'claude-sonnet-4-5',
        0.8,
      );

      expect(isOver).toBe(false);
    });

    it('trips at 80% of a 128k model for the same ~140k-token payload', async () => {
      aiConfig = createAiConfigMock({ 'claude-sonnet-4-5': 128_000 });
      resolver = createResolverMock(makeBudget(128_000));

      const module = await Test.createTestingModule({
        providers: [
          TokenCounterService,
          { provide: AiConfigurationService, useValue: aiConfig },
          { provide: MemoryTokenBudgetResolver, useValue: resolver },
        ],
      }).compile();
      const local = module.get<TokenCounterService>(TokenCounterService);

      const isOver = await local.isOverThreshold(
        payload,
        'claude-sonnet-4-5',
        0.8,
      );

      expect(isOver).toBe(true);
    });
  });

  it('should detect threshold', async () => {
    // 30 varied-text entries (~33k tokens) blow well past 128k * 0.01
    // = 1,280 tokens, while staying well under the 15s test timeout
    // when the full memory suite runs in parallel.
    const variedContent =
      'the quick brown fox jumps over the lazy dog and runs into the forest ' +
      'to fetch a stick from the riverbank'.repeat(50);
    const jsonl = Array(30).fill({ id: '1', content: variedContent });
    const isOver = await service.isOverThreshold(jsonl, 'gpt-4', 0.01);
    expect(isOver).toBe(true);
  });
});
