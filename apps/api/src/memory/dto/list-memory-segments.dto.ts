import {
  listMemorySegmentsSchema,
  type ListMemorySegmentsRequest,
  type MemoryType,
} from '@nexus/core';

export class ListMemorySegmentsDto implements ListMemorySegmentsRequest {
  static get schema() {
    return listMemorySegmentsSchema;
  }

  memory_type?: MemoryType;

  query?: string;

  entity_id?: string;

  limit = 25;

  offset = 0;
}
