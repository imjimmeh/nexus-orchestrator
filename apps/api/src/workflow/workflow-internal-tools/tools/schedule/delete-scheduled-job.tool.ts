import { Injectable } from '@nestjs/common';
import { scheduleIdentitySchema } from '@nexus/core';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { ScheduleToolsHandler } from '../../handlers/schedule-tools.handler';

interface DeleteScheduledJobParams {
  scheduled_job_id: string;
}

@Injectable()
export class DeleteScheduledJobTool implements IInternalToolHandler<DeleteScheduledJobParams> {
  constructor(private readonly scheduleTools: ScheduleToolsHandler) {}

  getName(): string {
    return 'delete_scheduled_job';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['mutating', 'approval_gated'],
      description: 'Delete a scheduled job by scheduled_job_id.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/schedules/delete',
        bodyMapping: {
          scheduled_job_id: 'scheduled_job_id',
        },
      },
      mutatingAction: 'delete_scheduled_job',
      inputSchema: scheduleIdentitySchema,
    };
  }

  execute(
    _context: InternalToolExecutionContext,
    params: DeleteScheduledJobParams,
  ): Promise<Record<string, unknown>> {
    return this.scheduleTools.deleteSchedule(params.scheduled_job_id);
  }
}
