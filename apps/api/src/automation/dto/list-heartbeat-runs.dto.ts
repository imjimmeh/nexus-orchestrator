import {
  listHeartbeatRunsSchema,
  type ListHeartbeatRunsRequest,
} from '@nexus/core';

export { listHeartbeatRunsSchema };

export class ListHeartbeatRunsDto implements ListHeartbeatRunsRequest {
  static get schema() {
    return listHeartbeatRunsSchema;
  }

  limit: number = 50;

  offset: number = 0;
}
