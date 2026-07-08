/**
 * Legacy guard: updated for Task 5 (EPIC-211) to test the descriptor-driven
 * `bridgeMcpServersToGovernedTools` in the minimal "no descriptors" cases.
 *
 * Full governance and connector behaviour is covered by the co-located
 * `src/contribution-mcp-bridge.spec.ts`.
 */
import { describe, it, expect } from "vitest";
import type { CheckPermission } from "@nexus/harness-runtime";
import { bridgeMcpServersToGovernedTools } from "../src/contribution-mcp-bridge.js";

const allow: CheckPermission = async () => ({ status: "allowed" });

describe("bridgeMcpServersToGovernedTools", () => {
  it("returns no tools and a no-op dispose for an empty descriptor list", async () => {
    const b = await bridgeMcpServersToGovernedTools([], allow);
    expect(b.tools).toEqual([]);
    await expect(b.dispose()).resolves.toBeUndefined();
  });
});
