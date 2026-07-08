import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { useChatSession } from "@/hooks/useChatSessions";
import { useChatSessionTelemetry } from "@/hooks/useChatSessionTelemetry";
import { useProjectWorkItems } from "@/hooks/useProjectWorkItems";
import {
  useUpdateWorkflowRunTodoList,
  useWorkflowRun,
  useWorkflowRunTodoList,
} from "@/hooks/useWorkflows";
import { useWorkflowRunTelemetry } from "@/hooks/useWorkflowRunTelemetry";
import { WorkItem } from "@/lib/api/work-items.types";
import { WorkflowRunTodoStatus } from "@/lib/api/workflow-todos.types";
import {
  useActiveSessionWorkspaceActions,
  useWorkspaceArtifacts,
} from "./ActiveSessionWorkspace.actions";
import type { ActiveSessionControlNotice } from "./active-session.workspace.types";
import {
  resolveArtifactsRunId,
  resolveWorkspaceErrorMessages,
  resolveWorkspaceGuard,
  resolveWorkspaceMetaByMode,
  useWorkspaceDerivedState,
} from "./active-session.workspace.helpers";
import { buildWorkspaceContentProps } from "./active-session.workspace.viewmodel-builders";
import { useChatCollaborationState } from "./active-session.workspace.collaboration";

type WorkspaceRouteParams = {
  projectId: string;
  workItemId?: string;
  runId?: string;
  sessionId?: string;
};

type ExecutionTabKey = "terminal" | "diff" | "tree";

function useWorkspaceCoreState() {
  const {
    projectId,
    workItemId,
    runId: runIdParam,
    sessionId: chatSessionIdParam,
  } = useParams<WorkspaceRouteParams>();
  const isChatSession = !!chatSessionIdParam;

  const [message, setMessage] = useState("");
  const [conflictGuidance, setConflictGuidance] = useState("");
  const [executionTab, setExecutionTab] = useState<ExecutionTabKey>("terminal");
  const [controlNotice, setControlNotice] =
    useState<ActiveSessionControlNotice | null>(null);

  useEffect(() => {
    setControlNotice(null);
  }, [isChatSession, chatSessionIdParam, runIdParam]);

  const queryClient = useQueryClient();
  const { data: workItems = [] } = useProjectWorkItems(projectId ?? "");

  return {
    projectId,
    workItemId,
    runIdParam,
    chatSessionIdParam,
    isChatSession,
    message,
    conflictGuidance,
    executionTab,
    controlNotice,
    setMessage,
    setConflictGuidance,
    setExecutionTab,
    setControlNotice,
    queryClient,
    workItems,
  };
}

function useWorkspaceSessionData(params: {
  isChatSession: boolean;
  chatSessionIdParam: string | undefined;
  runIdParam: string | undefined;
  workItemId: string | undefined;
  workItems: WorkItem[];
}) {
  const selectedWorkItem = useMemo(
    () =>
      params.workItems.find((item) => item.id === params.workItemId) || null,
    [params.workItems, params.workItemId],
  );

  const runId = params.isChatSession
    ? undefined
    : (params.runIdParam ?? selectedWorkItem?.currentExecutionId ?? undefined);
  const { data: workflowRun } = useWorkflowRun(runId ?? "");
  const { data: chatSessionDetail } = useChatSession(
    params.isChatSession ? params.chatSessionIdParam : undefined,
  );

  const workItem = useMemo(() => {
    if (selectedWorkItem) {
      return selectedWorkItem;
    }

    if (!runId) {
      return null;
    }

    return (
      params.workItems.find((item) => item.currentExecutionId === runId) || null
    );
  }, [runId, selectedWorkItem, params.workItems]);

  const workflowTelemetry = useWorkflowRunTelemetry(
    params.isChatSession ? undefined : runId,
  );
  const chatTelemetry = useChatSessionTelemetry(
    params.isChatSession ? params.chatSessionIdParam : undefined,
  );
  const {
    events,
    connectionState,
    error: telemetryError,
  } = params.isChatSession ? chatTelemetry : workflowTelemetry;

  return {
    selectedWorkItem,
    runId,
    workflowRun,
    chatSessionDetail,
    workItem,
    targetWorkItemId: workItem?.id ?? null,
    events,
    connectionState,
    telemetryError,
  };
}

function useRunTodoState(todoListRunId: string | undefined) {
  const {
    data: runTodoList,
    error: runTodoListError,
    isLoading: runTodoListLoading,
  } = useWorkflowRunTodoList(todoListRunId ?? "");
  const updateRunTodoListMutation = useUpdateWorkflowRunTodoList(
    todoListRunId ?? "",
  );

  return {
    runTodoList,
    runTodoListError,
    runTodoListLoading,
    updateRunTodoListMutation,
  };
}

function createTodoStatusUpdater(params: {
  runTodoList: ReturnType<typeof useRunTodoState>["runTodoList"];
  hasTodoRunId: boolean;
  updateTodoList: ReturnType<
    typeof useRunTodoState
  >["updateRunTodoListMutation"]["mutate"];
}) {
  return (todoId: string, status: WorkflowRunTodoStatus) => {
    if (!params.runTodoList || !params.hasTodoRunId) {
      return;
    }

    params.updateTodoList({
      todo_list: params.runTodoList.todo_list.map((item) => ({
        id: item.id,
        title: item.title,
        status: item.id === todoId ? status : item.status,
        ...(item.source_context_item_id
          ? { source_context_item_id: item.source_context_item_id }
          : {}),
      })),
    });
  };
}

function useWorkspaceViewModelState(
  coreState: ReturnType<typeof useWorkspaceCoreState>,
) {
  const sessionState = useWorkspaceSessionData({
    isChatSession: coreState.isChatSession,
    chatSessionIdParam: coreState.chatSessionIdParam,
    runIdParam: coreState.runIdParam,
    workItemId: coreState.workItemId,
    workItems: coreState.workItems,
  });
  const collaboration = useChatCollaborationState({
    isChatSession: coreState.isChatSession,
    chatSessionIdParam: coreState.chatSessionIdParam,
  });

  const artifactsRunId = resolveArtifactsRunId(
    coreState.isChatSession,
    sessionState.runId,
  );
  const workspaceArtifacts = useWorkspaceArtifacts(artifactsRunId);
  const todoState = useRunTodoState(artifactsRunId);

  const actionState = useActiveSessionWorkspaceActions({
    isChatSession: coreState.isChatSession,
    chatSessionId: coreState.chatSessionIdParam,
    projectId: coreState.projectId,
    targetWorkItemId: sessionState.targetWorkItemId,
    runId: sessionState.runId,
    workItem: sessionState.workItem,
    message: coreState.message,
    conflictGuidance: coreState.conflictGuidance,
    setControlNotice: coreState.setControlNotice,
    setMessage: coreState.setMessage,
    setConflictGuidance: coreState.setConflictGuidance,
    queryClient: coreState.queryClient,
  });

  const errorMessages = resolveWorkspaceErrorMessages({
    telemetryError: sessionState.telemetryError,
    workspaceDiffError: workspaceArtifacts.workspaceDiffError,
    workspaceTreeError: workspaceArtifacts.workspaceTreeError,
    runTodoListError: todoState.runTodoListError,
  });

  const derivedState = useWorkspaceDerivedState({
    isChatSession: coreState.isChatSession,
    chatSessionInitialMessage: sessionState.chatSessionDetail?.initialMessage,
    workflowRunStateVariables: sessionState.workflowRun?.state_variables,
    events: sessionState.events,
    chatSessionStatus:
      collaboration.chatSessionState?.sessionStatus ??
      sessionState.chatSessionDetail?.status,
    workflowRunStatus: sessionState.workflowRun?.status,
    workItem: sessionState.workItem,
  });

  return {
    sessionState,
    collaboration,
    artifactsRunId,
    workspaceArtifacts,
    todoState,
    actionState,
    errorMessages,
    derivedState,
  };
}

function buildActiveWorkspaceContentProps(params: {
  coreState: ReturnType<typeof useWorkspaceCoreState>;
  state: ReturnType<typeof useWorkspaceViewModelState>;
  sessionTitle: string;
  backPath: string;
  isBlocked: boolean;
  onUpdateTodoStatus: (todoId: string, status: WorkflowRunTodoStatus) => void;
}) {
  const {
    coreState,
    state,
    sessionTitle,
    backPath,
    isBlocked,
    onUpdateTodoStatus,
  } = params;

  return buildWorkspaceContentProps({
    isChatSession: coreState.isChatSession,
    chatSessionIdParam: coreState.chatSessionIdParam,
    runId: state.sessionState.runId,
    sessionTitle,
    backPath,
    connectionState: state.sessionState.connectionState,
    telemetryErrorMessage: state.errorMessages.telemetryErrorMessage,
    executionTab: coreState.executionTab,
    message: coreState.message,
    conflictGuidance: coreState.conflictGuidance,
    controlNotice: coreState.controlNotice,
    workspaceDiff: state.workspaceArtifacts.workspaceDiff?.diff || "",
    workspaceTree: state.workspaceArtifacts.workspaceTree || [],
    workspaceDiffLoading: state.workspaceArtifacts.workspaceDiffLoading,
    workspaceDiffError: state.errorMessages.workspaceDiffErrorMessage,
    workspaceTreeLoading: state.workspaceArtifacts.workspaceTreeLoading,
    workspaceTreeError: state.errorMessages.workspaceTreeErrorMessage,
    runTodoList: state.todoState.runTodoList ?? null,
    runTodoListLoading: state.todoState.runTodoListLoading,
    runTodoListError: state.errorMessages.runTodoListErrorMessage,
    runTodoListUpdatePending:
      state.todoState.updateRunTodoListMutation.isPending,
    agentTodos: state.derivedState.agentTodos,
    terminalChunks: state.derivedState.terminalChunks,
    chatMessages: state.derivedState.chatMessages,
    phaseMarkers: state.derivedState.phaseMarkers,
    telemetryEvents: state.sessionState.events,
    isBlocked,
    mergeConflictReason: state.derivedState.mergeConflictReason,
    pendingQuestions: state.derivedState.pendingQuestions,
    chatSessionState: state.collaboration.chatSessionState,
    participantRoster: state.collaboration.participantRoster,
    chatParticipantsLoading: state.collaboration.chatParticipantsLoading,
    chatParticipantsError: state.collaboration.chatParticipantsError,
    chatSessionStateLoading: state.collaboration.chatSessionStateLoading,
    chatSessionStateError: state.collaboration.chatSessionStateError,
    inviteCandidates: state.collaboration.inviteCandidates,
    inviteAgentProfile: state.collaboration.inviteAgentProfile,
    inviteRole: state.collaboration.inviteRole,
    invitePending: state.collaboration.invitePending,
    inviteError: state.collaboration.inviteError,
    inviteDenialReason: state.collaboration.inviteDenialReason,
    isRunPaused: state.derivedState.isRunPaused,
    isRunTerminal: state.derivedState.isRunTerminal,
    pausePending: state.actionState.pauseMutation.isPending,
    resumePending: state.actionState.resumeMutation.isPending,
    abortPending: state.actionState.abortMutation.isPending,
    injectPending: state.actionState.injectMutation.isPending,
    submitAnswersPending: state.actionState.submitAnswersMutation.isPending,
    markInProgressPending: state.actionState.markInProgressMutation.isPending,
    instructResolvePending: state.actionState.instructResolveMutation.isPending,
    setMessage: coreState.setMessage,
    setConflictGuidance: coreState.setConflictGuidance,
    setExecutionTab: coreState.setExecutionTab,
    onInviteAgentProfileChange: state.collaboration.onInviteAgentProfileChange,
    onInviteRoleChange: state.collaboration.onInviteRoleChange,
    onInviteParticipant: state.collaboration.onInviteParticipant,
    onPause: state.actionState.onPause,
    onResume: state.actionState.onResume,
    onAbort: state.actionState.onAbort,
    onInject: state.actionState.onInject,
    onSubmitAnswers: state.actionState.onSubmitAnswers,
    onInstructResolve: state.actionState.onInstructResolve,
    onMarkInProgress: state.actionState.onMarkInProgress,
    onUpdateTodoStatus,
  });
}

export function useActiveSessionWorkspaceViewModel() {
  const coreState = useWorkspaceCoreState();
  const state = useWorkspaceViewModelState(coreState);

  useEffect(() => {
    if (!state.actionState.abortMutation.isSuccess) {
      return;
    }

    if (!state.derivedState.isRunTerminal) {
      return;
    }

    coreState.setControlNotice({
      type: "success",
      title: coreState.isChatSession ? "Session Cancelled" : "Run Aborted",
      message: coreState.isChatSession
        ? "The session reached a terminal state and is now cancelled."
        : "The run reached a terminal state after the abort request.",
    });
  }, [
    coreState.isChatSession,
    coreState.setControlNotice,
    state.actionState.abortMutation.isSuccess,
    state.derivedState.isRunTerminal,
  ]);

  const guard = resolveWorkspaceGuard({
    isChatSession: coreState.isChatSession,
    projectId: coreState.projectId,
    workItemId: coreState.workItemId,
    selectedWorkItem: state.sessionState.selectedWorkItem,
    runId: state.sessionState.runId,
  });
  if (guard) {
    return {
      guard,
      contentProps: null,
    };
  }

  const { isBlocked, sessionTitle, backPath } = resolveWorkspaceMetaByMode({
    isChatSession: coreState.isChatSession,
    chatSessionDisplayName: state.sessionState.chatSessionDetail?.displayName,
    workItemTitle: state.sessionState.workItem?.title,
    chatSessionIdParam: coreState.chatSessionIdParam,
    runId: state.sessionState.runId,
    projectId: coreState.projectId,
    workItemId: coreState.workItemId,
    workItemStatus: state.sessionState.workItem?.status,
  });

  const onUpdateTodoStatus = createTodoStatusUpdater({
    runTodoList: state.todoState.runTodoList,
    hasTodoRunId: !!state.artifactsRunId,
    updateTodoList: state.todoState.updateRunTodoListMutation.mutate,
  });

  return {
    guard,
    contentProps: buildActiveWorkspaceContentProps({
      coreState,
      state,
      sessionTitle,
      backPath,
      isBlocked,
      onUpdateTodoStatus,
    }),
  };
}
