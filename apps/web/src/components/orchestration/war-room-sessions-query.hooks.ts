import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ProjectWarRoomSessionSummary } from "@/lib/api/orchestration.types";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";

export function useWarRoomSessionsQuery(
  projectId: string,
  workflowRunId: string,
) {
  const sessionsQuery = useQuery({
    queryKey: queryKeys.projectOrchestration.warRoomSessions(
      projectId,
      workflowRunId,
      false,
    ),
    queryFn: () =>
      api.listProjectWarRoomSessions(projectId, {
        workflow_run_id: workflowRunId,
        active_only: false,
      }),
    refetchInterval: 10_000,
  });
  return {
    sessionsQuery,
    sessions: sessionsQuery.data?.sessions ?? [],
  };
}

export function useSyncSelectedSession(
  sessions: ProjectWarRoomSessionSummary[],
  selectedSessionId: string,
  setSelectedSessionId: (value: string) => void,
) {
  useEffect(() => {
    if (sessions.length === 0) {
      setSelectedSessionId("");
      return;
    }

    if (sessions.some((session) => session.session_id === selectedSessionId)) {
      return;
    }

    setSelectedSessionId(sessions[0]?.session_id ?? "");
  }, [selectedSessionId, sessions, setSelectedSessionId]);
}

export function useWarRoomSessionStateQuery(
  projectId: string,
  workflowRunId: string,
  selectedSessionId: string,
) {
  return useQuery({
    queryKey: queryKeys.projectOrchestration.warRoomState(
      projectId,
      workflowRunId,
      selectedSessionId || "none",
    ),
    queryFn: () =>
      api.getProjectWarRoomSessionState(projectId, selectedSessionId, {
        workflow_run_id: workflowRunId,
      }),
    enabled: selectedSessionId.length > 0,
    refetchInterval: 10_000,
  });
}
