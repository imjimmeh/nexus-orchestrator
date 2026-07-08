import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { QuestionAnswer } from "@/lib/api/settings.types";
import { WorkItem } from "@/lib/api/work-items.types";
import { queryKeys } from "@/lib/queryKeys";
import {
  buildConflictResolutionInstruction,
  getMergeConflictReason,
} from "./active-session.utils";
import { requireValue } from "./active-session.workspace.helpers";
import type { ActiveSessionControlNotice } from "./active-session.workspace.types";

function buildAbortPendingNotice(
  isChatSession: boolean,
): ActiveSessionControlNotice {
  if (isChatSession) {
    return {
      type: "info",
      title: "Cancelling Session",
      message: "Sending cancellation request to the active chat session...",
    };
  }

  return {
    type: "info",
    title: "Aborting Run",
    message: "Sending abort signal to the active workflow run...",
  };
}

function buildAbortRequestedNotice(
  isChatSession: boolean,
): ActiveSessionControlNotice {
  if (isChatSession) {
    return {
      type: "info",
      title: "Cancellation Requested",
      message:
        "Cancellation request accepted. Waiting for the session status to reach CANCELLED.",
    };
  }

  return {
    type: "info",
    title: "Abort Requested",
    message:
      "Abort request accepted. Waiting for the run status to reach a terminal state.",
  };
}

function buildAbortFailedNotice(
  isChatSession: boolean,
  error: unknown,
): ActiveSessionControlNotice {
  return {
    type: "error",
    title: isChatSession ? "Cancellation Failed" : "Abort Failed",
    message: getApiErrorMessage(
      error,
      isChatSession
        ? "Failed to cancel this session."
        : "Failed to abort this run.",
    ),
  };
}

async function invalidateAbortQueries(params: {
  queryClient: ReturnType<typeof useQueryClient>;
  isChatSession: boolean;
  chatSessionId: string | undefined;
  runId: string | undefined;
}): Promise<void> {
  const chatInvalidations =
    params.isChatSession && params.chatSessionId
      ? [
          params.queryClient.invalidateQueries({
            queryKey: queryKeys.chatSessions.detail(params.chatSessionId),
          }),
          params.queryClient.invalidateQueries({
            queryKey: queryKeys.chatSessions.state(params.chatSessionId),
          }),
          params.queryClient.invalidateQueries({
            queryKey: queryKeys.chatSessions.events(params.chatSessionId),
          }),
          params.queryClient.invalidateQueries({
            queryKey: queryKeys.chatSessions.participants(params.chatSessionId),
          }),
        ]
      : [];

  const runInvalidations = params.runId
    ? [
        params.queryClient.invalidateQueries({
          queryKey: queryKeys.workflowRuns.detail(params.runId),
        }),
        params.queryClient.invalidateQueries({
          queryKey: queryKeys.workflowRuns.events(params.runId),
        }),
      ]
    : [];

  const invalidations: Array<Promise<unknown>> = [
    ...chatInvalidations,
    ...runInvalidations,
    params.queryClient.invalidateQueries({
      queryKey: queryKeys.workflowRuns.list(),
    }),
    params.queryClient.invalidateQueries({
      queryKey: queryKeys.chatSessions.list(),
    }),
  ];

  await Promise.all(invalidations);
}

export function useWorkspaceArtifacts(runId: string | undefined) {
  const {
    data: workspaceDiff,
    error: workspaceDiffError,
    isLoading: workspaceDiffLoading,
  } = useQuery({
    queryKey: ["workflow-run-workspace-diff", runId],
    queryFn: () =>
      api.getWorkflowRunWorkspaceDiff(requireValue(runId, "runId")),
    enabled: !!runId,
    refetchInterval: runId ? 4000 : false,
  });

  const {
    data: workspaceTree,
    error: workspaceTreeError,
    isLoading: workspaceTreeLoading,
  } = useQuery({
    queryKey: ["workflow-run-workspace-tree", runId],
    queryFn: () =>
      api.getWorkflowRunWorkspaceTree(requireValue(runId, "runId")),
    enabled: !!runId,
    refetchInterval: runId ? 5000 : false,
  });

  return {
    workspaceDiff,
    workspaceDiffError,
    workspaceDiffLoading,
    workspaceTree,
    workspaceTreeError,
    workspaceTreeLoading,
  };
}

export function useActiveSessionWorkspaceActions(params: {
  isChatSession: boolean;
  chatSessionId: string | undefined;
  projectId: string | undefined;
  targetWorkItemId: string | null;
  runId: string | undefined;
  workItem: WorkItem | null;
  message: string;
  conflictGuidance: string;
  setControlNotice: (value: ActiveSessionControlNotice | null) => void;
  setMessage: (value: string) => void;
  setConflictGuidance: (value: string) => void;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const {
    pauseMutation,
    resumeMutation,
    abortMutation,
    injectMutation,
    onPause,
    onResume,
    onAbort,
    onInject,
  } = useRunControlActions({
    isChatSession: params.isChatSession,
    chatSessionId: params.chatSessionId,
    runId: params.runId,
    message: params.message,
    queryClient: params.queryClient,
    setControlNotice: params.setControlNotice,
    setMessage: params.setMessage,
  });
  const {
    markInProgressMutation,
    instructResolveMutation,
    onInstructResolve,
    onMarkInProgress,
  } = useWorkItemResolutionActions({
    projectId: params.projectId,
    targetWorkItemId: params.targetWorkItemId,
    runId: params.runId,
    workItem: params.workItem,
    conflictGuidance: params.conflictGuidance,
    setConflictGuidance: params.setConflictGuidance,
    queryClient: params.queryClient,
  });
  const { submitAnswersMutation, onSubmitAnswers } = useSubmitAnswerActions({
    isChatSession: params.isChatSession,
    chatSessionId: params.chatSessionId,
    runId: params.runId,
    setMessage: params.setMessage,
    setControlNotice: params.setControlNotice,
  });

  return {
    pauseMutation,
    resumeMutation,
    abortMutation,
    injectMutation,
    markInProgressMutation,
    instructResolveMutation,
    submitAnswersMutation,
    onPause,
    onResume,
    onAbort,
    onInject,
    onSubmitAnswers,
    onInstructResolve,
    onMarkInProgress,
  };
}

function useRunControlActions(params: {
  isChatSession: boolean;
  chatSessionId: string | undefined;
  runId: string | undefined;
  message: string;
  queryClient: ReturnType<typeof useQueryClient>;
  setControlNotice: (value: ActiveSessionControlNotice | null) => void;
  setMessage: (value: string) => void;
}) {
  const pauseMutation = useMutation({
    mutationFn: () => api.pauseWorkflowRun(requireValue(params.runId, "runId")),
  });
  const resumeMutation = useMutation({
    mutationFn: () =>
      api.resumeWorkflowRun(requireValue(params.runId, "runId")),
  });
  const abortMutation = useMutation({
    mutationFn: async () => {
      if (params.isChatSession) {
        await api.cancelChatSession(
          requireValue(params.chatSessionId, "chatSessionId"),
        );
        return;
      }

      await api.abortWorkflowRun(requireValue(params.runId, "runId"));
    },
    onMutate: () => {
      params.setControlNotice(buildAbortPendingNotice(params.isChatSession));
    },
    onSuccess: () => {
      params.setControlNotice(buildAbortRequestedNotice(params.isChatSession));
    },
    onError: (error) => {
      params.setControlNotice(
        buildAbortFailedNotice(params.isChatSession, error),
      );
    },
    onSettled: async () => {
      await invalidateAbortQueries({
        queryClient: params.queryClient,
        isChatSession: params.isChatSession,
        chatSessionId: params.chatSessionId,
        runId: params.runId,
      });
    },
  });
  const injectMutation = useMutation({
    mutationFn: ({
      content,
      attachmentIds,
    }: {
      content: string;
      attachmentIds?: string[];
    }) => {
      if (params.isChatSession) {
        return api.sendChatSessionMessage(
          requireValue(params.chatSessionId, "chatSessionId"),
          content,
          attachmentIds,
        );
      }

      return api.injectWorkflowRunMessage(
        requireValue(params.runId, "runId"),
        content,
      );
    },
    onSuccess: () => {
      params.setMessage("");
    },
  });

  return {
    pauseMutation,
    resumeMutation,
    abortMutation,
    injectMutation,
    onPause: () => {
      if (params.isChatSession) {
        return;
      }

      pauseMutation.mutate();
    },
    onResume: () => {
      if (params.isChatSession) {
        return;
      }

      resumeMutation.mutate();
    },
    onAbort: () => {
      abortMutation.mutate();
    },
    onInject: (attachmentIds?: string[]) => {
      injectMutation.mutate({ content: params.message, attachmentIds });
    },
  };
}

function useWorkItemResolutionActions(params: {
  projectId: string | undefined;
  targetWorkItemId: string | null;
  runId: string | undefined;
  workItem: WorkItem | null;
  conflictGuidance: string;
  setConflictGuidance: (value: string) => void;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const markInProgressMutation = useMutation({
    mutationFn: () =>
      api.updateProjectWorkItemStatus(
        requireValue(params.projectId, "projectId"),
        requireValue(params.targetWorkItemId, "workItemId"),
        { status: "in-progress" },
      ),
    onSuccess: async () => {
      await params.queryClient.invalidateQueries({
        queryKey: queryKeys.projectWorkItems.all(params.projectId ?? ""),
      });
    },
  });

  const instructResolveMutation = useMutation({
    mutationFn: async (guidance: string) => {
      const requiredProjectId = requireValue(params.projectId, "projectId");
      const requiredWorkItemId = requireValue(
        params.targetWorkItemId,
        "workItemId",
      );
      const requiredRunId = requireValue(params.runId, "runId");
      const requiredWorkItem = requireValue(params.workItem, "workItem");

      const instruction = buildConflictResolutionInstruction({
        workItemTitle: requiredWorkItem.title,
        mergeReason: getMergeConflictReason(requiredWorkItem),
        userGuidance: guidance,
      });

      await api.injectWorkflowRunMessage(requiredRunId, instruction);
      await api.resumeWorkflowRun(requiredRunId);
      await api.updateProjectWorkItemStatus(
        requiredProjectId,
        requiredWorkItemId,
        {
          status: "in-progress",
        },
      );
    },
    onSuccess: async () => {
      params.setConflictGuidance("");
      await params.queryClient.invalidateQueries({
        queryKey: queryKeys.projectWorkItems.all(params.projectId ?? ""),
      });
    },
  });

  return {
    markInProgressMutation,
    instructResolveMutation,
    onInstructResolve: () => {
      if (!params.targetWorkItemId) {
        return;
      }

      instructResolveMutation.mutate(params.conflictGuidance);
    },
    onMarkInProgress: () => {
      if (!params.targetWorkItemId) {
        return;
      }

      markInProgressMutation.mutate();
    },
  };
}

function useSubmitAnswerActions(params: {
  isChatSession: boolean;
  chatSessionId: string | undefined;
  runId: string | undefined;
  setMessage: (value: string) => void;
  setControlNotice: (value: ActiveSessionControlNotice | null) => void;
}) {
  const submitAnswersMutation = useMutation({
    mutationFn: (answers: QuestionAnswer[]) => {
      if (params.isChatSession) {
        return api.submitChatSessionQuestionAnswers(
          requireValue(params.chatSessionId, "chatSessionId"),
          answers,
        );
      }

      return api.submitQuestionAnswers(
        requireValue(params.runId, "runId"),
        answers,
      );
    },
    onSuccess: () => {
      params.setMessage("");
    },
    onError: (error: unknown) => {
      params.setControlNotice({
        type: "error",
        title: "Answer Submission Failed",
        message: getApiErrorMessage(error, "Failed to submit answers"),
      });
    },
  });

  return {
    submitAnswersMutation,
    onSubmitAnswers: (answers: QuestionAnswer[]) => {
      submitAnswersMutation.mutate(answers);
    },
  };
}
