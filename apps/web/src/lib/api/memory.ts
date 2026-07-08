import { api } from "./client";
import type {
  ChatMemoryExplorerSegmentListResponse,
  ChatMemoryObservabilityResponse,
  ListChatMemorySegmentsRequest,
  ListMemorySegmentsRequest,
  MemoryExplorerSegmentListResponse,
  MemoryMetricsResponse,
} from "./memory.types";

function toMemoryParams(
  params?: ListMemorySegmentsRequest,
): Record<string, unknown> | undefined {
  if (!params) {
    return undefined;
  }

  return {
    entity_id: params.entity_id,
    memory_type: params.memory_type,
    query: params.query,
    limit: params.limit,
    offset: params.offset,
  };
}

function toChatParams(
  params?: ListChatMemorySegmentsRequest,
): Record<string, unknown> | undefined {
  if (!params) {
    return undefined;
  }

  return {
    source: params.source,
    profile_id: params.profile_id,
    chat_session_id: params.chat_session_id,
    memory_type: params.memory_type,
    query: params.query,
    include_archived: params.include_archived,
    only_undistilled: params.only_undistilled,
    limit: params.limit,
    offset: params.offset,
  };
}

export async function getUserMemorySegments(
  userId: string,
  params?: Omit<ListMemorySegmentsRequest, "entity_id">,
): Promise<MemoryExplorerSegmentListResponse> {
  return api.get<MemoryExplorerSegmentListResponse>(
    `/users/${encodeURIComponent(userId)}/memory/segments`,
    {
      params: toMemoryParams(params),
    },
  );
}

export async function getSystemMemorySegments(
  params?: ListMemorySegmentsRequest,
): Promise<MemoryExplorerSegmentListResponse> {
  return api.get<MemoryExplorerSegmentListResponse>("/memory/system/segments", {
    params: toMemoryParams(params),
  });
}

export async function getChatMemorySegments(
  params?: ListChatMemorySegmentsRequest,
): Promise<ChatMemoryExplorerSegmentListResponse> {
  return api.get<ChatMemoryExplorerSegmentListResponse>(
    "/memory/chat/segments",
    {
      params: toChatParams(params),
    },
  );
}

export async function getChatMemoryObservability(params?: {
  jobs_limit?: number;
  events_limit?: number;
}): Promise<ChatMemoryObservabilityResponse> {
  return api.get<ChatMemoryObservabilityResponse>(
    "/memory/chat/observability",
    {
      params,
    },
  );
}

export async function getMemoryMetrics(): Promise<MemoryMetricsResponse> {
  return api.get<MemoryMetricsResponse>("/memory/metrics");
}

export const memoryApi = {
  getUserMemorySegments,
  getSystemMemorySegments,
  getChatMemorySegments,
  getChatMemoryObservability,
  getMemoryMetrics,
};
