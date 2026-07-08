import { Injectable } from '@nestjs/common';
import { SearchSkillsInput, searchSkillsSchema } from '@nexus/core';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { AgentSkillsService } from '../../../../ai-config/services/agent-skills.service';

@Injectable()
export class SearchSkillsTool implements IInternalToolHandler<SearchSkillsInput> {
  constructor(private readonly skills: AgentSkillsService) {}

  getName(): string {
    return 'search_skills';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['read_only', 'context', 'skills'],
      description: 'Search active skills by query, category, and tags.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/skills/search',
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
      inputSchema: searchSkillsSchema,
    };
  }

  async execute(
    _context: InternalToolExecutionContext,
    params: SearchSkillsInput,
  ) {
    await Promise.resolve();
    const results = this.skills.searchSkills(params).map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      category: skill.category,
      tags: skill.tags,
    }));

    return { results };
  }
}
