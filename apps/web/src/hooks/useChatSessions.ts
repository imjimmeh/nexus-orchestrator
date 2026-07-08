import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { CreateChatSessionRequest, InviteChatSessionParticipantRequest } from "@/lib/api/chat-sessions.types";

const TRANSIENT_GATEWAY_STATUS_CODES = [502, 503, 504] as const;
const MAX_TRANSIENT_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 400;
const RETRY_MAX_DELAY_MS = 3000;

function isTransientGatewayError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }

  const status = error.response?.status;
  return (
    typeof status === "number" &&
    TRANSIENT_GATEWAY_STATUS_CODES.includes(
      status as (typeof TRANSIENT_GATEWAY_STATUS_CODES)[number],
    )
  );
}

function getRetryDelayMs(attemptIndex: number): number {
  const exponentialDelay = RETRY_BASE_DELAY_MS * 2 ** attemptIndex;
  return Math.min(exponentialDelay, RETRY_MAX_DELAY_MS);
}

export function useChatSessions(params?: {
  projectId?: string;
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
  refetchIntervalMs?: number;
}) {
  return useQuery({
    queryKey: queryKeys.chatSessions.list(params),
    queryFn: () => api.getChatSessions(params),
    refetchInterval: params?.refetchIntervalMs ?? false,
    retry: (failureCount, error) =>
      failureCount < MAX_TRANSIENT_RETRIES && isTransientGatewayError(error),
    retryDelay: (attemptIndex) => getRetryDelayMs(attemptIndex),
  });
}

export function useChatSession(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.chatSessions.detail(id ?? ""),
    queryFn: () => api.getChatSession(id ?? ""),
    enabled: !!id,
  });
}

export function useChatSessionParticipants(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.chatSessions.participants(id ?? ""),
    queryFn: () => api.getChatSessionParticipants(id ?? ""),
    enabled: !!id,
  });
}

export function useChatSessionState(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.chatSessions.state(id ?? ""),
    queryFn: () => api.getChatSessionState(id ?? ""),
    enabled: !!id,
    refetchInterval: id ? 5000 : false,
  });
}

export function useCreateChatSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateChatSessionRequest) =>
      api.createChatSession(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.chatSessions.list(),
      });
    },
  });
}

export function useCancelChatSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancelChatSession(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.chatSessions.list(),
      });
    },
  });
}

export function useChatSessionChildren(parentId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.chatSessions.children(parentId ?? ""),
    queryFn: () => api.getChatSessionChildren(parentId ?? ""),
    enabled: !!parentId,
  });
}

export function useRetryChatSessionNow(id: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (!id) {
        throw new Error("Chat session id is required to retry");
      }

      return api.retryChatSessionNow(id);
    },
    onSuccess: () => {
      if (!id) {
        return;
      }

      void queryClient.invalidateQueries({
        queryKey: queryKeys.chatSessions.detail(id),
      });
      void queryClient.invalidateQueries({
        queryKey: ["chat-sessions"],
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.chatSessions.state(id),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.chatSessions.events(id),
      });
    },
  });
}

export function useInviteChatSessionParticipant(id: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: InviteChatSessionParticipantRequest) => {
      if (!id) {
        throw new Error("Chat session id is required to invite participants");
      }

      return api.inviteChatSessionParticipant(id, request);
    },
    onSuccess: () => {
      if (!id) {
        return;
      }

      void queryClient.invalidateQueries({
        queryKey: queryKeys.chatSessions.participants(id),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.chatSessions.state(id),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.chatSessions.events(id),
      });
    },
  });
}
