import { Injectable } from '@nestjs/common';
import { createScheduleSchema } from '@nexus/core';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
  ScheduledJobScope,
  ScheduledJobType,
} from '@nexus/core';
import { ScheduleToolsHandler } from '../../handlers/schedule-tools.handler';

interface CreateScheduledJobParams {
  scope_id?: string;
  schedule_scope?: ScheduledJobScope;
  name: string;
  schedule_type: ScheduledJobType | string;
  schedule_expression: string;
  timezone?: string;
  workflow_id: string;
  payload_json?: Record<string, unknown>;
  created_by?: string;
}

@Injectable()
export class CreateScheduledJobTool implements IInternalToolHandler<CreateScheduledJobParams> {
  constructor(private readonly scheduleTools: ScheduleToolsHandler) {}

  getName(): string {
    return 'create_scheduled_job';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['mutating', 'approval_gated'],
      description: 'Create a scheduled job targeting a workflow.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/schedules/create',
        bodyMapping: {
          scope_id: 'scope_id',
          name: 'name',
          schedule_type: 'schedule_type',
          schedule_expression: 'schedule_expression',
          timezone: 'timezone',
          workflow_id: 'workflow_id',
          payload_json: 'payload_json',
        },
      },
      mutatingAction: 'create_scheduled_job',
      inputSchema: createScheduleSchema,
    };
  }

  execute(
    _context: InternalToolExecutionContext,
    params: CreateScheduledJobParams,
  ): Promise<Record<string, unknown>> {
    return this.scheduleTools.createSchedule(params);
  }
}
