import { describe, it, expect } from "vitest";
import { buildClaudeAuthEnv } from "../src/claude-code-auth-env.js";

describe("buildClaudeAuthEnv", () => {
  it("maps api_key auth to ANTHROPIC_API_KEY", () => {
    expect(buildClaudeAuthEnv({ type: "api_key", apiKey: "sk-abc" })).toEqual({
      ANTHROPIC_API_KEY: "sk-abc",
    });
  });

  it("maps oauth auth to CLAUDE_CODE_OAUTH_TOKEN", () => {
    expect(
      buildClaudeAuthEnv({
        type: "oauth",
        credential: {
          type: "oauth",
          refreshToken: "r",
          accessToken: "at-xyz",
          expiresAt: 123,
        },
      }),
    ).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: "at-xyz" });
  });

  it("returns an empty env when auth is undefined", () => {
    expect(buildClaudeAuthEnv(undefined)).toEqual({});
  });

  it("returns an empty env when apiKey is empty string", () => {
    expect(buildClaudeAuthEnv({ type: "api_key", apiKey: "" })).toEqual({});
  });
});
