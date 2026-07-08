import { describe, it, expect } from "vitest";
import { buildCanUseTool } from "../src/govern.js";

describe("buildCanUseTool", () => {
  it("allows when checkPermission returns allowed, echoing input as updatedInput", async () => {
    const can = buildCanUseTool(async () => ({ status: "allowed" }));
    // The SDK runtime schema requires `updatedInput` on an allow decision;
    // omitting it makes the SDK reject the permission with a ZodError.
    expect(await can("Bash", { command: "ls" }, {})).toEqual({
      behavior: "allow",
      updatedInput: { command: "ls" },
    });
  });
  it("denies with the policy reason", async () => {
    const can = buildCanUseTool(async () => ({
      status: "denied",
      reason: "blocked",
    }));
    expect(await can("Bash", { command: "rm -rf /" }, {})).toEqual({
      behavior: "deny",
      message: "blocked",
    });
  });
  it("treats approval_required as allow (pi parity)", async () => {
    const can = buildCanUseTool(async () => ({ status: "approval_required" }));
    expect(await can("Write", { path: "a.txt" }, {})).toEqual({
      behavior: "allow",
      updatedInput: { path: "a.txt" },
    });
  });
});
