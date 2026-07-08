import {
  createHeartbeatProfileSchema,
  type CreateHeartbeatProfileRequest,
} from '@nexus/core';

export { createHeartbeatProfileSchema };

export class CreateHeartbeatProfileDto implements CreateHeartbeatProfileRequest {
  static get schema() {
    return createHeartbeatProfileSchema;
  }

  scopeId!: string;

  name!: string;

  enabled?: boolean;

  interval_seconds!: number;

  workflow_id!: string;

  payload_json?: Record<string, unknown>;

  created_by?: string;
}
