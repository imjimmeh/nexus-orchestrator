import type {
  ChatMemorySource,
  ListChatMemorySegmentsRequest,
  ListMemorySegmentsRequest,
} from "@/lib/api/memory.types";
import type { MemoryTypeFilter } from "./MemoryExplorer.types";

export const MEMORY_EXPLORER_PAGE_SIZE = 25;

interface BuildMemoryRequestParams {
  memoryType: MemoryTypeFilter;
  queryText: string;
  limit: number;
  offset: number;
  entityId?: string;
}

interface BuildChatMemoryRequestParams {
  source: ChatMemorySource;
  memoryType: MemoryTypeFilter;
  queryText: string;
  profileId: string;
  chatSessionId: string;
  includeArchived: boolean;
  onlyUndistilled: boolean;
  limit: number;
  offset: number;
}

export function buildMemoryRequest(
  params: BuildMemoryRequestParams,
): ListMemorySegmentsRequest {
  return {
    entity_id: params.entityId,
    memory_type: params.memoryType === "all" ? undefined : params.memoryType,
    query: params.queryText,
    limit: params.limit,
    offset: params.offset,
  };
}

export function buildChatMemoryRequest(
  params: BuildChatMemoryRequestParams,
): ListChatMemorySegmentsRequest {
  return {
    source: params.source,
    memory_type: params.memoryType === "all" ? undefined : params.memoryType,
    query: params.queryText,
    profile_id: params.profileId,
    chat_session_id: params.chatSessionId,
    include_archived: params.includeArchived,
    only_undistilled: params.onlyUndistilled,
    limit: params.limit,
    offset: params.offset,
  };
}
