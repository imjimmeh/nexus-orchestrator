import { Injectable } from '@nestjs/common';
import { scheduleIdentitySchema } from '@nexus/core';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { ScheduleToolsHandler } from '../../handlers/schedule-tools.handler';

interface ScheduleIdentityParams {
  scheduled_job_id: string;
}

@Injectable()
export class GetScheduleTool implements IInternalToolHandler<ScheduleIdentityParams> {
  constructor(private readonly scheduleTools: ScheduleToolsHandler) {}

  getName(): string {
    return 'get_schedule';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['read_only', 'context'],
      description: 'Get scheduled job details by scheduled_job_id.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/schedules/get',
        bodyMapping: {
          scheduled_job_id: 'scheduled_job_id',
        },
      },
      inputSchema: scheduleIdentitySchema,
    };
  }

  execute(
    _context: InternalToolExecutionContext,
    params: ScheduleIdentityParams,
  ): Promise<Record<string, unknown>> {
    return this.scheduleTools.getSchedule(params.scheduled_job_id);
  }
}
