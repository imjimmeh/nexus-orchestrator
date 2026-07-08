import { describe, it, expect } from "vitest";
import {
  generateHookExtensionSource,
  PI_HOOK_EVENT_BY_NEUTRAL,
} from "../src/contribution-hook-extension.js";

describe("generateHookExtensionSource", () => {
  it("returns null for no hooks (no file should be written)", () => {
    expect(generateHookExtensionSource([])).toBeNull();
  });

  it("maps neutral events to PI events", () => {
    expect(PI_HOOK_EVENT_BY_NEUTRAL).toEqual({
      session_start: "session_start",
      session_end: "session_shutdown",
      user_prompt_submit: "before_agent_start",
      pre_tool_use: "tool_call",
      post_tool_use: "tool_result",
    });
  });

  it("emits a default-export factory that registers a handler per hook", () => {
    const src = generateHookExtensionSource([
      { event: "session_start", command: "echo hi" },
      { event: "pre_tool_use", command: "guard.sh", timeoutMs: 5000 },
    ]);
    expect(src).not.toBeNull();
    expect(src as string).toContain("export default");
    expect(src as string).toContain('pi.on("session_start"');
    expect(src as string).toContain('pi.on("tool_call"');
    // pre_tool_use handler must be able to block
    expect(src as string).toContain("block");
  });

  it("safely encodes commands (no raw interpolation/injection into source)", () => {
    const src = generateHookExtensionSource([
      { event: "session_start", command: 'echo "a"; rm -rf /`backtick`' },
    ]) as string;
    // The command must be embedded as a JSON-encoded string literal, not spliced raw.
    expect(src).toContain(JSON.stringify('echo "a"; rm -rf /`backtick`'));
  });
});
