/**
 * `EmbeddingProviderService` — turns text into embedding vectors using the
 * operator-configured active embedding model.
 *
 * Opt-in + fail-soft design:
 *   - If no embedding model is configured (`resolveEmbeddingModelConfig` returns
 *     `{configured:false}`), `embed` returns `{configured:false}` and makes NO
 *     HTTP calls.
 *   - If the provider call fails for any reason, `embed` returns
 *     `{configured:false}` after a `warn` log — it NEVER throws into the caller.
 *   - Both "not configured" and "failed" arms are identical from the caller's
 *     perspective: fall back to lexical / recency retrieval.
 *
 * Transport: OpenAI-compatible `POST {baseUrl}/embeddings`.  The adapter
 * registry in `embedding-provider.adapters.ts` lets Voyage/Cohere drop in
 * later without touching this service.
 *
 * Token spend is recorded to `budget_usage_events` via the repository that
 * is already available in `MemoryModule` through `DatabaseModule`.  Cost
 * estimation is omitted here (would require importing `CostGovernanceModule`);
 * raw token counts are recorded with `estimated_cost_cents: null`.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { EmbedResult } from '@nexus/core';
import { AiConfigurationService } from '../../ai-config/ai-configuration.service';
import { BudgetUsageEventRepository } from '../../cost-governance/database/repositories/budget-usage-event.repository';
import { resolveEmbeddingAdapter } from './embedding-provider.adapters';

/** Maximum number of texts to send in a single embeddings request. */
const EMBED_BATCH_SIZE = 96;

@Injectable()
export class EmbeddingProviderService {
  private readonly logger = new Logger(EmbeddingProviderService.name);

  constructor(
    private readonly aiConfig: AiConfigurationService,
    private readonly budgetUsageRepo: BudgetUsageEventRepository,
  ) {}

  /**
   * Embed one or more texts using the configured embedding model.
   *
   * Returns `{ configured: false }` when no model is configured or when the
   * provider call fails.  Never throws.
   */
  async embed(texts: string[]): Promise<EmbedResult> {
    if (texts.length === 0) {
      return { configured: false };
    }

    const config = await this.aiConfig.resolveEmbeddingModelConfig();
    if (!config.configured) {
      return { configured: false };
    }

    const { modelId, modelName, provider, auth, baseUrl, embeddingDimension } =
      config;

    try {
      const adapter = resolveEmbeddingAdapter(provider);
      const allVectors: number[][] = [];
      let totalPromptTokens = 0;
      let totalTokens = 0;

      // Send in bounded batches to avoid overwhelming provider limits.
      for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
        const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
        const result = await adapter({
          modelName,
          texts: batch,
          embeddingDimension,
          auth,
          baseUrl,
        });

        // Validate that every returned vector has the expected length.
        if (embeddingDimension !== null) {
          for (let j = 0; j < result.vectors.length; j++) {
            if (result.vectors[j].length !== embeddingDimension) {
              this.logger.warn(
                `EmbeddingProviderService: vector[${i + j}] length ${result.vectors[j].length} ` +
                  `does not match expected dimension ${embeddingDimension} for model ${modelName}. ` +
                  `Discarding batch and returning unconfigured result.`,
              );
              return { configured: false };
            }
          }
        }

        allVectors.push(...result.vectors);
        totalPromptTokens += result.promptTokens;
        totalTokens += result.totalTokens;
      }

      // Infer dimension from the first vector when embeddingDimension is null.
      const dim = embeddingDimension ?? allVectors[0]?.length ?? 0;

      // Record token spend; errors here must never block the embed result.
      this.recordTokenSpend(
        modelId,
        modelName,
        provider,
        totalPromptTokens,
        totalTokens,
      ).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `EmbeddingProviderService: failed to record token spend: ${message}`,
        );
      });

      return { configured: true, modelId, dim, vectors: allVectors };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `EmbeddingProviderService: provider call failed for model ${modelName} ` +
          `(provider: ${provider}): ${message}`,
      );
      return { configured: false };
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async recordTokenSpend(
    modelId: string,
    modelName: string,
    providerName: string,
    inputTokens: number,
    totalTokens: number,
  ): Promise<void> {
    if (inputTokens === 0 && totalTokens === 0) {
      return;
    }

    await this.budgetUsageRepo.recordUsage({
      correlation_id: null,
      scope_id: null,
      context_type: 'embedding',
      context_id: modelId,
      actor_type: 'system',
      actor_id: null,
      provider_name: providerName,
      model_name: modelName,
      model_id: modelId,
      input_tokens: inputTokens,
      output_tokens: null,
      total_tokens: totalTokens,
      // Cost estimation omitted: CostEstimatorService is not available in
      // MemoryModule scope without importing CostGovernanceModule (heavy dep).
      // TODO: add cost estimation when cost-governance is extended to support
      // embedding calls (tracked in EPIC-212).
      estimated_cost_cents: null,
      estimate_source: 'none',
      metadata: { call_type: 'embedding' },
    });
  }
}
