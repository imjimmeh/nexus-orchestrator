import { Injectable, Logger } from '@nestjs/common';
import { BudgetUsageEventRepository } from './database/repositories/budget-usage-event.repository';
import { CostEstimatorService } from './cost-estimator.service';
import { resolveUsageTokens } from './usage-token-normalizer';
import type { TurnUsageRecordInput } from './types/turn-usage.types';

const UNKNOWN_ESTIMATE_SOURCE = 'unknown';

/**
 * Records token usage for a single agent turn as a {@link BudgetUsageEvent}.
 *
 * Agent sessions are multi-turn: each tool-use turn and the terminal turn is a
 * distinct request/response cycle with its own token cost. Recording only the
 * final turn (the previous behaviour) both undercounts long sessions and drops
 * spend entirely for providers whose terminal turn carries no `usage` object.
 * This recorder is driven from the telemetry gateway so every turn that
 * consumed tokens is counted exactly once.
 */
@Injectable()
export class TurnUsageRecorderService {
  private readonly logger = new Logger(TurnUsageRecorderService.name);

  constructor(
    private readonly costEstimator: CostEstimatorService,
    private readonly usageEventRepo: BudgetUsageEventRepository,
  ) {}

  async recordTurnUsage(input: TurnUsageRecordInput): Promise<void> {
    const tokens = resolveUsageTokens(input.usage);

    const hasUsage =
      tokens.inputTokens !== null ||
      tokens.outputTokens !== null ||
      tokens.totalTokens !== null;
    if (!hasUsage) {
      return;
    }

    try {
      let estimatedCents: number | null = null;
      let estimateSource: string = UNKNOWN_ESTIMATE_SOURCE;
      let modelId: string | null = null;

      if (input.providerName && input.modelName) {
        const estimate = await this.costEstimator.estimate({
          providerName: input.providerName,
          modelName: input.modelName,
          expectedInputTokens: tokens.inputTokens,
          expectedOutputTokens: tokens.outputTokens,
          expectedTotalTokens: tokens.totalTokens,
        });
        estimatedCents = estimate.estimatedCents;
        estimateSource = estimate.estimateSource;
        modelId = estimate.modelId;
      }

      await this.usageEventRepo.recordUsage({
        correlation_id: input.contextId,
        scope_id: input.scopeId,
        context_type: input.contextType,
        context_id: input.contextId,
        actor_type: 'agent',
        actor_id: null,
        provider_name: input.providerName,
        model_name: input.modelName,
        model_id: modelId,
        input_tokens: tokens.inputTokens,
        output_tokens: tokens.outputTokens,
        total_tokens: tokens.totalTokens,
        estimated_cost_cents: estimatedCents,
        estimate_source: estimateSource,
        metadata: input.stepId ? { step_id: input.stepId } : null,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to record turn usage for ${input.contextType} ${input.contextId}: ${(error as Error).message}`,
      );
    }
  }
}
