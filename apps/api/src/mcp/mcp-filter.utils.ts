import type { McpRemoteTool } from '@nexus/core';
import { filterByPatterns } from '../common/plugin-runtime/plugin-filter.utils';

export function filterMcpTools(
  tools: McpRemoteTool[],
  includePatterns?: string[] | null,
  excludePatterns?: string[] | null,
): McpRemoteTool[] {
  return filterByPatterns(
    tools,
    (tool) => tool.name,
    includePatterns,
    excludePatterns,
  );
}
