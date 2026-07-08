import { Injectable } from '@nestjs/common';
import { readPlaybookSchema } from '@nexus/core';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { readSeedManifest } from './advisor-discovery.repository';

interface ReadPlaybookParams {
  playbook_id?: string;
  name?: string;
}

@Injectable()
export class ReadPlaybookTool implements IInternalToolHandler<ReadPlaybookParams> {
  getName(): string {
    return 'read_playbook';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['read_only', 'context'],
      description: 'Read a playbook for advisory evidence.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/playbooks/read',
        bodyMapping: {
          workflow_run_id: 'workflow_run_id',
          job_id: 'job_id',
          playbook_id: 'playbook_id',
          name: 'name',
        },
      },
      inputSchema: readPlaybookSchema,
    };
  }

  execute(
    _context: InternalToolExecutionContext,
    params: ReadPlaybookParams,
  ): Promise<Record<string, unknown>> {
    return readSeedManifest(
      'playbook',
      params.playbook_id ?? params.name ?? null,
    );
  }
}
