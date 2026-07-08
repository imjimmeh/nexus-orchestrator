import { describe, it, expect } from "vitest";
import { toSdkTool } from "./to-sdk-tool.js";
import type { CanonicalToolSpec } from "@nexus/harness-runtime";

function specReturning(result: unknown): CanonicalToolSpec {
  return {
    name: "demo.tool",
    description: "demo",
    parameters: { type: "object", properties: {} },
    invoke: async () => result,
  };
}

describe("toSdkTool", () => {
  it("marks the SDK result is_error when details.ok is false", async () => {
    const tool = toSdkTool(
      specReturning({
        content: [{ type: "text", text: "boom" }],
        details: { ok: false },
      }),
    );
    const out = (await tool.handler({})) as {
      content: unknown[];
      isError?: boolean;
    };
    expect(out.isError).toBe(true);
    expect(out.content).toEqual([{ type: "text", text: "boom" }]);
  });

  it("leaves is_error falsy for a successful result", async () => {
    const tool = toSdkTool(
      specReturning({
        content: [{ type: "text", text: "ok" }],
        details: { ok: true },
      }),
    );
    const out = (await tool.handler({})) as { isError?: boolean };
    expect(out.isError ?? false).toBe(false);
  });

  it("calls onTerminate when the tool result requests termination", async () => {
    let terminated = false;
    const tool = toSdkTool(
      specReturning({
        content: [{ type: "text", text: "suspended" }],
        details: { ok: true },
        terminate: true,
      }),
      {
        onTerminate: () => {
          terminated = true;
        },
      },
    );
    await tool.handler({});
    expect(terminated).toBe(true);
  });

  it("does not call onTerminate for a normal result", async () => {
    let terminated = false;
    const tool = toSdkTool(
      specReturning({
        content: [{ type: "text", text: "ok" }],
        details: { ok: true },
      }),
      {
        onTerminate: () => {
          terminated = true;
        },
      },
    );
    await tool.handler({});
    expect(terminated).toBe(false);
  });
});
