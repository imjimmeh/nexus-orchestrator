import { Injectable } from '@nestjs/common';
import { scheduleListBodySchema } from '@nexus/core';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
  ScheduledJobScope,
  ScheduledJobStatus,
} from '@nexus/core';
import { LIST_SCHEDULES_RUNTIME_CAPABILITY } from '../../../workflow-runtime/workflow-runtime-capability.contracts';
import { ScheduleToolsHandler } from '../../handlers/schedule-tools.handler';

interface ListSchedulesParams {
  scope_id?: string;
  scope?: ScheduledJobScope;
  status?: ScheduledJobStatus;
  limit?: number;
  offset?: number;
}

@Injectable()
export class ListSchedulesTool implements IInternalToolHandler<ListSchedulesParams> {
  constructor(private readonly scheduleTools: ScheduleToolsHandler) {}

  getName(): string {
    return 'list_schedules';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      ...LIST_SCHEDULES_RUNTIME_CAPABILITY,
      inputSchema: scheduleListBodySchema,
    };
  }

  execute(
    _context: InternalToolExecutionContext,
    params: ListSchedulesParams,
  ): Promise<Record<string, unknown>> {
    return this.scheduleTools.listSchedules(params);
  }
}
