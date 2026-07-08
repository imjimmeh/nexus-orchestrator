import { Test } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanModelPricingCacheEntity } from "../entities/kanban-model-pricing-cache.entity";
import { KanbanModelPricingCacheRepository } from "./kanban-model-pricing-cache.repository";

describe("KanbanModelPricingCacheRepository", () => {
  let repo: KanbanModelPricingCacheRepository;
  let mockRepo: {
    upsert: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockRepo = {
      upsert: vi.fn().mockResolvedValue(undefined),
      find: vi.fn().mockResolvedValue([]),
    };

    const module = await Test.createTestingModule({
      providers: [
        KanbanModelPricingCacheRepository,
        {
          provide: getRepositoryToken(KanbanModelPricingCacheEntity),
          useValue: mockRepo,
        },
      ],
    }).compile();

    repo = module.get(KanbanModelPricingCacheRepository);
  });

  it("upsertRates writes each rate keyed by model_id", async () => {
    await repo.upsertRates([
      {
        modelId: "model-1",
        providerName: "anthropic",
        modelName: "claude-sonnet-5",
        inputTokenCentsPerMillion: 300,
        outputTokenCentsPerMillion: 1500,
      },
    ]);

    expect(mockRepo.upsert).toHaveBeenCalledWith(
      [
        {
          model_id: "model-1",
          provider_name: "anthropic",
          model_name: "claude-sonnet-5",
          input_token_cents_per_million: 300,
          output_token_cents_per_million: 1500,
        },
      ],
      ["model_id"],
    );
  });

  it("upsertRates is a no-op for an empty list", async () => {
    await repo.upsertRates([]);

    expect(mockRepo.upsert).not.toHaveBeenCalled();
  });

  it("findAll returns every cached rate", async () => {
    const rates = [{ model_id: "model-1" }];
    mockRepo.find.mockResolvedValueOnce(rates);

    await expect(repo.findAll()).resolves.toBe(rates);
  });
});
