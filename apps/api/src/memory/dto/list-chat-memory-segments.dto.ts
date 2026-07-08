import {
  listChatMemorySegmentsSchema,
  type ChatMemorySource,
  type ListChatMemorySegmentsRequest,
  type MemoryType,
} from '@nexus/core';

export type { ChatMemorySource } from '@nexus/core';

export class ListChatMemorySegmentsDto implements ListChatMemorySegmentsRequest {
  static get schema() {
    return listChatMemorySegmentsSchema;
  }

  source: ChatMemorySource = 'profile';

  memory_type?: MemoryType;

  query?: string;

  profile_id?: string;

  chat_session_id?: string;

  include_archived = false;

  only_undistilled = false;

  limit = 25;

  offset = 0;
}
