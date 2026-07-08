import { describe, it, expect } from "vitest";
import { buildClaudeAuthDelivery } from "../src/claude-code-auth-delivery.js";

const OAUTH_AUTH = {
  type: "oauth",
  credential: {
    type: "oauth",
    refreshToken: "rt-123",
    accessToken: "at-xyz",
    expiresAt: 1781376133143,
  },
} as const;

describe("buildClaudeAuthDelivery", () => {
  it("env mode delivers the OAuth token via CLAUDE_CODE_OAUTH_TOKEN and writes no file", () => {
    const delivery = buildClaudeAuthDelivery(OAUTH_AUTH, "env", "/cfg");

    expect(delivery.env).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: "at-xyz" });
    expect(delivery.credentialsFile).toBeUndefined();
  });

  it("file mode writes a native credentials file and omits the token env var", () => {
    const delivery = buildClaudeAuthDelivery(OAUTH_AUTH, "file", "/cfg");

    expect(delivery.env).toEqual({ CLAUDE_CONFIG_DIR: "/cfg" });
    expect(delivery.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(delivery.credentialsFile?.path).toBe("/cfg/.credentials.json");
    expect(JSON.parse(delivery.credentialsFile?.contents ?? "{}")).toEqual({
      claudeAiOauth: {
        accessToken: "at-xyz",
        refreshToken: "rt-123",
        expiresAt: 1781376133143,
      },
    });
  });

  it("api_key auth always uses ANTHROPIC_API_KEY env even in file mode", () => {
    const delivery = buildClaudeAuthDelivery(
      { type: "api_key", apiKey: "sk-abc" },
      "file",
      "/cfg",
    );

    expect(delivery.env).toEqual({ ANTHROPIC_API_KEY: "sk-abc" });
    expect(delivery.credentialsFile).toBeUndefined();
  });

  it("falls back to env delivery when auth is undefined", () => {
    const delivery = buildClaudeAuthDelivery(undefined, "file", "/cfg");

    expect(delivery.env).toEqual({});
    expect(delivery.credentialsFile).toBeUndefined();
  });
});
