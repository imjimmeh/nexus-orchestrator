import { describe, it, expect } from "vitest";
import { FALLBACK_COOLDOWN_DEFAULT_MS } from "./fallback-chain.types";

describe("FALLBACK_COOLDOWN_DEFAULT_MS", () => {
  it("uses a short window for outages and 30m for account-scoped failures", () => {
    expect(FALLBACK_COOLDOWN_DEFAULT_MS.provider_outage).toBe(120000);
    expect(FALLBACK_COOLDOWN_DEFAULT_MS.usage_exhausted).toBe(1800000);
    expect(FALLBACK_COOLDOWN_DEFAULT_MS.billing_exhausted).toBe(1800000);
    expect(FALLBACK_COOLDOWN_DEFAULT_MS.auth_failed).toBe(1800000);
  });
});
