import { Injectable } from '@nestjs/common';
import { searchPlaybooksSchema } from '@nexus/core';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { searchSeedManifests } from './advisor-discovery.repository';
import type { DiscoverySearchParams } from './advisor-discovery.repository.types';

@Injectable()
export class SearchPlaybooksTool implements IInternalToolHandler<DiscoverySearchParams> {
  getName(): string {
    return 'search_playbooks';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['read_only', 'context'],
      description: 'Search playbooks for advisory evidence.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/playbooks/search',
        bodyMapping: {
          workflow_run_id: 'workflow_run_id',
          job_id: 'job_id',
          query: 'query',
          category: 'category',
          limit: 'limit',
          offset: 'offset',
        },
      },
      inputSchema: searchPlaybooksSchema,
    };
  }

  execute(
    _context: InternalToolExecutionContext,
    params: DiscoverySearchParams,
  ): Promise<Record<string, unknown>> {
    return searchSeedManifests('playbooks', params);
  }
}
