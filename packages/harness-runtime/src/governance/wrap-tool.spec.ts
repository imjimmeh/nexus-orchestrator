import { describe, expect, it } from "vitest";
import { wrapToolWithGovernance } from "./wrap-tool.js";
import { GOVERNANCE_AUTH_FAILED_CODE } from "./check-permission-client.js";

const tool = {
  name: "step_complete",
  description: "",
  parameters: {},
  execute: async () => ({ content: [], details: { ok: true } }),
};

describe("wrapToolWithGovernance", () => {
  it("terminates on an auth-failed denial without calling the tool", async () => {
    let called = false;
    const wrapped = wrapToolWithGovernance(
      {
        ...tool,
        execute: async () => {
          called = true;
          return { content: [] };
        },
      },
      async () => ({
        status: "denied",
        code: GOVERNANCE_AUTH_FAILED_CODE,
        reason: "Governance check failed (HTTP 401): Unauthorized",
      }),
    );
    const result = (await wrapped.execute("c1", {})) as {
      details: { ok: boolean; error: string };
      terminate?: boolean;
    };
    expect(called).toBe(false);
    expect(result.details.ok).toBe(false);
    expect(result.details.error).toBe(GOVERNANCE_AUTH_FAILED_CODE);
    expect(result.terminate).toBe(true);
  });

  it("keeps a plain policy denial soft (no terminate)", async () => {
    const wrapped = wrapToolWithGovernance(tool, async () => ({
      status: "denied",
      reason: "policy",
    }));
    const result = (await wrapped.execute("c1", {})) as {
      details: { error: string };
      terminate?: boolean;
    };
    expect(result.details.error).toBe("permission_denied");
    expect(result.terminate).toBeUndefined();
  });

  it("delegates to the tool when allowed", async () => {
    let called = false;
    const wrapped = wrapToolWithGovernance(
      {
        ...tool,
        execute: async () => {
          called = true;
          return { content: [], details: { ok: true } };
        },
      },
      async () => ({ status: "allowed" }),
    );
    await wrapped.execute("c1", {});
    expect(called).toBe(true);
  });
});
