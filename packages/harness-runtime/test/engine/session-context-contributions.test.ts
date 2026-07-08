import { describe, it, expect } from "vitest";
import type { HarnessSessionContext } from "../../src/engine/session-context.js";
import { EMPTY_HARNESS_CONTRIBUTIONS } from "@nexus/core";

describe("HarnessSessionContext.contributions", () => {
  it("carries the contributions bundle", () => {
    const ctx = {
      governedTools: [],
      toolCatalog: [],
      checkPermission: async () => ({ status: "allowed" as const }),
      workspacePath: "/w",
      agentDir: "/a",
      extensionsPath: "/e",
      sessionPath: "/s",
      contributions: EMPTY_HARNESS_CONTRIBUTIONS,
    } satisfies HarnessSessionContext;
    expect(ctx.contributions.hooks).toEqual([]);
  });
});
