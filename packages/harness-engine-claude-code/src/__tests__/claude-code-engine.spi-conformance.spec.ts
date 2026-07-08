import { describe, it, expect } from "vitest";
import { CLAUDE_CODE_CAPABILITIES } from "@nexus/core";
import {
  isHookMaterializer,
  isExtensionMaterializer,
  isSettingsMaterializer,
} from "@nexus/harness-runtime";
import { ClaudeCodeEngine } from "../claude-code-engine.js";

describe("Claude Code SPI conformance", () => {
  it("implements a materializer for every declared contribution capability", () => {
    const engine = new ClaudeCodeEngine();
    if (CLAUDE_CODE_CAPABILITIES.supportsHooks)
      expect(isHookMaterializer(engine)).toBe(true);
    if (CLAUDE_CODE_CAPABILITIES.supportsExtensions)
      expect(isExtensionMaterializer(engine)).toBe(true);
    if (CLAUDE_CODE_CAPABILITIES.supportsSettings)
      expect(isSettingsMaterializer(engine)).toBe(true);
  });
});
