import { Injectable, Logger } from '@nestjs/common';
import { get_encoding, encoding_for_model, TiktokenModel } from 'tiktoken';
import { AiConfigurationService } from '../ai-config/ai-configuration.service';
import { MemoryTokenBudgetResolver } from './memory-token-budget.resolver';

/**
 * Token counter and active-model-aware cap resolver for the memory subsystem.
 *
 * `getTokenLimit` and `isOverThreshold` are now async because they consult
 * the active LLM model via `AiConfigurationService` and the
 * `MemoryTokenBudgetResolver`. The resolver is the single source of truth
 * for the fallback context window (default 128_000 tokens), so this
 * service no longer hardcodes any 128k magic numbers.
 *
 * The signatures changed from `number` / `boolean` to `Promise<number>` /
 * `Promise<boolean>`; the only in-tree callers (`session-hydration.service`)
 * already live inside `async` methods, so they were updated to `await`
 * the result. The sync `countTokens` / `countJSONLTokens` API is unchanged.
 */
@Injectable()
export class TokenCounterService {
  private readonly logger = new Logger(TokenCounterService.name);

  constructor(
    private readonly aiConfig: AiConfigurationService,
    private readonly budgetResolver: MemoryTokenBudgetResolver,
  ) {}

  countTokens(text: string, model: string = 'unknown-model'): number {
    try {
      // tiktoken might throw if model is unknown
      let enc;
      try {
        enc = encoding_for_model(model as TiktokenModel);
      } catch {
        enc = get_encoding('cl100k_base'); // Default for most modern models
      }

      const tokens = enc.encode(text);
      const count = tokens.length;
      enc.free(); // Free WASM memory
      return count;
    } catch (e) {
      const err = e as Error;
      this.logger.error(`Token counting failed: ${err.message}`);
      // Fallback: rough estimate (words * 1.3)
      return Math.ceil(text.split(/\s+/).length * 1.3);
    }
  }

  countJSONLTokens(jsonl: unknown[], model: string = 'unknown-model'): number {
    let total = 0;
    for (const node of jsonl) {
      total += this.countTokens(JSON.stringify(node), model);
    }
    return total;
  }

  /**
   * Resolve the active token limit for the supplied model.
   *
   * When a non-empty `model` is supplied and `AiConfigurationService`
   * reports a positive, finite `token_limit` for it (e.g. 200_000 for a
   * 200k-context model), that value is returned unchanged. When the
   * model name is missing, the model is unknown, or its reported limit
   * is non-positive / non-finite, the resolver's `contextWindow` is
   * returned instead — defaulting to 128_000 tokens.
   *
   * Async because both the AI config and the resolver await database
   * repositories; callers must `await` the result.
   */
  async getTokenLimit(model: string): Promise<number> {
    if (model && model.trim().length > 0) {
      const limit = await this.aiConfig.getTokenLimit(model);
      if (this.isUsableLimit(limit)) {
        return limit;
      }
    }
    const budget = await this.budgetResolver.resolve();
    return budget.contextWindow;
  }

  /**
   * Test whether `jsonl` exceeds `threshold * getTokenLimit(model)`.
   *
   * The cap now scales with the model: a 200k-context model gives a
   * 200k-token ceiling (160k at the default 0.8 threshold), and an
   * 8k-context model gives an 8k-token ceiling (6.4k at threshold 0.8).
   * Hardcoded 128k constants have been removed.
   */
  async isOverThreshold(
    jsonl: unknown[],
    model: string,
    threshold: number = 0.8,
  ): Promise<boolean> {
    const count = this.countJSONLTokens(jsonl, model);
    const limit = await this.getTokenLimit(model);
    return count > limit * threshold;
  }

  private isUsableLimit(limit: number): boolean {
    return Number.isFinite(limit) && limit > 0;
  }
}
