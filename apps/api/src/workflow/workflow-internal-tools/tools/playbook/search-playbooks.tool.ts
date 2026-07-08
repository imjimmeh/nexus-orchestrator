import { Injectable } from '@nestjs/common';
import { SearchPlaybooksInput, searchPlaybooksSchema } from '@nexus/core';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { AgentSkillsService } from '../../../../ai-config/services/agent-skills.service';

@Injectable()
export class SearchPlaybooksTool implements IInternalToolHandler<SearchPlaybooksInput> {
  constructor(private readonly skills: AgentSkillsService) {}

  getName(): string {
    return 'search_playbooks';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['read_only', 'context', 'skills'],
      description: 'Search orchestration playbooks by query and tags.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/playbooks/search',
        bodyMapping: {
          workflow_run_id: 'workflow_run_id',
          job_id: 'job_id',
          query: 'query',
          category: 'category',
          tags: 'tags',
          limit: 'limit',
          offset: 'offset',
        },
      },
      inputSchema: searchPlaybooksSchema,
    };
  }

  async execute(
    _context: InternalToolExecutionContext,
    params: SearchPlaybooksInput,
  ) {
    await Promise.resolve();
    const results = this.skills
      .searchSkills({ ...params, category: 'playbook' })
      .map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        category: skill.category,
        tags: skill.tags,
      }));

    return { results };
  }
}
