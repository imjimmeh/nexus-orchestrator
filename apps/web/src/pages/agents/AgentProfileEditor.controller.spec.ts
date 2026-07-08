import { describe, it, expect } from "vitest";
import { buildProfileData } from "./AgentProfileEditor.controller";

describe("buildProfileData runtime_toolchains", () => {
  it("includes runtime_toolchains when toolchains present", () => {
    const out = buildProfileData({
      name: "x",
      allowed_tools: [],
      denied_tools: [],
      approval_required_tools: [],
      fallback_chain: [],
      runtime_toolchains: { toolchains: [{ tool: "python", version: "3.12" }] },
    } as any);
    expect(out.runtime_toolchains).toEqual({
      toolchains: [{ tool: "python", version: "3.12" }],
    });
  });

  it("sends undefined when no toolchains", () => {
    const out = buildProfileData({
      name: "x",
      allowed_tools: [],
      denied_tools: [],
      approval_required_tools: [],
      fallback_chain: [],
      runtime_toolchains: { toolchains: [] },
    } as any);
    expect(out.runtime_toolchains).toBeUndefined();
  });
});
