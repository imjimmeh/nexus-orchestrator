import React, { createContext, useContext, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { io, type Socket } from "socket.io-client";
import { api } from "@/lib/api/client";
import { patchInboxReadState } from "@/lib/notifications/inboxCache";

const WS_CONFIG_QUERY_KEY = ["notifications-websocket-config"] as const;
const INBOX_QUERY_KEY = ["notifications-inbox"] as const;
const UNREAD_COUNT_QUERY_KEY = ["notifications-unread-count"] as const;

interface RunLifecycleEvent {
  workflowRunId: string;
  workflowId: string;
  status: string;
}

function getAuthToken(): string | null {
  if (globalThis.window === undefined) {
    return null;
  }

  return globalThis.localStorage.getItem("nexus_token");
}

interface GlobalRealtimeContextValue {
  isConnected: boolean;
}

const GlobalRealtimeContext = createContext<GlobalRealtimeContextValue>({
  isConnected: false,
});

export function GlobalRealtimeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const [isConnected, setIsConnected] = useState(false);

  const { data: wsConfig } = useQuery({
    queryKey: WS_CONFIG_QUERY_KEY,
    queryFn: () => api.getNotificationsWebsocketConfig(),
    staleTime: Infinity,
  });

  const token = getAuthToken();

  // /app-events socket
  useEffect(() => {
    if (!wsConfig?.wsUrl || !token) return;

    const socket: Socket = io(`${wsConfig.wsUrl}/app-events`, {
      auth: { token },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10,
      timeout: 10_000,
    });

    socket.on("connect", () => setIsConnected(true));
    socket.on("disconnect", () => setIsConnected(false));
    socket.on("run:lifecycle", (_event: RunLifecycleEvent) => {
      queryClient.invalidateQueries({ queryKey: ["workflow-runs"] });
      queryClient.invalidateQueries({ queryKey: ["chat-sessions"] });
    });

    return () => {
      socket.disconnect();
    };
  }, [wsConfig?.wsUrl, token, queryClient]);

  // /notifications socket — hoisted from useNotificationSocket in useNotifications.ts
  useEffect(() => {
    if (!wsConfig?.wsUrl || !wsConfig?.namespace || !token) return;

    const socket: Socket = io(`${wsConfig.wsUrl}${wsConfig.namespace}`, {
      auth: { token },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10,
      timeout: 10_000,
    });

    socket.on("notification:new", async () => {
      await queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_QUERY_KEY });
    });

    socket.on(
      "notification:read",
      ({ notificationId }: { notificationId: string }) => {
        queryClient.setQueryData(INBOX_QUERY_KEY, (current: unknown) =>
          patchInboxReadState(
            current,
            notificationId,
            new Date().toISOString(),
          ),
        );
      },
    );

    return () => {
      socket.disconnect();
    };
  }, [wsConfig?.wsUrl, wsConfig?.namespace, token, queryClient]);

  return (
    <GlobalRealtimeContext.Provider value={{ isConnected }}>
      {children}
    </GlobalRealtimeContext.Provider>
  );
}

export function useGlobalRealtime(): GlobalRealtimeContextValue {
  return useContext(GlobalRealtimeContext);
}
