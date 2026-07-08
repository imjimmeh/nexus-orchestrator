import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { io } from "socket.io-client";
import { api } from "@/lib/api/client";
import { getAccessToken } from "@/lib/api/client.auth";
import { WorkItem } from "@/lib/api/work-items.types";

const WORK_ITEM_QUERY_KEY = "project-work-items";

interface WorkItemUpdatedPayload {
  projectId: string;
  workItem: WorkItem;
  triggeredRunIds: string[];
}

function upsertWorkItem(current: WorkItem[], updated: WorkItem): WorkItem[] {
  const existingIndex = current.findIndex((item) => item.id === updated.id);

  if (existingIndex === -1) {
    return [...current, updated];
  }

  return current.map((item) => (item.id === updated.id ? updated : item));
}

export function useWorkItemRealtimeSubscription(
  projectId: string | undefined,
): void {
  const queryClient = useQueryClient();

  const { data: realtimeConfig } = useQuery({
    queryKey: ["work-item-realtime-config", projectId],
    queryFn: () => {
      if (!projectId) {
        throw new Error("projectId is required");
      }
      return api.getWorkItemRealtimeConfig(projectId);
    },
    enabled: !!projectId,
  });

  useEffect(() => {
    if (!projectId || !realtimeConfig?.wsUrl || !realtimeConfig.namespace) {
      return;
    }

    const token = getAccessToken();

    const socket = io(`${realtimeConfig.wsUrl}${realtimeConfig.namespace}`, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10,
      auth: token ? { token } : undefined,
    });

    socket.on("connect", () => {
      socket.emit("join-project", { projectId });
    });

    socket.on("work-item-updated", (payload: WorkItemUpdatedPayload) => {
      if (payload.projectId !== projectId) {
        return;
      }

      queryClient.setQueryData<WorkItem[]>(
        [WORK_ITEM_QUERY_KEY, projectId],
        (current = []) => upsertWorkItem(current, payload.workItem),
      );
    });

    return () => {
      socket.disconnect();
    };
  }, [
    projectId,
    queryClient,
    realtimeConfig?.namespace,
    realtimeConfig?.wsUrl,
  ]);
}
