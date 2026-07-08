/**
 * Name of the in-process SDK MCP server that exposes the Nexus kernel tool
 * catalog (set_job_output, query_memory, kanban.*, delegate_*, ...).
 *
 * The Claude Agent SDK presents these tools to the model — and to the
 * `canUseTool` permission callback — under the namespaced form
 * `mcp__<server>__<tool>`. The Nexus governance registry, however, knows the
 * canonical (un-prefixed) tool names, so the prefix must be stripped before a
 * permission check.
 */
export const NEXUS_KERNEL_MCP_SERVER = "nexus-kernel-tools";

const NEXUS_MCP_PREFIX = `mcp__${NEXUS_KERNEL_MCP_SERVER}__`;

/**
 * Returns the canonical tool name the governance registry understands.
 *
 * Strips the `mcp__nexus-kernel-tools__` prefix the SDK adds to in-process MCP
 * tools; SDK-native tool names (Bash, Read, ...) and tools from other MCP
 * servers are returned unchanged.
 */
export function stripNexusMcpPrefix(toolName: string): string {
  return toolName.startsWith(NEXUS_MCP_PREFIX)
    ? toolName.slice(NEXUS_MCP_PREFIX.length)
    : toolName;
}
