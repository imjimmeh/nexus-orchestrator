import type { AcpAgentManifest } from '@nexus/core';
import { filterByPatterns } from '../common/plugin-runtime/plugin-filter.utils';

export function filterAcpAgents(
  agents: AcpAgentManifest[],
  includePatterns?: string[] | null,
  excludePatterns?: string[] | null,
): AcpAgentManifest[] {
  return filterByPatterns(
    agents,
    (agent) => agent.name,
    includePatterns,
    excludePatterns,
  );
}
