import { describe, it, expect } from "vitest";
import { CanonicalCommandSchema } from "../../src/schemas/harness/commands.schema";

describe("CanonicalCommandSchema", () => {
  it("parses a prompt command", () => {
    expect(
      CanonicalCommandSchema.parse({ type: "prompt", message: "hi" }).type,
    ).toBe("prompt");
  });
  it("parses an abort command", () => {
    expect(CanonicalCommandSchema.parse({ type: "abort" }).type).toBe("abort");
  });
  it("parses a step_complete_result", () => {
    const c = {
      type: "step_complete_result",
      success: false,
      ok: false,
      missing_fields: ["x"],
    };
    expect(CanonicalCommandSchema.parse(c).type).toBe("step_complete_result");
  });
  it("rejects an unknown command", () => {
    expect(() => CanonicalCommandSchema.parse({ type: "explode" })).toThrow();
  });
});
