import type { ToolRegistrySource } from "@nexus/core";

const TOOL_SOURCE_LABELS: Record<ToolRegistrySource, string> = {
  manual: "Custom",
  decorator_provider: "Built-in",
  internal_tool_handler: "Built-in",
  external_mcp: "MCP",
  external_acp: "ACP",
};

const TOOL_SOURCE_DESCRIPTIONS: Record<ToolRegistrySource, string> = {
  manual: "",
  decorator_provider: "Implemented in code.",
  internal_tool_handler: "Implemented in code.",
  external_mcp: "Synced from an MCP server.",
  external_acp: "Synced from an ACP server.",
};

export function isManualToolSource(source: ToolRegistrySource): boolean {
  return source === "manual";
}

export function getToolSourceLabel(source: ToolRegistrySource): string {
  return TOOL_SOURCE_LABELS[source];
}

export function getToolSourceDescription(source: ToolRegistrySource): string {
  return TOOL_SOURCE_DESCRIPTIONS[source];
}
