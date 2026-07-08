import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { patchInboxReadState } from "@/lib/notifications/inboxCache";

const INBOX_QUERY_KEY = ["notifications-inbox"] as const;
const UNREAD_COUNT_QUERY_KEY = ["notifications-unread-count"] as const;

export function useNotifications() {
  const queryClient = useQueryClient();

  const { data: inboxEnvelope, isLoading: isInboxLoading } = useQuery({
    queryKey: INBOX_QUERY_KEY,
    queryFn: () => api.getNotificationsInbox({ limit: 20, offset: 0 }),
  });

  const { data: unreadEnvelope, isLoading: isUnreadLoading } = useQuery({
    queryKey: UNREAD_COUNT_QUERY_KEY,
    queryFn: () => api.getUnreadNotificationCount(),
    refetchInterval: 30_000,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.markNotificationRead(id),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_QUERY_KEY });
      if (!result.data?.id) {
        await queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY });
        return;
      }

      const updatedId = result.data.id;
      const updatedReadAt = result.data.readAt ?? new Date().toISOString();

      queryClient.setQueryData(INBOX_QUERY_KEY, (current: unknown) =>
        patchInboxReadState(current, updatedId, updatedReadAt),
      );
    },
  });

  const markAllRead = useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_QUERY_KEY });
    },
  });

  const notifications = useMemo(
    () => inboxEnvelope?.data ?? [],
    [inboxEnvelope?.data],
  );

  return {
    notifications,
    unreadCount: unreadEnvelope?.data?.count ?? 0,
    total: inboxEnvelope?.meta?.total ?? 0,
    markRead,
    markAllRead,
    isLoading: isInboxLoading || isUnreadLoading,
  };
}
