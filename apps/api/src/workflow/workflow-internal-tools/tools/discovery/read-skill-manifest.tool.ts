import { Injectable } from '@nestjs/common';
import { readSkillManifestSchema } from '@nexus/core';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { readSeedManifest } from './advisor-discovery.repository';

interface ReadSkillManifestParams {
  skill_name?: string;
  name?: string;
}

@Injectable()
export class ReadSkillManifestTool implements IInternalToolHandler<ReadSkillManifestParams> {
  getName(): string {
    return 'read_skill_manifest';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['read_only', 'context'],
      description: 'Read a skill manifest for advisory evidence.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/skills/read-manifest',
        bodyMapping: {
          workflow_run_id: 'workflow_run_id',
          job_id: 'job_id',
          skill_name: 'skill_name',
          name: 'name',
        },
      },
      inputSchema: readSkillManifestSchema,
    };
  }

  execute(
    _context: InternalToolExecutionContext,
    params: ReadSkillManifestParams,
  ): Promise<Record<string, unknown>> {
    return readSeedManifest('skill', params.skill_name ?? params.name ?? null);
  }
}
