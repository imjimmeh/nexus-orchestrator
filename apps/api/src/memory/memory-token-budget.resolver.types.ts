/**
 * Public types for the memory token budget resolver.
 *
 * Memory, session, and chat subsystems all need to know how the active LLM
 * model's context window is partitioned between memory recall, working
 * context, and a reserved margin for system instructions. These types are
 * the contract that the resolver publishes to the rest of the memory module.
 */

import type { ModelUseCase } from '../ai-config/database/repositories/llm-model.repository';

/**
 * Slice percentages (0-100) used to partition an LLM context window.
 *
 * The default 60/30/10 split reserves the majority of the context for
 * long-term memory recall, a third for working context (recent turns,
 * tool results, scratchpad), and a tenth for system / safety overhead.
 */
export interface MemoryTokenBudgetPercents {
  readonly memoryPercent: number;
  readonly workingPercent: number;
  readonly reservedPercent: number;
}

/**
 * Optional constructor inputs for {@link MemoryTokenBudgetResolver}.
 *
 * Every field is optional; sensible defaults are applied at construction
 * time. Callers (typically a NestJS module factory) merge values sourced
 * from `ConfigService` so the resolver itself remains environment-agnostic
 * and trivially testable in isolation.
 */
export interface MemoryTokenBudgetOptions {
  readonly memoryPercent?: number;
  readonly workingPercent?: number;
  readonly reservedPercent?: number;
  /**
   * Context window size to use when no active model can be resolved or
   * when the resolved model reports a non-positive token limit.
   *
   * Defaults to 128_000 (128k) to preserve historical behaviour until
   * the new resolver is wired through DistillationConsumer and
   * ChatSessionContextService.
   */
  readonly fallbackContextWindow?: number;
  /**
   * Which `ModelUseCase` to query via `AiConfigurationService` when
   * selecting the active model. Defaults to `'distillation'` because
   * the memory subsystem is the primary consumer of this budget.
   */
  readonly useCase?: ModelUseCase;
}

/**
 * Resolved memory token budget for the active LLM model.
 *
 * `memory + working + reserved` is guaranteed to equal `contextWindow`
 * for any positive `contextWindow`. The percentages are echoed back so
 * downstream consumers (logging, telemetry) can attribute the slices
 * without needing to know the resolver's configuration.
 */
export interface MemoryTokenBudget {
  readonly contextWindow: number;
  readonly memory: number;
  readonly working: number;
  readonly reserved: number;
  readonly memoryPercent: number;
  readonly workingPercent: number;
  readonly reservedPercent: number;
}
