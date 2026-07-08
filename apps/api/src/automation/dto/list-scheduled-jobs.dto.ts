import {
  listScheduledJobsSchema,
  type ListScheduledJobsRequest,
} from '@nexus/core';

export { listScheduledJobsSchema };

export class ListScheduledJobsDto implements ListScheduledJobsRequest {
  static get schema() {
    return listScheduledJobsSchema;
  }

  scopeId?: string;

  scope?: ListScheduledJobsRequest['scope'];

  status?: ListScheduledJobsRequest['status'];

  limit: number = 50;

  offset: number = 0;
}
