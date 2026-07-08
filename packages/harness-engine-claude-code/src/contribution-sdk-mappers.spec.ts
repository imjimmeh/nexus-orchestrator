import { describe, it, expect } from "vitest";
import {
  toSdkHooks,
  toSdkMcpServers,
  toSdkSettings,
  SDK_HOOK_EVENT_BY_NEUTRAL,
} from "./contribution-sdk-mappers.js";

describe("toSdkHooks", () => {
  it("maps neutral events to SDK hook event names and keeps the matcher", () => {
    const out = toSdkHooks([
      { event: "pre_tool_use", matcher: "Bash", command: "echo hi" },
    ]);
    expect(out).toBeDefined();
    expect(Object.keys(out!)).toEqual(["PreToolUse"]);
    const matchers = out!["PreToolUse"] as Array<{
      matcher?: string;
      hooks: unknown[];
    }>;
    expect(matchers[0].matcher).toBe("Bash");
    expect(typeof matchers[0].hooks[0]).toBe("function");
  });

  it("groups multiple hooks under the same SDK event", () => {
    const out = toSdkHooks([
      { event: "session_start", command: "a" },
      { event: "session_start", command: "b" },
    ])!;
    expect((out["SessionStart"] as unknown[]).length).toBe(2);
  });

  it("returns undefined for no hooks", () => {
    expect(toSdkHooks([])).toBeUndefined();
  });

  it("covers every neutral event in the map", () => {
    expect(SDK_HOOK_EVENT_BY_NEUTRAL).toEqual({
      session_start: "SessionStart",
      session_end: "SessionEnd",
      pre_tool_use: "PreToolUse",
      post_tool_use: "PostToolUse",
      user_prompt_submit: "UserPromptSubmit",
    });
  });

  it("handles a script hook asset by resolving it to a command string", () => {
    const out = toSdkHooks([
      {
        event: "session_start",
        script: { language: "bash", source: "echo hi" },
      },
    ]);
    expect(out).toBeDefined();
    expect(Object.keys(out!)).toEqual(["SessionStart"]);
  });
});

describe("toSdkMcpServers", () => {
  it("returns undefined for empty extensions (MCP connectivity deferred to Task 5)", () => {
    expect(toSdkMcpServers([])).toBeUndefined();
  });

  it("returns undefined for PI-native extension assets (not inline MCP descriptors)", () => {
    // Extensions are now HarnessExtensionAsset (PI-native modules), not
    // inline MCP server definitions. MCP connectivity via mcpServerRefs is
    // wired in Task 5.
    const out = toSdkMcpServers([
      {
        id: "ext-001",
        name: "my-extension",
        runtime: "ts-module" as const,
        entry: "./dist/index.js",
        source: { kind: "authored" as const },
        checksum: "sha256:abc123",
      },
    ]);
    expect(out).toBeUndefined();
  });
});

describe("toSdkSettings", () => {
  it("splits permissions/outputStyle into settings and env into env patch", () => {
    const out = toSdkSettings({
      env: { FOO: "bar" },
      permissions: { allow: ["Read"], deny: ["Bash"] },
      outputStyle: "concise",
    });
    expect(out.settings).toEqual({
      permissions: { allow: ["Read"], deny: ["Bash"] },
      outputStyle: "concise",
    });
    expect(out.env).toEqual({ FOO: "bar" });
  });

  it("omits settings when only env is set", () => {
    const out = toSdkSettings({ env: { FOO: "bar" } });
    expect(out.settings).toBeUndefined();
    expect(out.env).toEqual({ FOO: "bar" });
  });

  it("omits env when only settings are set", () => {
    const out = toSdkSettings({ outputStyle: "concise" });
    expect(out.env).toBeUndefined();
    expect(out.settings).toEqual({ outputStyle: "concise" });
  });
});
