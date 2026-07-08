import {
  listHeartbeatProfilesSchema,
  type ListHeartbeatProfilesRequest,
} from '@nexus/core';

export { listHeartbeatProfilesSchema };

export class ListHeartbeatProfilesDto implements ListHeartbeatProfilesRequest {
  static get schema() {
    return listHeartbeatProfilesSchema;
  }

  scopeId!: string;

  limit: number = 50;

  offset: number = 0;
}
