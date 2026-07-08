import { Injectable } from '@nestjs/common';
import { listScheduleRunsSchema } from '@nexus/core';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { ScheduleToolsHandler } from '../../handlers/schedule-tools.handler';

interface ListScheduleRunsParams {
  scheduled_job_id: string;
  limit?: number;
  offset?: number;
}

@Injectable()
export class ListScheduleRunsTool implements IInternalToolHandler<ListScheduleRunsParams> {
  constructor(private readonly scheduleTools: ScheduleToolsHandler) {}

  getName(): string {
    return 'list_schedule_runs';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['read_only', 'diagnostic'],
      description: 'List execution history for a scheduled job.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/schedules/runs',
        bodyMapping: {
          scheduled_job_id: 'scheduled_job_id',
          limit: 'limit',
          offset: 'offset',
        },
      },
      inputSchema: listScheduleRunsSchema,
    };
  }

  execute(
    _context: InternalToolExecutionContext,
    params: ListScheduleRunsParams,
  ): Promise<Record<string, unknown>> {
    return this.scheduleTools.listScheduleRuns(params);
  }
}
