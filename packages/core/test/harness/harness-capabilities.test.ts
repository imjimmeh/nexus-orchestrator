import { describe, it, expect } from "vitest";
import {
  isHarnessId,
  PI_CAPABILITIES,
  CLAUDE_CODE_CAPABILITIES,
} from "../../src/index.js";

describe("HarnessId", () => {
  it("accepts built-in and custom ids", () => {
    expect(isHarnessId("pi")).toBe(true);
    expect(isHarnessId("claude-code")).toBe(true);
    expect(isHarnessId("custom:my-harness")).toBe(true);
  });

  it("rejects unknown bare ids", () => {
    expect(isHarnessId("openai")).toBe(false);
    expect(isHarnessId("")).toBe(false);
    expect(isHarnessId("custom:")).toBe(false); // bare prefix with no suffix
  });
});

describe("PI_CAPABILITIES", () => {
  it("declares the PI tool model and supported auth", () => {
    expect(PI_CAPABILITIES.toolModel).toBe("execute_wrapped");
    expect(PI_CAPABILITIES.telemetryContractVersion).toBe("v1");
  });
});

describe("CLAUDE_CODE_CAPABILITIES", () => {
  it("declares permission_callback tool model", () => {
    expect(CLAUDE_CODE_CAPABILITIES.toolModel).toBe("permission_callback");
  });
  it("does not support branching", () => {
    expect(CLAUDE_CODE_CAPABILITIES.supportsBranching).toBe(false);
  });
});

describe("HarnessCapabilities.requiredCredentials", () => {
  it("PI declares a single primary 'provider' requirement accepting any provider", () => {
    const reqs = PI_CAPABILITIES.requiredCredentials;
    expect(reqs).toBeDefined();
    expect(reqs).toHaveLength(1);
    const provider = reqs?.[0];
    expect(provider?.key).toBe("provider");
    expect(provider?.displayName).toBe("LLM Provider");
    expect(provider?.authTypes).toEqual(["api_key", "oauth_authcode"]);
    expect(provider?.primary).toBe(true);
  });

  it("Claude Code declares a primary 'anthropic' requirement (api_key + oauth_authcode)", () => {
    const reqs = CLAUDE_CODE_CAPABILITIES.requiredCredentials;
    expect(reqs).toBeDefined();
    expect(reqs).toHaveLength(1);
    const anthropic = reqs?.[0];
    expect(anthropic?.key).toBe("anthropic");
    expect(anthropic?.displayName).toBe("Anthropic API Key / OAuth");
    expect(anthropic?.authTypes).toEqual(["api_key", "oauth_authcode"]);
    expect(anthropic?.primary).toBe(true);
  });
});
