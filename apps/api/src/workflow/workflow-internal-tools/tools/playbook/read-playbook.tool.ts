import { BadRequestException, Injectable } from '@nestjs/common';
import { PlaybookIdentityInput, playbookIdentitySchema } from '@nexus/core';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { AgentSkillsService } from '../../../../ai-config/services/agent-skills.service';

@Injectable()
export class ReadPlaybookTool implements IInternalToolHandler<PlaybookIdentityInput> {
  constructor(private readonly skills: AgentSkillsService) {}

  getName(): string {
    return 'read_playbook';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['read_only', 'context', 'skills'],
      description: 'Read an orchestration playbook content.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/playbooks/read',
        bodyMapping: {
          workflow_run_id: 'workflow_run_id',
          job_id: 'job_id',
          playbook_id: 'playbook_id',
        },
      },
      inputSchema: playbookIdentitySchema,
    };
  }

  async execute(
    _context: InternalToolExecutionContext,
    params: PlaybookIdentityInput,
  ) {
    await Promise.resolve();
    const skill = this.skills.getSkill(params.playbook_id);

    if (skill.category !== 'playbook') {
      throw new BadRequestException(
        `Skill '${params.playbook_id}' is not a playbook (category: ${skill.category})`,
      );
    }

    return {
      playbook: {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        tags: skill.tags,
        contentMarkdown: skill.skillMarkdown,
      },
    };
  }
}
