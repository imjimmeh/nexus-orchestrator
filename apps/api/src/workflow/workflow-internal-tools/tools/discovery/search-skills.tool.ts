import { Injectable } from '@nestjs/common';
import { searchSkillsSchema } from '@nexus/core';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { searchSeedManifests } from './advisor-discovery.repository';
import type { DiscoverySearchParams } from './advisor-discovery.repository.types';

@Injectable()
export class SearchSkillsTool implements IInternalToolHandler<DiscoverySearchParams> {
  getName(): string {
    return 'search_skills';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['read_only', 'context'],
      description: 'Search skill manifests for advisory evidence.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/skills/search',
        bodyMapping: {
          workflow_run_id: 'workflow_run_id',
          job_id: 'job_id',
          query: 'query',
          limit: 'limit',
          offset: 'offset',
        },
      },
      inputSchema: searchSkillsSchema,
    };
  }

  execute(
    _context: InternalToolExecutionContext,
    params: DiscoverySearchParams,
  ): Promise<Record<string, unknown>> {
    return searchSeedManifests('skills', params);
  }
}
