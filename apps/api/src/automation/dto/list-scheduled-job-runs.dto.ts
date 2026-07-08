import {
  listScheduledJobRunsSchema,
  type ListScheduledJobRunsRequest,
} from '@nexus/core';

export { listScheduledJobRunsSchema };

export class ListScheduledJobRunsDto implements ListScheduledJobRunsRequest {
  static get schema() {
    return listScheduledJobRunsSchema;
  }

  limit: number = 50;

  offset: number = 0;
}
