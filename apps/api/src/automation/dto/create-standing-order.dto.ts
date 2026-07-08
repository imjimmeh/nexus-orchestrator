import {
  createStandingOrderSchema,
  type CreateStandingOrderRequest,
} from '@nexus/core';

export { createStandingOrderSchema };

export class CreateStandingOrderDto implements CreateStandingOrderRequest {
  static get schema() {
    return createStandingOrderSchema;
  }

  scopeId!: string;

  title!: string;

  instruction!: string;

  profile_name?: string;

  enabled?: boolean;

  priority?: number;

  override_policy?: CreateStandingOrderRequest['override_policy'];

  created_by?: string;
}
