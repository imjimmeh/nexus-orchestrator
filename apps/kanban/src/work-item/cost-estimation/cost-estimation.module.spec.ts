import { MODULE_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import { CoreIntegrationModule } from "../../core/core-integration.module";
import { CoreModelPricingClientService } from "../../core/core-model-pricing-client.service";
import { CostEstimationModule } from "./cost-estimation.module";

describe("CostEstimationModule", () => {
  it("imports the exported core model pricing client provider", () => {
    const coreExports = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      CoreIntegrationModule,
    ) as unknown[];
    const costImports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      CostEstimationModule,
    ) as unknown[];

    expect(coreExports).toContain(CoreModelPricingClientService);
    expect(metadataIncludesModule(costImports, CoreIntegrationModule)).toBe(
      true,
    );
  });
});

function metadataIncludesModule(
  metadata: unknown[],
  expected: unknown,
): boolean {
  return metadata.some(
    (entry) => entry === expected || forwardRefResolvesTo(entry, expected),
  );
}

function forwardRefResolvesTo(entry: unknown, expected: unknown): boolean {
  if (!entry || typeof entry !== "object" || !("forwardRef" in entry)) {
    return false;
  }

  const forwardRef = entry.forwardRef;
  return typeof forwardRef === "function" && forwardRef() === expected;
}
