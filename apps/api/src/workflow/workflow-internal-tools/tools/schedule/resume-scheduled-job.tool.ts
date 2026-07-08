import { Injectable } from '@nestjs/common';
import { scheduleIdentitySchema } from '@nexus/core';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { ScheduleToolsHandler } from '../../handlers/schedule-tools.handler';

interface ResumeScheduledJobParams {
  scheduled_job_id: string;
  updated_by?: string;
}

@Injectable()
export class ResumeScheduledJobTool implements IInternalToolHandler<ResumeScheduledJobParams> {
  constructor(private readonly scheduleTools: ScheduleToolsHandler) {}

  getName(): string {
    return 'resume_scheduled_job';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['mutating', 'approval_gated'],
      description: 'Resume a scheduled job by scheduled_job_id.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/schedules/resume',
        bodyMapping: {
          scheduled_job_id: 'scheduled_job_id',
        },
      },
      mutatingAction: 'resume_scheduled_job',
      inputSchema: scheduleIdentitySchema,
    };
  }

  execute(
    _context: InternalToolExecutionContext,
    params: ResumeScheduledJobParams,
  ): Promise<Record<string, unknown>> {
    return this.scheduleTools.resumeSchedule(params);
  }
}
