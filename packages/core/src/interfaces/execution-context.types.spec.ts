import { describe, it, expect } from "vitest";
import { createExecutionContext } from "./execution-context.types";

describe("ExecutionContext scope fields", () => {
  it("defaults the new scope fields to null", () => {
    const ctx = createExecutionContext();
    expect(ctx.scopeNodeId).toBeNull();
    expect(ctx.scopePath).toBeNull();
  });
  it("round-trips a provided scope path", () => {
    const ctx = createExecutionContext({
      scopeNodeId: "leaf",
      scopePath: ["root", "org", "leaf"],
    });
    expect(ctx.scopeNodeId).toBe("leaf");
    expect(ctx.scopePath).toEqual(["root", "org", "leaf"]);
  });
});
