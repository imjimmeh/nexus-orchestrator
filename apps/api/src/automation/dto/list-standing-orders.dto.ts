import {
  listStandingOrdersSchema,
  type ListStandingOrdersRequest,
} from '@nexus/core';

export { listStandingOrdersSchema };

export class ListStandingOrdersDto implements ListStandingOrdersRequest {
  static get schema() {
    return listStandingOrdersSchema;
  }

  scopeId!: string;

  profile_name?: string;

  include_disabled?: boolean;

  limit: number = 50;

  offset: number = 0;
}
