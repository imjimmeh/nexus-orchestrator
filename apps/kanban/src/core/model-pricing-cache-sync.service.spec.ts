import { describe, expect, it, vi } from "vitest";
import { ModelPricingCacheSyncService } from "./model-pricing-cache-sync.service";

describe("ModelPricingCacheSyncService", () => {
  it("syncOnce fetches active rates and upserts them into the cache", async () => {
    const rates = [
      {
        modelId: "model-1",
        providerName: "anthropic",
        modelName: "claude-sonnet-5",
        inputTokenCentsPerMillion: 300,
        outputTokenCentsPerMillion: 1500,
      },
    ];
    const pricingClient = {
      fetchActiveModelRates: vi.fn().mockResolvedValue(rates),
    };
    const cache = { upsertRates: vi.fn().mockResolvedValue(undefined) };
    const service = new ModelPricingCacheSyncService(
      pricingClient as never,
      cache as never,
    );

    await service.syncOnce();

    expect(cache.upsertRates).toHaveBeenCalledWith(rates);
  });

  it("syncOnce swallows fetch errors so a transient API outage does not crash the timer", async () => {
    const pricingClient = {
      fetchActiveModelRates: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const cache = { upsertRates: vi.fn() };
    const service = new ModelPricingCacheSyncService(
      pricingClient as never,
      cache as never,
    );

    await expect(service.syncOnce()).resolves.toBeUndefined();
    expect(cache.upsertRates).not.toHaveBeenCalled();
  });
});
