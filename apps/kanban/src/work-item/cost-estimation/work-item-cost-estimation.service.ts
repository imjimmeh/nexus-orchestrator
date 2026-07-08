import { Injectable } from "@nestjs/common";
import { KanbanModelPricingCacheRepository } from "../../database/repositories/kanban-model-pricing-cache.repository";
import { KanbanWorkItemCostBucketStatRepository } from "../../database/repositories/kanban-work-item-cost-bucket-stat.repository";
import { BUCKET_TIERS } from "./bucket-tiers";
import type {
  CostEstimateInput,
  CostEstimateResult,
  CostEstimateWhatIf,
} from "./work-item-cost-estimation.types";

const GLOBAL_TYPE_KEY = "__all__";
const CENTS_PER_MILLION_TOKENS = 1_000_000;

function tokensToCents(
  inputTokens: number,
  outputTokens: number,
  pricedTurnCount: number,
  inputCentsPerMillion: number | null,
  outputCentsPerMillion: number | null,
): number | null {
  if (inputCentsPerMillion === null || outputCentsPerMillion === null) {
    return null;
  }

  const aggregateTokenCostCents = Math.ceil(
    (inputTokens * inputCentsPerMillion +
      outputTokens * outputCentsPerMillion) /
      CENTS_PER_MILLION_TOKENS,
  );
  if (aggregateTokenCostCents <= 0) {
    return aggregateTokenCostCents;
  }

  return Math.max(aggregateTokenCostCents, Math.ceil(pricedTurnCount));
}

@Injectable()
export class WorkItemCostEstimationService {
  constructor(
    private readonly bucketStats: KanbanWorkItemCostBucketStatRepository,
    private readonly pricingCache: KanbanModelPricingCacheRepository,
  ) {}

  async estimate(input: CostEstimateInput): Promise<CostEstimateResult> {
    const bucket = await this.findBestFitBucket(input);
    if (!bucket) {
      return {
        available: false,
        bucketTier: null,
        sampleCount: 0,
        estimatedCostCents: null,
        lowCostCents: null,
        highCostCents: null,
        whatIf: [],
      };
    }

    const rates = await this.pricingCache.findAll();
    const primaryRate = rates.find((rate) => rate.model_id === input.modelId);

    return {
      available: true,
      bucketTier: bucket.tier,
      sampleCount: bucket.sample_count,
      estimatedCostCents: primaryRate
        ? tokensToCents(
            bucket.mean_input_tokens,
            bucket.mean_output_tokens,
            bucket.mean_priced_turn_count ?? 0,
            primaryRate.input_token_cents_per_million,
            primaryRate.output_token_cents_per_million,
          )
        : null,
      lowCostCents: primaryRate
        ? tokensToCents(
            bucket.p25_input_tokens,
            bucket.p25_output_tokens,
            bucket.p25_priced_turn_count ?? 0,
            primaryRate.input_token_cents_per_million,
            primaryRate.output_token_cents_per_million,
          )
        : null,
      highCostCents: primaryRate
        ? tokensToCents(
            bucket.p75_input_tokens,
            bucket.p75_output_tokens,
            bucket.p75_priced_turn_count ?? 0,
            primaryRate.input_token_cents_per_million,
            primaryRate.output_token_cents_per_million,
          )
        : null,
      whatIf: rates
        .filter((rate) => rate.model_id !== input.modelId)
        .flatMap((rate): CostEstimateWhatIf[] => {
          const estimatedCostCents = tokensToCents(
            bucket.mean_input_tokens,
            bucket.mean_output_tokens,
            bucket.mean_priced_turn_count ?? 0,
            rate.input_token_cents_per_million,
            rate.output_token_cents_per_million,
          );
          return estimatedCostCents === null
            ? []
            : [
                {
                  modelId: rate.model_id,
                  modelName: rate.model_name,
                  providerName: rate.provider_name,
                  estimatedCostCents,
                },
              ];
        }),
    };
  }

  private async findBestFitBucket(input: CostEstimateInput) {
    for (const tier of BUCKET_TIERS) {
      const bucket = await this.bucketStats.findByKey({
        tier: tier.name,
        workflowId: tier.usesWorkflow ? input.workflowId : null,
        type: tier.name === "global" ? GLOBAL_TYPE_KEY : input.type,
        storyPoints: tier.usesStoryPoints ? input.storyPoints : null,
      });
      if (bucket && bucket.sample_count >= tier.minSampleSize) {
        return bucket;
      }
    }

    return null;
  }
}
