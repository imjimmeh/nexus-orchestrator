import { useMutation } from "@tanstack/react-query";
import { getErrorMessage } from "@nexus/core";
import { api } from "@/lib/api/client";
import type {
  UseWarRoomMutationsParams,
  WarRoomMutationsResult,
} from "./WarRoomSessionManagerPanel.hooks";

function requireSessionId(sessionId: string): string {
  if (sessionId.trim().length === 0)
    throw new Error("Select a War Room session first.");
  return sessionId;
}

function requireValue(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${fieldName} is required.`);
  }

  return trimmed;
}

function useOpenSessionMutation(params: Readonly<UseWarRoomMutationsParams>) {
  return useMutation({
    mutationFn: () =>
      api.openProjectWarRoomSession(params.projectId, {
        workflow_run_id: params.workflowRunId,
        session_id: params.openSessionId.trim() || undefined,
        initial_message: params.openInitialMessage.trim() || undefined,
      }),
    onSuccess: async (result) => {
      params.setNotice({
        type: "info",
        message: `Session ${result.session_id} ${result.status}.`,
      });
      params.setOpenSessionId("");
      params.setOpenInitialMessage("");
      params.setSelectedSessionId(result.session_id);
      await params.refreshWarRoomData();
    },
    onError: (error: unknown) => {
      params.setNotice({ type: "error", message: getErrorMessage(error) });
    },
  });
}

function useInviteMutation(params: Readonly<UseWarRoomMutationsParams>) {
  return useMutation({
    mutationFn: () =>
      api.inviteProjectWarRoomParticipant(
        params.projectId,
        requireSessionId(params.selectedSessionId),
        {
          workflow_run_id: params.workflowRunId,
          agent_profile: requireValue(
            params.inviteAgentProfile,
            "Agent profile",
          ),
          role: params.inviteRole,
        },
      ),
    onSuccess: async (result) => {
      params.setNotice({
        type: "info",
        message: `Participant invite ${result.status}.`,
      });
      params.setInviteAgentProfile("");
      await params.refreshWarRoomData();
    },
    onError: (error: unknown) => {
      params.setNotice({ type: "error", message: getErrorMessage(error) });
    },
  });
}

function useMessageMutation(params: Readonly<UseWarRoomMutationsParams>) {
  return useMutation({
    mutationFn: () =>
      api.postProjectWarRoomMessage(
        params.projectId,
        requireSessionId(params.selectedSessionId),
        {
          workflow_run_id: params.workflowRunId,
          message_kind: params.messageKind,
          body: requireValue(params.messageBody, "Message body"),
        },
      ),
    onSuccess: async (result) => {
      params.setNotice({ type: "info", message: `Message ${result.status}.` });
      params.setMessageBody("");
      await params.refreshWarRoomData();
    },
    onError: (error: unknown) => {
      params.setNotice({ type: "error", message: getErrorMessage(error) });
    },
  });
}

function useCloseMutation(params: Readonly<UseWarRoomMutationsParams>) {
  return useMutation({
    mutationFn: () =>
      api.closeProjectWarRoomSession(
        params.projectId,
        requireSessionId(params.selectedSessionId),
        {
          workflow_run_id: params.workflowRunId,
          resolution_type: params.closeResolutionType,
          resolution_note: params.closeNote.trim() || undefined,
        },
      ),
    onSuccess: async (result) => {
      params.setNotice({
        type: "info",
        message: `Session close ${result.status}.`,
      });
      params.setCloseNote("");
      await params.refreshWarRoomData();
    },
    onError: (error: unknown) => {
      params.setNotice({ type: "error", message: getErrorMessage(error) });
    },
  });
}

export function useWarRoomMutations(
  params: Readonly<UseWarRoomMutationsParams>,
): WarRoomMutationsResult {
  const openMutation = useOpenSessionMutation(params);
  const inviteMutation = useInviteMutation(params);
  const messageMutation = useMessageMutation(params);
  const closeMutation = useCloseMutation(params);
  return {
    actionPending:
      openMutation.isPending ||
      inviteMutation.isPending ||
      messageMutation.isPending ||
      closeMutation.isPending,
    openSession: () => {
      openMutation.mutate();
    },
    inviteParticipant: () => {
      inviteMutation.mutate();
    },
    postMessage: () => {
      messageMutation.mutate();
    },
    closeSession: () => {
      closeMutation.mutate();
    },
  };
}
