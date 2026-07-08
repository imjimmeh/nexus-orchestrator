import { describe, it, expect, vi } from "vitest";
import { toSdkTool } from "../src/to-sdk-tool.js";

describe("toSdkTool", () => {
  it("wraps a CanonicalToolSpec and forwards invocation", async () => {
    const invoke = vi.fn(async () => ({
      content: [{ type: "text", text: "ok" }],
    }));
    const spec = {
      name: "spawn_subagent_async",
      description: "spawn",
      parameters: { type: "object", properties: {} },
      invoke,
    };
    const sdkTool = toSdkTool(spec);
    expect(sdkTool.name).toBe("spawn_subagent_async");
    await sdkTool.handler({ task: "x" });
    expect(invoke).toHaveBeenCalledWith({ task: "x" });
  });
});
