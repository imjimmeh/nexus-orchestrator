import { Injectable } from '@nestjs/common';
import { updateScheduleSchema } from '@nexus/core';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
  ScheduledJobType,
} from '@nexus/core';
import { ScheduleToolsHandler } from '../../handlers/schedule-tools.handler';

interface UpdateScheduledJobParams {
  scheduled_job_id: string;
  name?: string;
  schedule_type?: ScheduledJobType | string;
  schedule_expression?: string;
  timezone?: string;
  workflow_id?: string;
  payload_json?: Record<string, unknown>;
  updated_by?: string;
}

@Injectable()
export class UpdateScheduledJobTool implements IInternalToolHandler<UpdateScheduledJobParams> {
  constructor(private readonly scheduleTools: ScheduleToolsHandler) {}

  getName(): string {
    return 'update_scheduled_job';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['mutating', 'approval_gated'],
      description: 'Update a scheduled job configuration.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/schedules/update',
        bodyMapping: {
          scheduled_job_id: 'scheduled_job_id',
          name: 'name',
          schedule_type: 'schedule_type',
          schedule_expression: 'schedule_expression',
          timezone: 'timezone',
          workflow_id: 'workflow_id',
          payload_json: 'payload_json',
        },
      },
      mutatingAction: 'update_scheduled_job',
      inputSchema: updateScheduleSchema,
    };
  }

  execute(
    _context: InternalToolExecutionContext,
    params: UpdateScheduledJobParams,
  ): Promise<Record<string, unknown>> {
    return this.scheduleTools.updateSchedule(params);
  }
}
