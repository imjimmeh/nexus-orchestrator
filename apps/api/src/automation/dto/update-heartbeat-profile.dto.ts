import {
  type UpdateHeartbeatProfileRequest,
  updateHeartbeatProfileSchema,
} from '@nexus/core';

export { updateHeartbeatProfileSchema };

export class UpdateHeartbeatProfileDto implements UpdateHeartbeatProfileRequest {
  static get schema() {
    return updateHeartbeatProfileSchema;
  }

  name?: string;

  enabled?: boolean;

  interval_seconds?: number;

  workflow_id?: string;

  payload_json?: Record<string, unknown>;

  updated_by?: string;
}
