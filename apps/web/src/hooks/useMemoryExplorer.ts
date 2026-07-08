import { useQuery } from "@tanstack/react-query";
import { memoryApi } from "@/lib/api/memory";
import type {
  ListChatMemorySegmentsRequest,
  ListMemorySegmentsRequest,
} from "@/lib/api/memory.types";
import { MemorySegmentType } from "@/lib/api/chat-sessions.types";
import { queryKeys } from "@/lib/queryKeys";

const DEFAULT_PAGE_LIMIT = 25;
const DEFAULT_PAGE_OFFSET = 0;

function normalizeOptionalText(value?: string): string | undefined {
  const trimmedValue = value?.trim();
  return trimmedValue && trimmedValue.length > 0 ? trimmedValue : undefined;
}

function normalizeParams(params?: ListMemorySegmentsRequest): {
  entity_id?: string;
  memory_type?: MemorySegmentType;
  query?: string;
  limit: number;
  offset: number;
} {
  return {
    entity_id: normalizeOptionalText(params?.entity_id),
    memory_type: params?.memory_type,
    query: normalizeOptionalText(params?.query),
    limit: params?.limit ?? DEFAULT_PAGE_LIMIT,
    offset: params?.offset ?? DEFAULT_PAGE_OFFSET,
  };
}

export function useUserMemorySegments(
  userId: string,
  params?: Omit<ListMemorySegmentsRequest, "entity_id">,
) {
  const normalized = normalizeParams(params);

  return useQuery({
    queryKey: queryKeys.memory.userMemory(userId, normalized),
    queryFn: () => memoryApi.getUserMemorySegments(userId, normalized),
    enabled: userId.trim().length > 0,
  });
}

export function useSystemMemorySegments(params?: ListMemorySegmentsRequest) {
  const normalized = normalizeParams(params);

  return useQuery({
    queryKey: queryKeys.memory.systemMemory(normalized),
    queryFn: () => memoryApi.getSystemMemorySegments(normalized),
  });
}

function normalizeChatParams(params?: ListChatMemorySegmentsRequest): {
  source: "session" | "profile";
  profile_id?: string;
  chat_session_id?: string;
  memory_type?: MemorySegmentType;
  query?: string;
  include_archived: boolean;
  only_undistilled: boolean;
  limit: number;
  offset: number;
} {
  return {
    source: params?.source ?? "profile",
    profile_id: normalizeOptionalText(params?.profile_id),
    chat_session_id: normalizeOptionalText(params?.chat_session_id),
    memory_type: params?.memory_type,
    query: normalizeOptionalText(params?.query),
    include_archived: params?.include_archived === true,
    only_undistilled: params?.only_undistilled === true,
    limit: params?.limit ?? DEFAULT_PAGE_LIMIT,
    offset: params?.offset ?? DEFAULT_PAGE_OFFSET,
  };
}

export function useChatMemorySegments(params?: ListChatMemorySegmentsRequest) {
  const normalized = normalizeChatParams(params);

  return useQuery({
    queryKey: queryKeys.memory.chatMemory(normalized),
    queryFn: () => memoryApi.getChatMemorySegments(normalized),
  });
}

export function useChatMemoryObservability() {
  return useQuery({
    queryKey: queryKeys.memory.chatMemoryObservability(),
    queryFn: () =>
      memoryApi.getChatMemoryObservability({
        jobs_limit: 50,
        events_limit: 30,
      }),
  });
}