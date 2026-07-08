import {
  createScheduledJobSchema,
  type CreateScheduledJobRequest,
} from '@nexus/core';

export { createScheduledJobSchema };

export class CreateScheduledJobDto implements CreateScheduledJobRequest {
  static get schema() {
    return createScheduledJobSchema;
  }

  schedule_scope?: CreateScheduledJobRequest['schedule_scope'];

  scopeId?: string;

  name!: string;

  schedule_type!: CreateScheduledJobRequest['schedule_type'];

  schedule_expression!: string;

  timezone?: string;

  workflow_id!: string;

  payload_json?: Record<string, unknown>;

  created_by?: string;
}
