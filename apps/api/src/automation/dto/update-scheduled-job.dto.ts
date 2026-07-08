import {
  type UpdateScheduledJobRequest,
  updateScheduledJobSchema,
} from '@nexus/core';

export { updateScheduledJobSchema };

export class UpdateScheduledJobDto implements UpdateScheduledJobRequest {
  static get schema() {
    return updateScheduledJobSchema;
  }

  name?: string;

  schedule_type?: UpdateScheduledJobRequest['schedule_type'];

  schedule_expression?: string;

  timezone?: string;

  workflow_id?: string;

  payload_json?: Record<string, unknown>;

  updated_by?: string;
}
