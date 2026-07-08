import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import yaml from 'js-yaml';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { AgentSkillsService } from '../../../../ai-config/services/agent-skills.service';
import { SkillValidationService } from '../../../../ai-config/skills/skill-validation.service';
import { stampRuntimeOrigin } from '../../../../ai-config/skills/skill-origin.helper';
import type { CreateSkillResult } from './create-skill.tool.types';
import { tryValidateSkillMarkdown } from './skill-tool-validation.helpers';

const createSkillSchema = z.object({
  name: z.string().min(1).max(64),
  skill_markdown: z.string().min(1).max(20480),
  source_proposal_id: z.string().optional(),
  generated_from_run_id: z.string().optional(),
});

type CreateSkillParams = z.infer<typeof createSkillSchema>;

interface FrontmatterShape {
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

@Injectable()
export class CreateSkillTool implements IInternalToolHandler<
  CreateSkillParams,
  CreateSkillResult
> {
  private readonly logger = new Logger(CreateSkillTool.name);

  constructor(
    private readonly agentSkillsService: AgentSkillsService,
    private readonly skillValidationService: SkillValidationService,
  ) {}

  getName(): string {
    return 'create_skill';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['mutating'],
      description: 'Create or update a skill in the skill library.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/skills/materialize',
        bodyMapping: {
          workflow_run_id: 'workflow_run_id',
          job_id: 'job_id',
          name: 'name',
          skill_markdown: 'skill_markdown',
          source_proposal_id: 'source_proposal_id',
          generated_from_run_id: 'generated_from_run_id',
        },
      },
      inputSchema: createSkillSchema,
    };
  }

  async execute(
    _context: InternalToolExecutionContext,
    params: CreateSkillParams,
  ): Promise<CreateSkillResult> {
    const enrichedMarkdown = this.injectProvenance(
      params.skill_markdown,
      params.source_proposal_id,
      params.generated_from_run_id,
    );

    // Machine-readable origin marker for Task 5 reseed detection.
    // Kept separate from the human-facing metadata injected by injectProvenance above.
    const stampedMarkdown = stampRuntimeOrigin(enrichedMarkdown, {
      source: 'agent_factory',
      source_proposal_id: params.source_proposal_id,
      generated_from_run_id: params.generated_from_run_id,
      stamped_at: new Date().toISOString(),
    });

    const rejection = tryValidateSkillMarkdown(
      this.skillValidationService,
      this.logger,
      params.name,
      stampedMarkdown,
    );
    if (rejection) {
      return {
        action: 'rejected' as const,
        name: params.name,
        scope: null,
        ...rejection,
      };
    }

    // description is re-derived from frontmatter by the service; pass empty string to satisfy the DTO type
    const { record, action } = await this.agentSkillsService.upsertSkill({
      name: params.name,
      description: '',
      skill_markdown: stampedMarkdown,
    });

    return {
      action,
      name: record.name,
      scope: record.scope,
      validated: true,
    };
  }

  private parseFrontmatterRaw(
    markdown: string,
  ): { raw: string; body: string } | null {
    const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(markdown);
    if (!match) return null;
    return { raw: match[1], body: markdown.slice(match[0].length) };
  }

  private injectProvenance(
    markdown: string,
    proposalId?: string,
    runId?: string,
  ): string {
    if (!proposalId && !runId) {
      return markdown;
    }

    const parsed = this.parseFrontmatterRaw(markdown);
    if (!parsed) {
      return markdown;
    }

    let frontmatterData: unknown;
    try {
      frontmatterData = yaml.load(parsed.raw);
    } catch {
      return markdown;
    }

    if (
      !frontmatterData ||
      typeof frontmatterData !== 'object' ||
      Array.isArray(frontmatterData)
    ) {
      return markdown;
    }

    const frontmatter = frontmatterData as FrontmatterShape;
    const existingMetadata: Record<string, unknown> =
      frontmatter.metadata &&
      typeof frontmatter.metadata === 'object' &&
      !Array.isArray(frontmatter.metadata)
        ? { ...frontmatter.metadata }
        : {};

    if (proposalId) {
      existingMetadata['source_proposal_id'] = proposalId;
    }

    if (runId) {
      existingMetadata['generated_from_run_id'] = runId;
    }

    const updatedFrontmatter: FrontmatterShape = {
      ...frontmatter,
      metadata: existingMetadata,
    };
    const serialized = yaml.dump(updatedFrontmatter, { lineWidth: -1 });

    return `---\n${serialized}---\n${parsed.body}`;
  }
}
