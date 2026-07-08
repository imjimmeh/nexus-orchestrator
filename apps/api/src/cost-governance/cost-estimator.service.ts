import { Injectable, Logger } from '@nestjs/common';
import { LlmModelRepository } from '../ai-config/database/repositories/llm-model.repository';
import type { LlmModel } from '../ai-config/database/entities/llm-model.entity';
import type {
  CostEstimateInput,
  CostEstimateResult,
  RateInfo,
} from './types/cost-estimate.types';

@Injectable()
export class CostEstimatorService {
  private readonly logger = new Logger(CostEstimatorService.name);

  constructor(private readonly llmModelRepo: LlmModelRepository) {}

  async estimate(input: CostEstimateInput): Promise<CostEstimateResult> {
    const model = await this.resolveModel(input.providerName, input.modelName);
    const modelId = model?.id ?? null;
    const rateInfo = this.extractRate(model);

    if (!rateInfo) {
      return {
        estimatedCents: null,
        estimateSource: 'unknown',
        rateMatched: null,
        modelId,
      };
    }

    if (
      input.expectedInputTokens === null &&
      input.expectedOutputTokens === null &&
      input.expectedTotalTokens === null
    ) {
      return {
        estimatedCents: null,
        estimateSource: 'unknown',
        rateMatched: rateInfo,
        modelId,
      };
    }

    if (
      input.expectedInputTokens === null &&
      input.expectedOutputTokens === null
    ) {
      return {
        estimatedCents: Math.ceil(
          this.calculateTokenCost(
            input.expectedTotalTokens ?? 0,
            rateInfo.input_token_cents_per_million,
          ),
        ),
        estimateSource: 'model_rate',
        rateMatched: rateInfo,
        modelId,
      };
    }

    const inputCents = this.calculateTokenCost(
      input.expectedInputTokens ?? 0,
      rateInfo.input_token_cents_per_million,
    );
    const outputCents = this.calculateTokenCost(
      input.expectedOutputTokens ?? 0,
      rateInfo.output_token_cents_per_million,
    );

    return {
      estimatedCents: Math.ceil(inputCents + outputCents),
      estimateSource: 'model_rate',
      rateMatched: rateInfo,
      modelId,
    };
  }

  private async resolveModel(
    providerName: string,
    modelName: string,
  ): Promise<LlmModel | null> {
    if (providerName) {
      const byPair = await this.llmModelRepo.findActiveByProviderAndName(
        providerName,
        modelName,
      );
      if (byPair) {
        return byPair;
      }
    }

    return this.llmModelRepo.findByName(modelName);
  }

  private extractRate(model: LlmModel | null): RateInfo | null {
    if (
      model?.input_token_cents_per_million != null &&
      model?.output_token_cents_per_million != null
    ) {
      return {
        input_token_cents_per_million: model.input_token_cents_per_million,
        output_token_cents_per_million: model.output_token_cents_per_million,
      };
    }

    return null;
  }

  private calculateTokenCost(
    tokenCount: number,
    centsPerMillion: number,
  ): number {
    return (tokenCount * centsPerMillion) / 1_000_000;
  }
}
