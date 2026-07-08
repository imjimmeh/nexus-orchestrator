import { describe, expect, it } from "vitest";
import {
  getToolSourceDescription,
  getToolSourceLabel,
  isManualToolSource,
} from "./tool-source";

describe("tool-source", () => {
  it("labels manual tools as Custom and reports them as manual", () => {
    expect(getToolSourceLabel("manual")).toBe("Custom");
    expect(isManualToolSource("manual")).toBe(true);
  });

  it.each([
    ["decorator_provider", "Built-in"],
    ["internal_tool_handler", "Built-in"],
    ["external_mcp", "MCP"],
    ["external_acp", "ACP"],
  ] as const)(
    "labels %s tools as %s and reports them as non-manual",
    (source, label) => {
      expect(getToolSourceLabel(source)).toBe(label);
      expect(isManualToolSource(source)).toBe(false);
    },
  );

  it("describes built-in and synced tools by their implementation", () => {
    expect(getToolSourceDescription("decorator_provider")).toBe(
      "Implemented in code.",
    );
    expect(getToolSourceDescription("internal_tool_handler")).toBe(
      "Implemented in code.",
    );
    expect(getToolSourceDescription("external_mcp")).toBe(
      "Synced from an MCP server.",
    );
    expect(getToolSourceDescription("external_acp")).toBe(
      "Synced from an ACP server.",
    );
  });
});
