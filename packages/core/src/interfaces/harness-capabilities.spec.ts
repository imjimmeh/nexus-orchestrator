import { describe, it, expect } from "vitest";
import {
  PI_CAPABILITIES,
  CLAUDE_CODE_CAPABILITIES,
} from "./harness-capabilities";

describe("harness capabilities", () => {
  it("PI uses file_injection resume mechanism", () => {
    expect(PI_CAPABILITIES.resumeMechanism).toBe("file_injection");
  });

  it("Claude Code uses config_ref resume mechanism", () => {
    expect(CLAUDE_CODE_CAPABILITIES.resumeMechanism).toBe("config_ref");
  });
});

describe("harness capabilities — contribution flags", () => {
  it("Claude Code declares hook/extension/settings support", () => {
    expect(CLAUDE_CODE_CAPABILITIES.supportsHooks).toBe(true);
    expect(CLAUDE_CODE_CAPABILITIES.supportsExtensions).toBe(true);
    expect(CLAUDE_CODE_CAPABILITIES.supportsSettings).toBe(true);
  });

  it("Claude Code exposes all five hook events", () => {
    expect(CLAUDE_CODE_CAPABILITIES.supportedHookEvents).toHaveLength(5);
    expect(CLAUDE_CODE_CAPABILITIES.supportedHookEvents).toEqual(
      expect.arrayContaining([
        "session_start",
        "session_end",
        "pre_tool_use",
        "post_tool_use",
        "user_prompt_submit",
      ]),
    );
  });

  it("PI declares hook + extension contribution support (no settings)", () => {
    expect(PI_CAPABILITIES.supportsHooks).toBe(true);
    expect(PI_CAPABILITIES.supportsExtensions).toBe(true);
    expect(PI_CAPABILITIES.supportsSettings ?? false).toBe(false);
    expect(PI_CAPABILITIES.supportedHookEvents).toEqual(
      expect.arrayContaining([
        "session_start",
        "session_end",
        "pre_tool_use",
        "post_tool_use",
        "user_prompt_submit",
      ]),
    );
    expect(PI_CAPABILITIES.supportedHookEvents).toHaveLength(5);
  });
});

describe("harness capabilities — plugin/extension flags", () => {
  it("PI supports extension packages but not plugins", () => {
    expect(PI_CAPABILITIES.supportsExtensionPackages).toBe(true);
    expect(PI_CAPABILITIES.supportsPlugins).toBe(false);
  });

  it("Claude Code supports plugins (provisional) but not extension packages", () => {
    expect(CLAUDE_CODE_CAPABILITIES.supportsPlugins).toBe(true);
    expect(CLAUDE_CODE_CAPABILITIES.supportsExtensionPackages).toBe(false);
  });

  it('PI supportedAssetSources includes "authored"', () => {
    expect(PI_CAPABILITIES.supportedAssetSources).toContain("authored");
  });

  it('Claude Code supportedAssetSources includes "authored"', () => {
    expect(CLAUDE_CODE_CAPABILITIES.supportedAssetSources).toContain(
      "authored",
    );
  });

  it("PI supportedAssetSources covers authored, git, and registry", () => {
    expect(PI_CAPABILITIES.supportedAssetSources).toEqual(
      expect.arrayContaining(["authored", "git", "registry"]),
    );
    expect(PI_CAPABILITIES.supportedAssetSources).toHaveLength(3);
  });

  it("Claude Code supportedAssetSources covers authored and git (not registry)", () => {
    expect(CLAUDE_CODE_CAPABILITIES.supportedAssetSources).toEqual(
      expect.arrayContaining(["authored", "git"]),
    );
    expect(CLAUDE_CODE_CAPABILITIES.supportedAssetSources).toHaveLength(2);
    expect(CLAUDE_CODE_CAPABILITIES.supportedAssetSources).not.toContain(
      "registry",
    );
  });
});
