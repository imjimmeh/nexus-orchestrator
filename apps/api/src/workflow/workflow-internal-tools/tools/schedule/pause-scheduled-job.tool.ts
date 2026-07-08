import { Injectable } from '@nestjs/common';
import { scheduleIdentitySchema } from '@nexus/core';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { ScheduleToolsHandler } from '../../handlers/schedule-tools.handler';

interface PauseScheduledJobParams {
  scheduled_job_id: string;
  updated_by?: string;
}

@Injectable()
export class PauseScheduledJobTool implements IInternalToolHandler<PauseScheduledJobParams> {
  constructor(private readonly scheduleTools: ScheduleToolsHandler) {}

  getName(): string {
    return 'pause_scheduled_job';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['mutating', 'approval_gated'],
      description: 'Pause a scheduled job by scheduled_job_id.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/schedules/pause',
        bodyMapping: {
          scheduled_job_id: 'scheduled_job_id',
        },
      },
      mutatingAction: 'pause_scheduled_job',
      inputSchema: scheduleIdentitySchema,
    };
  }

  execute(
    _context: InternalToolExecutionContext,
    params: PauseScheduledJobParams,
  ): Promise<Record<string, unknown>> {
    return this.scheduleTools.pauseSchedule(params);
  }
}
