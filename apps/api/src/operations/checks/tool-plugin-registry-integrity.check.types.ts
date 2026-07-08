import { McpServerStatus } from '@nexus/core';

export interface ToolPluginRegistryServerSnapshot {
  id: string;
  name: string;
  enabled: boolean;
  last_status: McpServerStatus;
  last_discovered_tool_count?: number | null;
}

export interface ToolPluginRegistryToolSnapshot {
  name: string;
}

export interface ToolPluginRegistryPerServerToolCount {
  id: string;
  name: string;
  enabled: boolean;
  last_status: McpServerStatus;
  expected_count: number | null;
  actual_count: number;
}

export interface ToolPluginRegistryAnalysis {
  mcpTools: ToolPluginRegistryToolSnapshot[];
  enabledFailedServerIds: string[];
  enabledUnknownServerIds: string[];
  mismatchedDiscoveredCounts: ToolPluginRegistryPerServerToolCount[];
  disabledServersWithTools: ToolPluginRegistryPerServerToolCount[];
  orphanMcpToolNames: string[];
  perServerToolCounts: ToolPluginRegistryPerServerToolCount[];
}
