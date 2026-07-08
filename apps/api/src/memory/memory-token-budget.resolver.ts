import { Injectable, Logger } from '@nestjs/common';
import { AiConfigurationService } from '../ai-config/ai-configuration.service';
import type { ModelUseCase } from '../ai-config/database/repositories/llm-model.repository';
import type {
  MemoryTokenBudget,
  MemoryTokenBudgetOptions,
  MemoryTokenBudgetPercents,
} from './memory-token-budget.resolver.types';

/**
 * Default slice of the context window reserved for memory recall.
 *
 * Expressed as a percentage (0-100). 60% reflects the historical
 * behaviour of `TokenCounterService` and the intent that long-term
 * memory dominates the budget for the distillation workload.
 */
export const DEFAULT_MEMORY_BUDGET_MEMORY_PERCENT = 60;

/**
 * Default slice of the context window reserved for working context
 * (recent turns, tool results, scratchpad content).
 */
export const DEFAULT_MEMORY_BUDGET_WORKING_PERCENT = 30;

/**
 * Default slice of the context window reserved for system / safety
 * overhead (system prompt, formatting, headroom for output tokens).
 */
export const DEFAULT_MEMORY_BUDGET_RESERVED_PERCENT = 10;

/**
 * Default context window used when no active model can be resolved.
 *
 * Historically the memory subsystem hardcoded 128_000 tokens; that
 * value is preserved here so behaviour is unchanged for callers that
 * have not yet been migrated to consume the resolver.
 */
export const DEFAULT_MEMORY_BUDGET_FALLBACK_CONTEXT_WINDOW = 128_000;

/**
 * Default `ModelUseCase` consulted when resolving the active model.
 */
export const DEFAULT_MEMORY_BUDGET_USE_CASE: ModelUseCase = 'distillation';

/**
 * Default 60/30/10 percentages used to partition a context window.
 *
 * Exported as the canonical `MemoryTokenBudgetPercents` value so every
 * caller — including the resolver itself and downstream consumers that
 * need a safe fallback (e.g. `DistillationConsumer.resolveMemoryBudgetSafe`)
 * — sources the same object. The individual `DEFAULT_MEMORY_BUDGET_*_PERCENT`
 * scalars are kept exported for ergonomic per-field overrides.
 */
export const DEFAULT_MEMORY_BUDGET_PERCENTS: MemoryTokenBudgetPercents = {
  memoryPercent: DEFAULT_MEMORY_BUDGET_MEMORY_PERCENT,
  workingPercent: DEFAULT_MEMORY_BUDGET_WORKING_PERCENT,
  reservedPercent: DEFAULT_MEMORY_BUDGET_RESERVED_PERCENT,
};

/**
 * Resolves a memory-aware token budget for the active LLM model.
 *
 * The resolver queries `AiConfigurationService` for the model that
 * owns the configured `useCase` (defaults to `distillation`) and reads
 * its `token_limit` (the entity field that surfaces the model's
 * context window). When the model is missing, inactive, or reports a
 * non-positive limit, the resolver falls back to a configurable
 * context window (default 128_000 tokens).
 *
 * The resolved window is sliced into three mutually exclusive
 * partitions — `memory`, `working`, and `reserved` — using percentages
 * supplied through `MemoryTokenBudgetOptions`. Percentages come from
 * injected configuration (typically environment-driven via the
 * surrounding NestJS module) so this class never hardcodes magic
 * numbers; the documented defaults are the single source of truth.
 *
 * The resolver intentionally depends only on the public surface of
 * `AiConfigurationService` (`getModelForUseCase`, `getTokenLimit`) and
 * is otherwise pure: no database access, no IO. That makes it cheap to
 * invoke on every distillation job and trivial to test in isolation.
 */
@Injectable()
export class MemoryTokenBudgetResolver {
  private readonly logger = new Logger(MemoryTokenBudgetResolver.name);
  private readonly percents: MemoryTokenBudgetPercents;
  private readonly fallbackContextWindow: number;
  private readonly useCase: ModelUseCase;

  private constructor(
    private readonly aiConfig: AiConfigurationService,
    options: MemoryTokenBudgetOptions,
  ) {
    this.percents = {
      memoryPercent:
        options.memoryPercent ?? DEFAULT_MEMORY_BUDGET_PERCENTS.memoryPercent,
      workingPercent:
        options.workingPercent ?? DEFAULT_MEMORY_BUDGET_PERCENTS.workingPercent,
      reservedPercent:
        options.reservedPercent ??
        DEFAULT_MEMORY_BUDGET_PERCENTS.reservedPercent,
    };
    this.fallbackContextWindow =
      options.fallbackContextWindow ??
      DEFAULT_MEMORY_BUDGET_FALLBACK_CONTEXT_WINDOW;
    this.useCase = options.useCase ?? DEFAULT_MEMORY_BUDGET_USE_CASE;
    this.assertPercentsValid(this.percents);
  }

  /**
   * Construct a resolver bound to a specific `AiConfigurationService`
   * and option set.
   *
   * This is the single supported construction path so the resolver
   * itself remains a pure value object at runtime: NestJS's DI
   * container (or test harnesses) only see the returned instance, and
   * the typed options never need to be modelled as a DI token.
   */
  static create(
    aiConfig: AiConfigurationService,
    options: MemoryTokenBudgetOptions = {},
  ): MemoryTokenBudgetResolver {
    return new MemoryTokenBudgetResolver(aiConfig, options);
  }

  /**
   * Resolve the current memory token budget.
   *
   * Returns a `MemoryTokenBudget` whose `memory + working + reserved`
   * sums to `contextWindow`. The percentages are echoed back so
   * downstream consumers can attribute the slice sizes without
   * re-reading configuration.
   */
  async resolve(): Promise<MemoryTokenBudget> {
    const contextWindow = await this.resolveContextWindow();
    return this.slice(contextWindow);
  }

  /**
   * Look up the active model's context window, applying the explicit
   * fallback when the resolution chain returns a missing or invalid
   * value. The fallback path is modelled explicitly so callers (and
   * tests) can distinguish "no active model" from "model with 128k
   * limit configured".
   */
  private async resolveContextWindow(): Promise<number> {
    const modelName = await this.aiConfig.getModelForUseCase(this.useCase);
    const limit = await this.aiConfig.getTokenLimit(modelName);

    if (this.isUsableContextWindow(limit)) {
      return limit;
    }

    this.logger.warn(
      `Active model "${modelName || '<unset>'}" for useCase "${this.useCase}" ` +
        `reported an unusable token limit (${String(limit)}); ` +
        `falling back to ${this.fallbackContextWindow.toString()} tokens.`,
    );
    return this.fallbackContextWindow;
  }

  private isUsableContextWindow(limit: number): boolean {
    return Number.isFinite(limit) && limit > 0;
  }

  /**
   * Partition `contextWindow` into `memory`, `working`, and `reserved`
   * slices using the supplied percentages.
   *
   * `memory` and `working` are computed with `Math.floor` to ensure
   * conservative allocation; `reserved` absorbs any rounding remainder
   * so the three slices always sum to exactly `contextWindow` for any
   * positive integer context window.
   *
   * This is the single source of truth for the partition arithmetic.
   * Both the resolver's instance path (via the private `slice()`
   * delegate) and the `DistillationConsumer.resolveMemoryBudgetSafe`
   * fallback call this method directly so the budget math never
   * diverges across the production code paths.
   */
  static sliceMemoryBudget(
    contextWindow: number,
    percents: MemoryTokenBudgetPercents,
  ): MemoryTokenBudget {
    const memory = Math.floor((percents.memoryPercent / 100) * contextWindow);
    const working = Math.floor((percents.workingPercent / 100) * contextWindow);
    const reserved = contextWindow - memory - working;

    return {
      contextWindow,
      memory,
      working,
      reserved,
      memoryPercent: percents.memoryPercent,
      workingPercent: percents.workingPercent,
      reservedPercent: percents.reservedPercent,
    };
  }

  private slice(contextWindow: number): MemoryTokenBudget {
    return MemoryTokenBudgetResolver.sliceMemoryBudget(
      contextWindow,
      this.percents,
    );
  }

  private assertPercentsValid(percents: MemoryTokenBudgetPercents): void {
    for (const value of [
      percents.memoryPercent,
      percents.workingPercent,
      percents.reservedPercent,
    ]) {
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(
          `Memory token budget percentages must be finite, non-negative numbers; ` +
            `received memory=${String(percents.memoryPercent)}, ` +
            `working=${String(percents.workingPercent)}, ` +
            `reserved=${String(percents.reservedPercent)}.`,
        );
      }
    }
    const total =
      percents.memoryPercent +
      percents.workingPercent +
      percents.reservedPercent;
    if (total > 100) {
      throw new Error(
        `Memory token budget percentages must sum to 100 or less; ` +
          `received memory=${percents.memoryPercent.toString()}, ` +
          `working=${percents.workingPercent.toString()}, ` +
          `reserved=${percents.reservedPercent.toString()} (total ${total.toString()}).`,
      );
    }
  }
}
