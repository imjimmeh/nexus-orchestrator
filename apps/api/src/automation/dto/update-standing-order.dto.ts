import {
  type UpdateStandingOrderRequest,
  updateStandingOrderSchema,
} from '@nexus/core';

export { updateStandingOrderSchema };

export class UpdateStandingOrderDto implements UpdateStandingOrderRequest {
  static get schema() {
    return updateStandingOrderSchema;
  }

  title?: string;

  instruction?: string;

  profile_name?: string;

  enabled?: boolean;

  priority?: number;

  override_policy?: UpdateStandingOrderRequest['override_policy'];

  updated_by?: string;
}
