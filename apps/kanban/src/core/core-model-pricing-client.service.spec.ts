import { describe, expect, it, vi } from "vitest";
import { CoreModelPricingClientService } from "./core-model-pricing-client.service";

describe("CoreModelPricingClientService", () => {
  it("fetchActiveModelRates GETs /internal/models/rates and returns the rates array", async () => {
    const httpClient = {
      getJson: vi.fn().mockResolvedValue({
        rates: [
          {
            modelId: "model-1",
            providerName: "anthropic",
            modelName: "claude-sonnet-5",
            inputTokenCentsPerMillion: 300,
            outputTokenCentsPerMillion: 1500,
          },
        ],
      }),
    };
    const service = new CoreModelPricingClientService(httpClient as never);

    const result = await service.fetchActiveModelRates();

    expect(httpClient.getJson).toHaveBeenCalledWith(
      "/internal/models/rates",
      "fetch active model rates",
    );
    expect(result).toEqual([
      {
        modelId: "model-1",
        providerName: "anthropic",
        modelName: "claude-sonnet-5",
        inputTokenCentsPerMillion: 300,
        outputTokenCentsPerMillion: 1500,
      },
    ]);
  });
});
