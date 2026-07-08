import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { KanbanModelPricingCacheEntity } from "../entities/kanban-model-pricing-cache.entity";
import type { ModelRateInput } from "./kanban-model-pricing-cache.repository.types";

@Injectable()
export class KanbanModelPricingCacheRepository {
  constructor(
    @InjectRepository(KanbanModelPricingCacheEntity)
    private readonly repository: Repository<KanbanModelPricingCacheEntity>,
  ) {}

  async upsertRates(rates: ModelRateInput[]): Promise<void> {
    if (rates.length === 0) {
      return;
    }

    await this.repository.upsert(
      rates.map((rate) => ({
        model_id: rate.modelId,
        provider_name: rate.providerName,
        model_name: rate.modelName,
        input_token_cents_per_million: rate.inputTokenCentsPerMillion,
        output_token_cents_per_million: rate.outputTokenCentsPerMillion,
      })),
      ["model_id"],
    );
  }

  findAll(): Promise<KanbanModelPricingCacheEntity[]> {
    return this.repository.find();
  }
}
