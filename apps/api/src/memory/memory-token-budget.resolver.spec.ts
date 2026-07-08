import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { AiConfigurationService } from '../ai-config/ai-configuration.service';
import {
  DEFAULT_MEMORY_BUDGET_FALLBACK_CONTEXT_WINDOW,
  DEFAULT_MEMORY_BUDGET_MEMORY_PERCENT,
  DEFAULT_MEMORY_BUDGET_PERCENTS,
  DEFAULT_MEMORY_BUDGET_RESERVED_PERCENT,
  DEFAULT_MEMORY_BUDGET_USE_CASE,
  DEFAULT_MEMORY_BUDGET_WORKING_PERCENT,
  MemoryTokenBudgetResolver,
} from './memory-token-budget.resolver';
import type {
  MemoryTokenBudget,
  MemoryTokenBudgetOptions,
  MemoryTokenBudgetPercents,
} from './memory-token-budget.resolver.types';

/**
 * Test surface for the resolver.
 *
 * The resolver depends on exactly two public methods of
 * `AiConfigurationService` (`getModelForUseCase`, `getTokenLimit`) — both
 * of which return promises — so a minimal mock is sufficient to drive
 * the full matrix of context windows, percentages, and fallback
 * scenarios.
 */
interface AiConfigMock {
  getModelForUseCase: Mock;
  getTokenLimit: Mock;
}

const DEFAULT_MODEL_NAME = 'distill-model';

function createAiConfigMock(
  tokenLimits: Record<string, number | null> = {},
  modelName: string = DEFAULT_MODEL_NAME,
): AiConfigMock {
  return {
    getModelForUseCase: vi.fn().mockResolvedValue(modelName),
    getTokenLimit: vi.fn().mockImplementation((name: string) => {
      const limit = tokenLimits[name];
      return Promise.resolve(limit === undefined ? null : limit);
    }),
  };
}

function buildResolver(
  aiConfig: AiConfigMock,
  options: MemoryTokenBudgetOptions = {},
): MemoryTokenBudgetResolver {
  return MemoryTokenBudgetResolver.create(
    aiConfig as unknown as AiConfigurationService,
    options,
  );
}

describe('MemoryTokenBudgetResolver', () => {
  describe('construction', () => {
    it('uses the documented defaults when no options are supplied', async () => {
      const aiConfig = createAiConfigMock();
      const resolver = buildResolver(aiConfig);

      const budget = await resolver.resolve();

      expect(budget.memoryPercent).toBe(DEFAULT_MEMORY_BUDGET_MEMORY_PERCENT);
      expect(budget.workingPercent).toBe(DEFAULT_MEMORY_BUDGET_WORKING_PERCENT);
      expect(budget.reservedPercent).toBe(
        DEFAULT_MEMORY_BUDGET_RESERVED_PERCENT,
      );
      expect(aiConfig.getModelForUseCase).toHaveBeenCalledWith(
        DEFAULT_MEMORY_BUDGET_USE_CASE,
      );
    });

    it('rejects percentages that sum to more than 100', () => {
      const aiConfig = createAiConfigMock();
      expect(() =>
        buildResolver(aiConfig, {
          memoryPercent: 80,
          workingPercent: 30,
          reservedPercent: 10,
        }),
      ).toThrow(/sum to 100 or less/);
    });

    it('rejects negative percentages', () => {
      const aiConfig = createAiConfigMock();
      expect(() =>
        buildResolver(aiConfig, {
          memoryPercent: -10,
          workingPercent: 80,
          reservedPercent: 30,
        }),
      ).toThrow(/finite, non-negative numbers/);
    });

    it('rejects non-finite percentages', () => {
      const aiConfig = createAiConfigMock();
      expect(() =>
        buildResolver(aiConfig, {
          memoryPercent: Number.NaN,
          workingPercent: 90,
          reservedPercent: 10,
        }),
      ).toThrow(/finite, non-negative numbers/);
    });
  });

  describe('default 60/30/10 slice', () => {
    const cases: ReadonlyArray<{
      label: string;
      contextWindow: number;
      expected: Omit<
        MemoryTokenBudget,
        'memoryPercent' | 'workingPercent' | 'reservedPercent'
      >;
    }> = [
      {
        label: '8_000 tokens',
        contextWindow: 8_000,
        expected: {
          contextWindow: 8_000,
          memory: 4_800,
          working: 2_400,
          reserved: 800,
        },
      },
      {
        label: '32_000 tokens',
        contextWindow: 32_000,
        expected: {
          contextWindow: 32_000,
          memory: 19_200,
          working: 9_600,
          reserved: 3_200,
        },
      },
      {
        label: '128_000 tokens',
        contextWindow: 128_000,
        expected: {
          contextWindow: 128_000,
          memory: 76_800,
          working: 38_400,
          reserved: 12_800,
        },
      },
      {
        label: '200_000 tokens',
        contextWindow: 200_000,
        expected: {
          contextWindow: 200_000,
          memory: 120_000,
          working: 60_000,
          reserved: 20_000,
        },
      },
      {
        label: '1_000_000 tokens',
        contextWindow: 1_000_000,
        expected: {
          contextWindow: 1_000_000,
          memory: 600_000,
          working: 300_000,
          reserved: 100_000,
        },
      },
    ];

    for (const { label, contextWindow, expected } of cases) {
      it(`partitions ${label} into 60/30/10`, async () => {
        const aiConfig = createAiConfigMock({
          [DEFAULT_MODEL_NAME]: contextWindow,
        });
        const resolver = buildResolver(aiConfig);

        const budget = await resolver.resolve();

        expect(budget).toMatchObject(expected);
        expect(budget.memory + budget.working + budget.reserved).toBe(
          contextWindow,
        );
        expect(budget.memoryPercent).toBe(DEFAULT_MEMORY_BUDGET_MEMORY_PERCENT);
        expect(budget.workingPercent).toBe(
          DEFAULT_MEMORY_BUDGET_WORKING_PERCENT,
        );
        expect(budget.reservedPercent).toBe(
          DEFAULT_MEMORY_BUDGET_RESERVED_PERCENT,
        );
      });
    }
  });

  describe('128k fallback when no active model is available', () => {
    it('falls back to the default context window when getTokenLimit returns null', async () => {
      const aiConfig = createAiConfigMock({ [DEFAULT_MODEL_NAME]: null });
      const resolver = buildResolver(aiConfig);

      const budget = await resolver.resolve();

      expect(budget.contextWindow).toBe(
        DEFAULT_MEMORY_BUDGET_FALLBACK_CONTEXT_WINDOW,
      );
      expect(budget.memory).toBe(76_800);
      expect(budget.working).toBe(38_400);
      expect(budget.reserved).toBe(12_800);
    });

    it('falls back to the default context window when getTokenLimit returns zero', async () => {
      const aiConfig = createAiConfigMock({ [DEFAULT_MODEL_NAME]: 0 });
      const resolver = buildResolver(aiConfig);

      const budget = await resolver.resolve();

      expect(budget.contextWindow).toBe(
        DEFAULT_MEMORY_BUDGET_FALLBACK_CONTEXT_WINDOW,
      );
    });

    it('falls back to the default context window when getTokenLimit returns a negative number', async () => {
      const aiConfig = createAiConfigMock({ [DEFAULT_MODEL_NAME]: -1 });
      const resolver = buildResolver(aiConfig);

      const budget = await resolver.resolve();

      expect(budget.contextWindow).toBe(
        DEFAULT_MEMORY_BUDGET_FALLBACK_CONTEXT_WINDOW,
      );
    });

    it('honours a custom fallbackContextWindow option', async () => {
      const aiConfig = createAiConfigMock({ [DEFAULT_MODEL_NAME]: null });
      const resolver = buildResolver(aiConfig, {
        fallbackContextWindow: 64_000,
      });

      const budget = await resolver.resolve();

      expect(budget.contextWindow).toBe(64_000);
      expect(budget.memory).toBe(Math.floor(0.6 * 64_000));
      expect(budget.working).toBe(Math.floor(0.3 * 64_000));
      expect(budget.reserved).toBe(64_000 - 38_400 - 19_200);
    });
  });

  describe('configurable percentages', () => {
    let aiConfig: AiConfigMock;
    let resolver: MemoryTokenBudgetResolver;

    beforeEach(() => {
      aiConfig = createAiConfigMock({ [DEFAULT_MODEL_NAME]: 200_000 });
      resolver = buildResolver(aiConfig, {
        memoryPercent: 70,
        workingPercent: 20,
        reservedPercent: 10,
      });
    });

    it('uses the configured percentages when computing slices', async () => {
      const budget = await resolver.resolve();

      expect(budget.memoryPercent).toBe(70);
      expect(budget.workingPercent).toBe(20);
      expect(budget.reservedPercent).toBe(10);
      expect(budget.memory).toBe(140_000);
      expect(budget.working).toBe(40_000);
      expect(budget.reserved).toBe(20_000);
    });

    it('still sums memory + working + reserved to contextWindow', async () => {
      const budget = await resolver.resolve();

      expect(budget.memory + budget.working + budget.reserved).toBe(
        budget.contextWindow,
      );
    });

    it('keeps slices ≤ contextWindow when percentages are very small', async () => {
      const tinyResolver = buildResolver(aiConfig, {
        memoryPercent: 1,
        workingPercent: 1,
        reservedPercent: 1,
      });

      const budget = await tinyResolver.resolve();

      expect(budget.memory).toBe(2_000);
      expect(budget.working).toBe(2_000);
      // reserved absorbs the remainder (100% - 1% - 1% = 98% -> 196_000)
      expect(budget.reserved).toBe(196_000);
      expect(budget.memory + budget.working + budget.reserved).toBe(200_000);
    });
  });

  describe('useCase wiring', () => {
    it('queries the configured useCase, not the default', async () => {
      const aiConfig = createAiConfigMock({ 'summarise-model': 32_000 });
      const resolver = buildResolver(aiConfig, {
        useCase: 'summarization',
      });

      // Re-mock for the alternative use case by replacing the model name
      // the mock returns when asked.
      aiConfig.getModelForUseCase.mockImplementation(() =>
        Promise.resolve('summarise-model'),
      );

      const budget = await resolver.resolve();

      expect(aiConfig.getModelForUseCase).toHaveBeenCalledWith('summarization');
      expect(budget.contextWindow).toBe(32_000);
    });
  });

  describe('sliceMemoryBudget static method', () => {
    it('slices a 128_000-token context window with the default 60/30/10 percents', () => {
      const budget = MemoryTokenBudgetResolver.sliceMemoryBudget(
        128_000,
        DEFAULT_MEMORY_BUDGET_PERCENTS,
      );

      expect(budget).toEqual({
        contextWindow: 128_000,
        memory: 76_800,
        working: 38_400,
        reserved: 12_800,
        memoryPercent: 60,
        workingPercent: 30,
        reservedPercent: 10,
      });
      expect(budget.memory + budget.working + budget.reserved).toBe(128_000);
    });

    it('slices a 200_000-token context window with custom 70/20/10 percents', () => {
      const customPercents: MemoryTokenBudgetPercents = {
        memoryPercent: 70,
        workingPercent: 20,
        reservedPercent: 10,
      };

      const budget = MemoryTokenBudgetResolver.sliceMemoryBudget(
        200_000,
        customPercents,
      );

      expect(budget).toEqual({
        contextWindow: 200_000,
        memory: 140_000,
        working: 40_000,
        reserved: 20_000,
        memoryPercent: 70,
        workingPercent: 20,
        reservedPercent: 10,
      });
      expect(budget.memory + budget.working + budget.reserved).toBe(200_000);
    });

    it('returns the same budget as resolver.resolve() for the same percentages and context window', async () => {
      const customPercents: MemoryTokenBudgetPercents = {
        memoryPercent: 70,
        workingPercent: 20,
        reservedPercent: 10,
      };
      const aiConfig = createAiConfigMock({ [DEFAULT_MODEL_NAME]: 200_000 });
      const resolver = buildResolver(aiConfig, customPercents);

      const [staticBudget, resolvedBudget] = await Promise.all([
        Promise.resolve(
          MemoryTokenBudgetResolver.sliceMemoryBudget(200_000, customPercents),
        ),
        resolver.resolve(),
      ]);

      expect(staticBudget).toEqual(resolvedBudget);
      expect(
        staticBudget.memory + staticBudget.working + staticBudget.reserved,
      ).toBe(staticBudget.contextWindow);
    });
  });
});
