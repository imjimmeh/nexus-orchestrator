import { describe, expect, it, vi } from "vitest";
import { WorkItemCostEstimationService } from "./work-item-cost-estimation.service";

const PRICING_CACHE = [
  {
    model_id: "model-1",
    model_name: "claude-sonnet-5",
    provider_name: "anthropic",
    input_token_cents_per_million: 300,
    output_token_cents_per_million: 1500,
  },
  {
    model_id: "model-2",
    model_name: "gpt-5-mini",
    provider_name: "openai",
    input_token_cents_per_million: 100,
    output_token_cents_per_million: 400,
  },
];

const MINIMAX_PRICING = {
  model_id: "minimax-m3",
  model_name: "MiniMax-M3",
  provider_name: "minimax",
  input_token_cents_per_million: 15,
  output_token_cents_per_million: 60,
};

describe("WorkItemCostEstimationService", () => {
  it("returns unavailable when no bucket tier has enough samples", async () => {
    const bucketStats = { findByKey: vi.fn().mockResolvedValue(null) };
    const pricingCache = { findAll: vi.fn().mockResolvedValue(PRICING_CACHE) };
    const service = new WorkItemCostEstimationService(
      bucketStats as never,
      pricingCache as never,
    );

    const result = await service.estimate({
      workflowId: "wf-1",
      type: "task",
      storyPoints: 3,
      modelId: "model-1",
    });

    expect(result).toEqual({
      available: false,
      bucketTier: null,
      sampleCount: 0,
      estimatedCostCents: null,
      lowCostCents: null,
      highCostCents: null,
      whatIf: [],
    });
    expect(bucketStats.findByKey).toHaveBeenCalledTimes(3);
  });

  it("falls back to a coarser tier and computes primary plus what-if estimates from cached pricing", async () => {
    const bucketStats = {
      findByKey: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({
        tier: "workflow_type",
        sample_count: 8,
        mean_input_tokens: 1000,
        p25_input_tokens: 800,
        p75_input_tokens: 1200,
        mean_output_tokens: 200,
        p25_output_tokens: 150,
        p75_output_tokens: 250,
      }),
    };
    const pricingCache = { findAll: vi.fn().mockResolvedValue(PRICING_CACHE) };
    const service = new WorkItemCostEstimationService(
      bucketStats as never,
      pricingCache as never,
    );

    const result = await service.estimate({
      workflowId: "wf-1",
      type: "task",
      storyPoints: 3,
      modelId: "model-1",
    });

    expect(bucketStats.findByKey).toHaveBeenNthCalledWith(1, {
      tier: "workflow_type_points",
      workflowId: "wf-1",
      type: "task",
      storyPoints: 3,
    });
    expect(bucketStats.findByKey).toHaveBeenNthCalledWith(2, {
      tier: "workflow_type",
      workflowId: "wf-1",
      type: "task",
      storyPoints: null,
    });
    expect(result).toEqual({
      available: true,
      bucketTier: "workflow_type",
      sampleCount: 8,
      estimatedCostCents: 1,
      lowCostCents: 1,
      highCostCents: 1,
      whatIf: [
        {
          modelId: "model-2",
          modelName: "gpt-5-mini",
          providerName: "openai",
          estimatedCostCents: 1,
        },
      ],
    });
  });

  it("uses the historical priced turn distribution as the rounding floor for low-rate models", async () => {
    const bucketStats = {
      findByKey: vi.fn().mockResolvedValueOnce({
        tier: "workflow_type_points",
        sample_count: 70,
        mean_input_tokens: 853_421,
        p25_input_tokens: 373_508,
        p75_input_tokens: 1_267_589,
        mean_output_tokens: 145_495,
        p25_output_tokens: 65_022,
        p75_output_tokens: 200_866,
        mean_priced_turn_count: 489,
        p25_priced_turn_count: 194,
        p75_priced_turn_count: 694,
      }),
    };
    const pricingCache = {
      findAll: vi.fn().mockResolvedValue([...PRICING_CACHE, MINIMAX_PRICING]),
    };
    const service = new WorkItemCostEstimationService(
      bucketStats as never,
      pricingCache as never,
    );

    const result = await service.estimate({
      workflowId: "wf-1",
      type: "story",
      storyPoints: 3,
      modelId: "minimax-m3",
    });

    expect(result.estimatedCostCents).toBe(489);
    expect(result.lowCostCents).toBe(194);
    expect(result.highCostCents).toBe(694);
    expect(
      result.whatIf.find((row) => row.modelId === "model-2")
        ?.estimatedCostCents,
    ).toBe(489);
  });
});
