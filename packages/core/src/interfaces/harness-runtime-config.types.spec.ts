import { describe, it, expect } from "vitest";
import type { HarnessRuntimeConfig } from "./harness-runtime-config.types";
import { EMPTY_HARNESS_CONTRIBUTIONS } from "./harness-contributions.types";

describe("HarnessRuntimeConfig.contributions", () => {
  it("accepts a contributions bundle", () => {
    const cfg: HarnessRuntimeConfig = {
      harnessId: "pi",
      model: {
        provider: "p",
        model: "m",
        auth: { type: "api_key", apiKey: "k" } as never,
      },
      prompt: { systemPrompt: "s" },
      contributions: EMPTY_HARNESS_CONTRIBUTIONS,
    };
    expect(cfg.contributions).toEqual(EMPTY_HARNESS_CONTRIBUTIONS);
  });
});
