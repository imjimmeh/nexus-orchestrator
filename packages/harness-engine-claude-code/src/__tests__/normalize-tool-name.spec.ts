import { describe, it, expect } from "vitest";
import { NEXUS_KERNEL_MCP_SERVER, stripNexusMcpPrefix } from "../mcp-server.js";

describe("stripNexusMcpPrefix", () => {
  it("strips the nexus-kernel-tools MCP prefix to the canonical tool name", () => {
    expect(
      stripNexusMcpPrefix(`mcp__${NEXUS_KERNEL_MCP_SERVER}__set_job_output`),
    ).toBe("set_job_output");
  });

  it("preserves underscores inside the canonical tool name", () => {
    expect(
      stripNexusMcpPrefix(
        `mcp__${NEXUS_KERNEL_MCP_SERVER}__read_skill_manifest`,
      ),
    ).toBe("read_skill_manifest");
  });

  it("leaves SDK-native (non-prefixed) tool names unchanged", () => {
    expect(stripNexusMcpPrefix("Bash")).toBe("Bash");
    expect(stripNexusMcpPrefix("Read")).toBe("Read");
  });

  it("leaves tools from other MCP servers unchanged", () => {
    expect(stripNexusMcpPrefix("mcp__other-server__do_thing")).toBe(
      "mcp__other-server__do_thing",
    );
  });
});
