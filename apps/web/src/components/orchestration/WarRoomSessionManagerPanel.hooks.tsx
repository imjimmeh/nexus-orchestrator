import { useQueryClient } from "@tanstack/react-query";
import { getErrorMessage } from "@nexus/core";
import { queryKeys } from "@/lib/queryKeys";
import { ProjectWarRoomMessageKind, ProjectWarRoomParticipantRole, ProjectWarRoomResolutionType, ProjectWarRoomSessionSummary } from "@/lib/api/orchestration.types";
import { useWarRoomManagerState } from "./war-room-manager-state.hooks";
import {
  useWarRoomSessionsQuery,
  useSyncSelectedSession,
  useWarRoomSessionStateQuery,
} from "./war-room-sessions-query.hooks";
import { useWarRoomMutations } from "./war-room-mutations.hooks";

export type WarRoomManagerState = {
  selectedSessionId: string;
  setSelectedSessionId: (value: string) => void;
  openSessionId: string;
  setOpenSessionId: (value: string) => void;
  openInitialMessage: string;
  setOpenInitialMessage: (value: string) => void;
  inviteAgentProfile: string;
  setInviteAgentProfile: (value: string) => void;
  inviteRole: ProjectWarRoomParticipantRole;
  setInviteRole: (value: ProjectWarRoomParticipantRole) => void;
  messageKind: ProjectWarRoomMessageKind;
  setMessageKind: (value: ProjectWarRoomMessageKind) => void;
  messageBody: string;
  setMessageBody: (value: string) => void;
  closeResolutionType: ProjectWarRoomResolutionType;
  setCloseResolutionType: (value: ProjectWarRoomResolutionType) => void;
  closeNote: string;
  setCloseNote: (value: string) => void;
  notice: WarRoomActionNotice | null;
  setNotice: (notice: WarRoomActionNotice | null) => void;
};

export type UseWarRoomMutationsParams = {
  projectId: string;
  workflowRunId: string;
  selectedSessionId: string;
  openSessionId: string;
  openInitialMessage: string;
  inviteAgentProfile: string;
  inviteRole: ProjectWarRoomParticipantRole;
  messageKind: ProjectWarRoomMessageKind;
  messageBody: string;
  closeResolutionType: ProjectWarRoomResolutionType;
  closeNote: string;
  refreshWarRoomData: () => Promise<void>;
  setNotice: (notice: WarRoomActionNotice) => void;
  setOpenSessionId: (value: string) => void;
  setOpenInitialMessage: (value: string) => void;
  setSelectedSessionId: (value: string) => void;
  setInviteAgentProfile: (value: string) => void;
  setMessageBody: (value: string) => void;
  setCloseNote: (value: string) => void;
};

export type WarRoomMutationsResult = {
  actionPending: boolean;
  openSession: () => void;
  inviteParticipant: () => void;
  postMessage: () => void;
  closeSession: () => void;
};

export type WarRoomActionNotice = {
  type: "info" | "error";
  message: string;
};

export type WarRoomStateSummary = {
  status: "found" | "not_found" | "denied";
  participants?: unknown[];
  messages?: unknown[];
  denial_reason?: string;
};

export type WarRoomSessionManagerContentProps = {
  projectId: string;
  workflowRunId: string;
};

export type WarRoomSessionManagerModel = {
  notice: WarRoomActionNotice | null;
  openSessionId: string;
  openInitialMessage: string;
  setOpenSessionId: (value: string) => void;
  setOpenInitialMessage: (value: string) => void;
  openSession: () => void;
  actionPending: boolean;
  sessionsLoading: boolean;
  sessionsErrorMessage: string | null;
  sessions: ProjectWarRoomSessionSummary[];
  selectedSessionId: string;
  setSelectedSessionId: (sessionId: string) => void;
  selectedSession: ProjectWarRoomSessionSummary | undefined;
  sessionStateLoading: boolean;
  sessionStateErrorMessage: string | null;
  sessionState: WarRoomStateSummary | undefined;
  inviteAgentProfile: string;
  inviteRole: ProjectWarRoomParticipantRole;
  messageKind: ProjectWarRoomMessageKind;
  messageBody: string;
  closeResolutionType: ProjectWarRoomResolutionType;
  closeNote: string;
  setInviteAgentProfile: (value: string) => void;
  setInviteRole: (value: ProjectWarRoomParticipantRole) => void;
  setMessageKind: (value: ProjectWarRoomMessageKind) => void;
  setMessageBody: (value: string) => void;
  setCloseResolutionType: (value: ProjectWarRoomResolutionType) => void;
  setCloseNote: (value: string) => void;
  inviteParticipant: () => void;
  postMessage: () => void;
  closeSession: () => void;
};

interface BuildWarRoomSessionManagerModelParams {
  state: WarRoomManagerState;
  sessions: ProjectWarRoomSessionSummary[];
  selectedSession: ProjectWarRoomSessionSummary | undefined;
  sessionsLoading: boolean;
  sessionsError: unknown;
  sessionStateLoading: boolean;
  sessionStateError: unknown;
  sessionState: WarRoomStateSummary | undefined;
  actionPending: boolean;
  openSession: () => void;
  inviteParticipant: () => void;
  postMessage: () => void;
  closeSession: () => void;
}

function buildWarRoomSessionManagerModel({
  state,
  sessions,
  selectedSession,
  sessionsLoading,
  sessionsError,
  sessionStateLoading,
  sessionStateError,
  sessionState,
  actionPending,
  openSession,
  inviteParticipant,
  postMessage,
  closeSession,
}: Readonly<BuildWarRoomSessionManagerModelParams>): WarRoomSessionManagerModel {
  return {
    notice: state.notice,
    openSessionId: state.openSessionId,
    openInitialMessage: state.openInitialMessage,
    setOpenSessionId: state.setOpenSessionId,
    setOpenInitialMessage: state.setOpenInitialMessage,
    openSession,
    actionPending,
    sessionsLoading,
    sessionsErrorMessage: sessionsError ? getErrorMessage(sessionsError) : null,
    sessions,
    selectedSessionId: state.selectedSessionId,
    setSelectedSessionId: state.setSelectedSessionId,
    selectedSession,
    sessionStateLoading,
    sessionStateErrorMessage: sessionStateError
      ? getErrorMessage(sessionStateError)
      : null,
    sessionState,
    inviteAgentProfile: state.inviteAgentProfile,
    inviteRole: state.inviteRole,
    messageKind: state.messageKind,
    messageBody: state.messageBody,
    closeResolutionType: state.closeResolutionType,
    closeNote: state.closeNote,
    setInviteAgentProfile: state.setInviteAgentProfile,
    setInviteRole: state.setInviteRole,
    setMessageKind: state.setMessageKind,
    setMessageBody: state.setMessageBody,
    setCloseResolutionType: state.setCloseResolutionType,
    setCloseNote: state.setCloseNote,
    inviteParticipant,
    postMessage,
    closeSession,
  };
}

export function useWarRoomSessionManagerModel({
  projectId,
  workflowRunId,
}: Readonly<WarRoomSessionManagerContentProps>): WarRoomSessionManagerModel {
  const queryClient = useQueryClient();
  const state = useWarRoomManagerState();
  const { sessionsQuery, sessions } = useWarRoomSessionsQuery(
    projectId,
    workflowRunId,
  );

  useSyncSelectedSession(
    sessions,
    state.selectedSessionId,
    state.setSelectedSessionId,
  );

  const sessionStateQuery = useWarRoomSessionStateQuery(
    projectId,
    workflowRunId,
    state.selectedSessionId,
  );

  const refreshWarRoomData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: queryKeys.projectOrchestration.warRoomSessions(
          projectId,
          workflowRunId,
          false,
        ),
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.projectOrchestration.warRoomStatePrefix(
          projectId,
          workflowRunId,
        ),
      }),
    ]);
  };

  const {
    actionPending,
    openSession,
    inviteParticipant,
    postMessage,
    closeSession,
  } = useWarRoomMutations({
    projectId,
    workflowRunId,
    selectedSessionId: state.selectedSessionId,
    openSessionId: state.openSessionId,
    openInitialMessage: state.openInitialMessage,
    inviteAgentProfile: state.inviteAgentProfile,
    inviteRole: state.inviteRole,
    messageKind: state.messageKind,
    messageBody: state.messageBody,
    closeResolutionType: state.closeResolutionType,
    closeNote: state.closeNote,
    refreshWarRoomData,
    setNotice: (notice: WarRoomActionNotice) => {
      state.setNotice(notice);
    },
    setOpenSessionId: state.setOpenSessionId,
    setOpenInitialMessage: state.setOpenInitialMessage,
    setSelectedSessionId: state.setSelectedSessionId,
    setInviteAgentProfile: state.setInviteAgentProfile,
    setMessageBody: state.setMessageBody,
    setCloseNote: state.setCloseNote,
  });

  const selectedSession = sessions.find(
    (session) => session.session_id === state.selectedSessionId,
  );

  return buildWarRoomSessionManagerModel({
    state,
    sessions,
    selectedSession,
    sessionsLoading: sessionsQuery.isLoading,
    sessionsError: sessionsQuery.error,
    sessionStateLoading: sessionStateQuery.isLoading,
    sessionStateError: sessionStateQuery.error,
    sessionState: sessionStateQuery.data,
    actionPending,
    openSession,
    inviteParticipant,
    postMessage,
    closeSession,
  });
}
