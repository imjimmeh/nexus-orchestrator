import type { AgentChatMessage } from "@/components/chat/AgentChatPanel";
import { ChatSessionParticipant, ChatSessionParticipantRole } from "@/lib/api/chat-sessions.types";
import { QuestionAnswer, UserQuestion } from "@/lib/api/settings.types";
import { WorkflowRunTodoList, WorkflowRunTodoStatus } from "@/lib/api/workflow-todos.types";
import { WorkflowTelemetryEvent, WorkflowWorkspaceTreeNode } from "@/lib/api/workflows.types";
import type { TodoItem } from "@nexus/core";
import { resolveContentRunId } from "./active-session.workspace.helpers";
import type { ActiveSessionControlNotice } from "./active-session.workspace.types";

type ExecutionTabKey = "terminal" | "diff" | "tree";

type InviteCandidate = {
  name: string;
  tierPreference: string | null;
};

type ChatSessionCounts = {
  participantCount: number;
  activeParticipantCount: number;
  invitedParticipantCount: number;
  sessionStatus: string;
};

function resolveParticipantCounts(params: {
  chatSessionState: ChatSessionCounts | null | undefined;
  participantRoster: ChatSessionParticipant[];
}) {
  const participantCount =
    params.chatSessionState?.participantCount ??
    params.participantRoster.length;
  const activeParticipantCount =
    params.chatSessionState?.activeParticipantCount ??
    params.participantRoster.filter(
      (participant) => participant.participationStatus === "active",
    ).length;
  const invitedParticipantCount =
    params.chatSessionState?.invitedParticipantCount ??
    params.participantRoster.filter(
      (participant) => participant.participationStatus === "invited",
    ).length;

  return {
    participantCount,
    activeParticipantCount,
    invitedParticipantCount,
  };
}

function buildCoreContentProps(params: {
  isChatSession: boolean;
  chatSessionIdParam: string | undefined;
  runId: string | undefined;
  sessionTitle: string;
  backPath: string;
  connectionState: string;
  telemetryErrorMessage: string | null;
  controlNotice: ActiveSessionControlNotice | null;
  executionTab: ExecutionTabKey;
  message: string;
  conflictGuidance: string;
  workspaceDiff: string;
  workspaceTree: WorkflowWorkspaceTreeNode[];
  workspaceDiffLoading: boolean;
  workspaceDiffError: string | null;
  workspaceTreeLoading: boolean;
  workspaceTreeError: string | null;
  runTodoList: WorkflowRunTodoList | null;
  runTodoListLoading: boolean;
  runTodoListError: string | null;
  runTodoListUpdatePending: boolean;
  agentTodos: TodoItem[];
  terminalChunks: string[];
  chatMessages: AgentChatMessage[];
  phaseMarkers: string[];
  telemetryEvents: WorkflowTelemetryEvent[];
  isBlocked: boolean;
  mergeConflictReason: string | null;
  pendingQuestions: UserQuestion[] | null;
}) {
  return {
    isChatSession: params.isChatSession,
    runId: resolveContentRunId({
      isChatSession: params.isChatSession,
      chatSessionIdParam: params.chatSessionIdParam,
      runId: params.runId,
    }),
    sessionTitle: params.sessionTitle,
    backPath: params.backPath,
    connectionState: params.connectionState,
    telemetryError: params.telemetryErrorMessage,
    controlNotice: params.controlNotice,
    executionTab: params.executionTab,
    terminalChunks: params.terminalChunks,
    chatMessages: params.chatMessages,
    message: params.message,
    conflictGuidance: params.conflictGuidance,
    workspaceDiff: params.workspaceDiff,
    workspaceTree: params.workspaceTree,
    workspaceDiffLoading: params.workspaceDiffLoading,
    workspaceDiffError: params.workspaceDiffError,
    workspaceTreeLoading: params.workspaceTreeLoading,
    workspaceTreeError: params.workspaceTreeError,
    runTodoList: params.runTodoList,
    runTodoListLoading: params.runTodoListLoading,
    runTodoListError: params.runTodoListError,
    runTodoListUpdatePending: params.runTodoListUpdatePending,
    agentTodos: params.agentTodos,
    phaseMarkers: params.phaseMarkers,
    telemetryEvents: params.telemetryEvents,
    isBlocked: params.isBlocked,
    mergeConflictReason: params.mergeConflictReason,
    pendingQuestions: params.pendingQuestions,
  };
}

function buildCollaborationContentProps(params: {
  chatSessionState: ChatSessionCounts | null | undefined;
  participantRoster: ChatSessionParticipant[];
  chatParticipantsLoading: boolean;
  chatParticipantsError: string | null;
  chatSessionStateLoading: boolean;
  chatSessionStateError: string | null;
  inviteCandidates: InviteCandidate[];
  inviteAgentProfile: string;
  inviteRole: ChatSessionParticipantRole;
  invitePending: boolean;
  inviteError: string | null;
  inviteDenialReason: string | null;
}) {
  const participantCounts = resolveParticipantCounts({
    chatSessionState: params.chatSessionState,
    participantRoster: params.participantRoster,
  });

  return {
    chatSessionState: params.chatSessionState?.sessionStatus ?? null,
    chatParticipants: params.participantRoster,
    chatParticipantCount: participantCounts.participantCount,
    chatActiveParticipantCount: participantCounts.activeParticipantCount,
    chatInvitedParticipantCount: participantCounts.invitedParticipantCount,
    chatParticipantsLoading: params.chatParticipantsLoading,
    chatParticipantsError: params.chatParticipantsError,
    chatSessionStateLoading: params.chatSessionStateLoading,
    chatSessionStateError: params.chatSessionStateError,
    inviteCandidates: params.inviteCandidates,
    inviteAgentProfile: params.inviteAgentProfile,
    inviteRole: params.inviteRole,
    invitePending: params.invitePending,
    inviteError: params.inviteError,
    inviteDenialReason: params.inviteDenialReason,
  };
}

function buildActionStatusProps(params: {
  isRunPaused: boolean;
  isRunTerminal: boolean;
  pausePending: boolean;
  resumePending: boolean;
  abortPending: boolean;
  injectPending: boolean;
  submitAnswersPending: boolean;
  markInProgressPending: boolean;
  instructResolvePending: boolean;
}) {
  return {
    isRunPaused: params.isRunPaused,
    isRunTerminal: params.isRunTerminal,
    pausePending: params.pausePending,
    resumePending: params.resumePending,
    abortPending: params.abortPending,
    injectPending: params.injectPending,
    submitAnswersPending: params.submitAnswersPending,
    markInProgressPending: params.markInProgressPending,
    instructResolvePending: params.instructResolvePending,
  };
}

function buildActionHandlerProps(params: {
  setMessage: (value: string) => void;
  setConflictGuidance: (value: string) => void;
  setExecutionTab: (value: ExecutionTabKey) => void;
  onInviteAgentProfileChange: (value: string) => void;
  onInviteRoleChange: (value: ChatSessionParticipantRole) => void;
  onInviteParticipant: () => void;
  onPause: () => void;
  onResume: () => void;
  onAbort: () => void;
  onInject: (attachmentIds?: string[]) => void;
  onSubmitAnswers: (answers: QuestionAnswer[]) => void;
  onInstructResolve: () => void;
  onMarkInProgress: () => void;
  onUpdateTodoStatus: (todoId: string, status: WorkflowRunTodoStatus) => void;
}) {
  return {
    onMessageChange: params.setMessage,
    onConflictGuidanceChange: params.setConflictGuidance,
    onExecutionTabChange: params.setExecutionTab,
    onInviteAgentProfileChange: params.onInviteAgentProfileChange,
    onInviteRoleChange: params.onInviteRoleChange,
    onInviteParticipant: params.onInviteParticipant,
    onPause: params.onPause,
    onResume: params.onResume,
    onAbort: params.onAbort,
    onInject: params.onInject,
    onSubmitAnswers: params.onSubmitAnswers,
    onInstructResolve: params.onInstructResolve,
    onMarkInProgress: params.onMarkInProgress,
    onUpdateTodoStatus: params.onUpdateTodoStatus,
  };
}

export function buildWorkspaceContentProps(params: {
  isChatSession: boolean;
  chatSessionIdParam: string | undefined;
  runId: string | undefined;
  sessionTitle: string;
  backPath: string;
  connectionState: string;
  telemetryErrorMessage: string | null;
  controlNotice: ActiveSessionControlNotice | null;
  executionTab: ExecutionTabKey;
  message: string;
  conflictGuidance: string;
  workspaceDiff: string;
  workspaceTree: WorkflowWorkspaceTreeNode[];
  workspaceDiffLoading: boolean;
  workspaceDiffError: string | null;
  workspaceTreeLoading: boolean;
  workspaceTreeError: string | null;
  runTodoList: WorkflowRunTodoList | null;
  runTodoListLoading: boolean;
  runTodoListError: string | null;
  runTodoListUpdatePending: boolean;
  agentTodos: TodoItem[];
  terminalChunks: string[];
  chatMessages: AgentChatMessage[];
  phaseMarkers: string[];
  telemetryEvents: WorkflowTelemetryEvent[];
  isBlocked: boolean;
  mergeConflictReason: string | null;
  pendingQuestions: UserQuestion[] | null;
  chatSessionState: ChatSessionCounts | null | undefined;
  participantRoster: ChatSessionParticipant[];
  chatParticipantsLoading: boolean;
  chatParticipantsError: string | null;
  chatSessionStateLoading: boolean;
  chatSessionStateError: string | null;
  inviteCandidates: InviteCandidate[];
  inviteAgentProfile: string;
  inviteRole: ChatSessionParticipantRole;
  invitePending: boolean;
  inviteError: string | null;
  inviteDenialReason: string | null;
  isRunPaused: boolean;
  isRunTerminal: boolean;
  pausePending: boolean;
  resumePending: boolean;
  abortPending: boolean;
  injectPending: boolean;
  submitAnswersPending: boolean;
  markInProgressPending: boolean;
  instructResolvePending: boolean;
  setMessage: (value: string) => void;
  setConflictGuidance: (value: string) => void;
  setExecutionTab: (value: ExecutionTabKey) => void;
  onInviteAgentProfileChange: (value: string) => void;
  onInviteRoleChange: (value: ChatSessionParticipantRole) => void;
  onInviteParticipant: () => void;
  onPause: () => void;
  onResume: () => void;
  onAbort: () => void;
  onInject: (attachmentIds?: string[]) => void;
  onSubmitAnswers: (answers: QuestionAnswer[]) => void;
  onInstructResolve: () => void;
  onMarkInProgress: () => void;
  onUpdateTodoStatus: (todoId: string, status: WorkflowRunTodoStatus) => void;
}) {
  return {
    ...buildCoreContentProps(params),
    ...buildCollaborationContentProps(params),
    ...buildActionStatusProps(params),
    ...buildActionHandlerProps(params),
  };
}
