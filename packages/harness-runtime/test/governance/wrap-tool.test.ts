import { describe, it, expect, vi, beforeEach } from "vitest";
import { wrapToolWithGovernance } from "../../src/governance/wrap-tool.js";

interface DeniedToolResult {
  content: Array<{ type: string; text: string }>;
  details: { ok: boolean; error: string; reason?: string };
}

const tool = {
  name: "bash",
  description: "run",
  parameters: {},
  execute: vi.fn(async () => ({ content: [{ type: "text", text: "ran" }] })),
};

describe("wrapToolWithGovernance", () => {
  beforeEach(() => vi.clearAllMocks());

  it("executes the tool when permission is allowed", async () => {
    const wrapped = wrapToolWithGovernance(tool, async () => ({
      status: "allowed",
    }));
    const result = await wrapped.execute("c1", { command: "ls" });
    expect(tool.execute).toHaveBeenCalledOnce();
    expect(result).toEqual({ content: [{ type: "text", text: "ran" }] });
  });

  it("blocks the tool and returns an error result when denied", async () => {
    const wrapped = wrapToolWithGovernance(tool, async () => ({
      status: "denied",
      reason: "policy",
    }));
    const result = await wrapped.execute("c1", { command: "rm -rf /" });
    expect((result as DeniedToolResult).details.ok).toBe(false);
    expect((result as DeniedToolResult).details.error).toBe(
      "permission_denied",
    );
  });

  it("executes the tool when permission is approval_required", async () => {
    const wrapped = wrapToolWithGovernance(tool, async () => ({
      status: "approval_required",
    }));
    const result = await wrapped.execute("c1", { command: "ls" });
    expect(tool.execute).toHaveBeenCalledOnce();
    expect(result).toEqual({ content: [{ type: "text", text: "ran" }] });
  });
});
