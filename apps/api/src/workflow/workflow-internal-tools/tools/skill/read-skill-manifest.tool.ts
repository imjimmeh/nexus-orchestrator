import { Injectable } from '@nestjs/common';
import {
  SkillManifestIdentityInput,
  skillManifestIdentitySchema,
} from '@nexus/core';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { AgentSkillsService } from '../../../../ai-config/services/agent-skills.service';

@Injectable()
export class ReadSkillManifestTool implements IInternalToolHandler<SkillManifestIdentityInput> {
  constructor(private readonly skills: AgentSkillsService) {}

  getName(): string {
    return 'read_skill_manifest';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['read_only', 'context', 'skills'],
      description: 'Read a skill manifest including SKILL.md content.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/skills/read-manifest',
        bodyMapping: {
          workflow_run_id: 'workflow_run_id',
          job_id: 'job_id',
          skill_id: 'skill_id',
          skill_name: 'skill_name',
          name: 'name',
          skill_dir: 'skill_dir',
        },
      },
      inputSchema: skillManifestIdentitySchema,
    };
  }

  async execute(
    _context: InternalToolExecutionContext,
    params: SkillManifestIdentityInput,
  ) {
    await Promise.resolve();
    const skillId =
      params.skill_id ?? params.skill_name ?? params.name ?? params.skill_dir;
    if (!skillId) {
      throw new Error('skill_id, skill_name, name, or skill_dir is required');
    }

    const skill = this.skills.getSkill(skillId);
    return {
      skill: {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        category: skill.category,
        tags: skill.tags,
        compatibility: skill.compatibility,
        metadata: skill.metadata,
        version: skill.version,
        skillMarkdown: skill.skillMarkdown,
      },
    };
  }
}
