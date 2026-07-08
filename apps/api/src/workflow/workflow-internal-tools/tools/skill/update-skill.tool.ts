import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { AgentSkillsService } from '../../../../ai-config/services/agent-skills.service';
import { SkillValidationService } from '../../../../ai-config/skills/skill-validation.service';
import {
  readRuntimeOrigin,
  stampRuntimeOrigin,
} from '../../../../ai-config/skills/skill-origin.helper';
import type { SkillScope } from '../../../../ai-config/services/agent-skill-library.service.types';
import type { UpdateSkillResult } from './update-skill.tool.types';
import {
  extractNameFromFrontmatter,
  tryValidateSkillMarkdown,
} from './skill-tool-validation.helpers';

const updateSkillSchema = z.object({
  skill_id: z.string().min(1).max(64),
  skill_markdown: z.string().min(1).max(20480),
});

type UpdateSkillParams = z.infer<typeof updateSkillSchema>;

@Injectable()
export class UpdateSkillTool implements IInternalToolHandler<
  UpdateSkillParams,
  UpdateSkillResult
> {
  private readonly logger = new Logger(UpdateSkillTool.name);

  constructor(
    private readonly agentSkillsService: AgentSkillsService,
    private readonly skillValidationService: SkillValidationService,
  ) {}

  getName(): string {
    return 'update_skill';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['mutating'],
      description:
        'Update an existing skill in the skill library with new markdown content.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/skills/materialize-update',
        bodyMapping: {
          workflow_run_id: 'workflow_run_id',
          job_id: 'job_id',
          skill_id: 'skill_id',
          skill_markdown: 'skill_markdown',
        },
      },
      inputSchema: updateSkillSchema,
    };
  }

  execute(
    _context: InternalToolExecutionContext,
    params: UpdateSkillParams,
  ): Promise<UpdateSkillResult> {
    const skillName = extractNameFromFrontmatter(
      params.skill_markdown,
      params.skill_id,
    );

    const markdownWithOrigin = this.preserveOrigin(
      params.skill_markdown,
      params.skill_id,
    );

    const rejection = tryValidateSkillMarkdown(
      this.skillValidationService,
      this.logger,
      skillName,
      markdownWithOrigin,
    );
    if (rejection) {
      const scope = this.resolveCurrentScope(params.skill_id);
      return Promise.resolve({ name: skillName, scope, ...rejection });
    }

    const record = this.agentSkillsService.updateSkill(params.skill_id, {
      skill_markdown: markdownWithOrigin,
    });

    return Promise.resolve({
      name: record.name,
      scope: record.scope,
      validated: true,
    });
  }

  /**
   * Re-applies an existing `nexus_origin` marker from the stored skill onto
   * the incoming markdown so the marker survives edits. If the stored skill
   * has no marker (seed/admin skill), the incoming markdown is returned
   * unchanged — markers are never added during update, only preserved.
   * Fail-soft: any error (skill not found, parse failure) returns the
   * incoming markdown unmodified.
   */
  private preserveOrigin(newMarkdown: string, skillId: string): string {
    try {
      const existing = this.agentSkillsService.getSkill(skillId);
      const existingOrigin = readRuntimeOrigin(existing.skillMarkdown);
      if (!existingOrigin) return newMarkdown;
      return stampRuntimeOrigin(newMarkdown, existingOrigin);
    } catch {
      return newMarkdown;
    }
  }

  private resolveCurrentScope(skillId: string): SkillScope | null {
    try {
      return this.agentSkillsService.getSkill(skillId).scope;
    } catch {
      return null;
    }
  }
}
