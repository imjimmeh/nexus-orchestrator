import { Injectable } from '@nestjs/common';
import { scheduleIdentitySchema } from '@nexus/core';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { ScheduleToolsHandler } from '../../handlers/schedule-tools.handler';

interface RunScheduledJobNowParams {
  scheduled_job_id: string;
}

@Injectable()
export class RunScheduledJobNowTool implements IInternalToolHandler<RunScheduledJobNowParams> {
  constructor(private readonly scheduleTools: ScheduleToolsHandler) {}

  getName(): string {
    return 'run_scheduled_job_now';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['mutating', 'approval_gated'],
      description: 'Trigger immediate execution of a scheduled job.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/schedules/run-now',
        bodyMapping: {
          scheduled_job_id: 'scheduled_job_id',
        },
      },
      mutatingAction: 'run_scheduled_job_now',
      inputSchema: scheduleIdentitySchema,
    };
  }

  execute(
    _context: InternalToolExecutionContext,
    params: RunScheduledJobNowParams,
  ): Promise<Record<string, unknown>> {
    return this.scheduleTools.runScheduleNow(params.scheduled_job_id);
  }
}
