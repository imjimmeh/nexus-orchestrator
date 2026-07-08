import { describe, it, expect } from "vitest";
import { isHarnessRuntimeConfig } from "../../src/interfaces/harness-runtime-config.types";

const valid = {
  harnessId: "pi",
  model: {
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    auth: { type: "api_key", apiKey: "sk-test" },
  },
  prompt: { systemPrompt: "You are a coding agent." },
};

describe("isHarnessRuntimeConfig", () => {
  it("accepts a minimal valid config", () => {
    expect(isHarnessRuntimeConfig(valid)).toBe(true);
  });

  it("rejects a config missing harnessId", () => {
    const { harnessId, ...rest } = valid;
    expect(isHarnessRuntimeConfig(rest)).toBe(false);
  });

  it("rejects a config missing model.auth", () => {
    expect(
      isHarnessRuntimeConfig({
        ...valid,
        model: { provider: "anthropic", model: "x" },
      }),
    ).toBe(false);
  });

  it("rejects a config missing prompt.systemPrompt", () => {
    expect(isHarnessRuntimeConfig({ ...valid, prompt: {} })).toBe(false);
  });
});
