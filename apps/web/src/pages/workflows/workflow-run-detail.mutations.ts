import { useMutation, type useQueryClient } from "@tanstack/react-query";
import type { useNavigate } from "react-router-dom";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/useToast";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { queryKeys } from "@/lib/queryKeys";

type QuestionAnswers = Array<{
  questionIndex: number;
  selectedOption: string | null;
  freeTextAnswer: string | null;
}>;

async function invalidateRunQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  runId: string | undefined,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: queryKeys.workflowRuns.list(),
    }),
    runId
      ? queryClient.invalidateQueries({
          queryKey: queryKeys.workflowRuns.detail(runId),
        })
      : Promise.resolve(),
  ]);
}

function useRestartOrchestrationMutation(params: {
  projectId: string | null;
  runId: string | undefined;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  return useMutation({
    mutationFn: async () => {
      if (!params.projectId) {
        throw new Error("Run trigger does not include a project id");
      }

      return api.startProjectOrchestration(params.projectId, {});
    },
    onSuccess: async () => {
      await invalidateRunQueries(params.queryClient, params.runId);
    },
  });
}

function useAbortRunMutation(params: {
  runId: string | undefined;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  return useMutation({
    mutationFn: async () => {
      if (!params.runId) {
        throw new Error("Missing run ID");
      }

      return api.abortWorkflowRun(params.runId);
    },
    onSuccess: async () => {
      if (!params.runId) {
        return;
      }

      await Promise.all([
        invalidateRunQueries(params.queryClient, params.runId),
        params.queryClient.invalidateQueries({
          queryKey: queryKeys.workflowRuns.events(params.runId),
        }),
      ]);
    },
  });
}

function useRestartWorkItemWorkflowMutation(params: {
  projectId: string | null;
  workItemId: string | null;
  runId: string | undefined;
  queryClient: ReturnType<typeof useQueryClient>;
  navigate: ReturnType<typeof useNavigate>;
  setNotice: (value: string | null) => void;
}) {
  return useMutation({
    mutationFn: async () => {
      if (!params.projectId || !params.workItemId) {
        throw new Error("Run trigger does not include work item context");
      }

      const result = await api.restartWorkItemExecution(
        params.projectId,
        params.workItemId,
      );
      const nextRunId = result.triggeredRunIds.find(
        (candidate) => typeof candidate === "string" && candidate.length > 0,
      );

      if (!nextRunId) {
        return null;
      }

      const nextRun = await api.getWorkflowRun(nextRunId);
      return {
        runId: nextRunId,
        workflowId: nextRun.workflow_id,
      };
    },
    onMutate: () => {
      params.setNotice(null);
    },
    onSuccess: async (nextRunLocation) => {
      await invalidateRunQueries(params.queryClient, params.runId);

      if (!nextRunLocation) {
        params.setNotice(
          "Restart requested, but no workflow was triggered for the current work item status. The original run may have been triggered from a different status.",
        );
        return;
      }

      params.navigate(
        `/workflows/${nextRunLocation.workflowId}/runs/${nextRunLocation.runId}`,
      );
    },
  });
}

function useRerunOriginalWorkflowMutation(params: {
  workflowId: string | undefined;
  triggerPayload: Record<string, unknown> | null;
  navigate: ReturnType<typeof useNavigate>;
}) {
  return useMutation({
    mutationFn: async () => {
      if (!params.workflowId || !params.triggerPayload) {
        throw new Error("Original workflow trigger is not available");
      }
      return {
        workflowId: params.workflowId,
        triggerPayload: params.triggerPayload,
      };
    },
    onSuccess: (nextRunLocation) => {
      params.navigate(`/workflows/${nextRunLocation.workflowId}`, {
        state: {
          launchDraft: {
            triggerData: nextRunLocation.triggerPayload,
            launchSource: "rerun_with_edits",
          },
        },
      });
    },
  });
}

function useInteractiveMutations(params: {
  runId: string | undefined;
  message: string;
  setMessage: (value: string) => void;
}) {
  const toast = useToast();

  const injectMessageMutation = useMutation({
    mutationFn: async () => {
      if (!params.runId) {
        throw new Error("Missing run ID");
      }

      const trimmed = params.message.trim();
      if (!trimmed) {
        return;
      }

      await api.injectWorkflowRunMessage(params.runId, trimmed);
    },
    onSuccess: () => {
      params.setMessage("");
    },
    onError: (error) => {
      toast.error(
        "Guidance not delivered",
        getApiErrorMessage(
          error,
          "No active agent session is available to receive this guidance.",
        ),
      );
    },
  });

  const submitAnswersMutation = useMutation({
    mutationFn: (answers: QuestionAnswers) => {
      if (!params.runId) {
        throw new Error("Missing run ID");
      }

      return api.submitQuestionAnswers(params.runId, answers);
    },
  });

  return {
    injectMessageMutation,
    submitAnswersMutation,
  };
}

function buildMutationHandler(options: {
  enabled: boolean;
  runMutation: () => void;
}): (() => void) | undefined {
  if (!options.enabled) {
    return undefined;
  }

  return () => {
    options.runMutation();
  };
}

function buildWorkflowRunActions(params: {
  injectMessageMutation: ReturnType<
    typeof useInteractiveMutations
  >["injectMessageMutation"];
  submitAnswersMutation: ReturnType<
    typeof useInteractiveMutations
  >["submitAnswersMutation"];
  restartOrchestrationMutation: ReturnType<
    typeof useRestartOrchestrationMutation
  >;
  restartWorkItemWorkflowMutation: ReturnType<
    typeof useRestartWorkItemWorkflowMutation
  >;
  rerunOriginalWorkflowMutation: ReturnType<
    typeof useRerunOriginalWorkflowMutation
  >;
  abortRunMutation: ReturnType<typeof useAbortRunMutation>;
  canRestartOrchestration: boolean;
  canRestartWorkItemWorkflow: boolean;
  canRerunOriginalWorkflow: boolean;
  isRunRunning: boolean;
}) {
  const onInjectMessage = () => {
    params.injectMessageMutation.mutate();
  };

  const onSubmitAnswers = (answers: QuestionAnswers) => {
    params.submitAnswersMutation.mutate(answers);
  };

  const onRestartOrchestration = buildMutationHandler({
    enabled: params.canRestartOrchestration,
    runMutation: () => {
      params.restartOrchestrationMutation.mutate();
    },
  });

  const onRestartWorkItemWorkflow = buildMutationHandler({
    enabled: params.canRestartWorkItemWorkflow,
    runMutation: () => {
      params.restartWorkItemWorkflowMutation.mutate();
    },
  });

  const onRerunOriginalWorkflow = buildMutationHandler({
    enabled: params.canRerunOriginalWorkflow,
    runMutation: () => {
      params.rerunOriginalWorkflowMutation.mutate();
    },
  });

  const onAbortRun = buildMutationHandler({
    enabled: params.isRunRunning,
    runMutation: () => {
      params.abortRunMutation.mutate();
    },
  });

  return {
    onInjectMessage,
    onSubmitAnswers,
    onRestartOrchestration,
    onRestartWorkItemWorkflow,
    onRerunOriginalWorkflow,
    onAbortRun,
  };
}

export function useWorkflowRunDetailMutations(params: {
  runId: string | undefined;
  runWorkflowId: string | undefined;
  originalTrigger: Record<string, unknown> | null;
  projectIdFromTrigger: string | null;
  workItemIdFromTrigger: string | null;
  queryClient: ReturnType<typeof useQueryClient>;
  navigate: ReturnType<typeof useNavigate>;
  message: string;
  setMessage: (value: string) => void;
  setWorkItemRestartNotice: (value: string | null) => void;
  canRestartOrchestration: boolean;
  canRestartWorkItemWorkflow: boolean;
  canRerunOriginalWorkflow: boolean;
  isRunRunning: boolean;
}) {
  const restartOrchestrationMutation = useRestartOrchestrationMutation({
    projectId: params.projectIdFromTrigger,
    runId: params.runId,
    queryClient: params.queryClient,
  });
  const abortRunMutation = useAbortRunMutation({
    runId: params.runId,
    queryClient: params.queryClient,
  });
  const restartWorkItemWorkflowMutation = useRestartWorkItemWorkflowMutation({
    projectId: params.projectIdFromTrigger,
    workItemId: params.workItemIdFromTrigger,
    runId: params.runId,
    queryClient: params.queryClient,
    navigate: params.navigate,
    setNotice: params.setWorkItemRestartNotice,
  });
  const rerunOriginalWorkflowMutation = useRerunOriginalWorkflowMutation({
    workflowId: params.runWorkflowId,
    triggerPayload: params.originalTrigger,
    navigate: params.navigate,
  });
  const { injectMessageMutation, submitAnswersMutation } =
    useInteractiveMutations({
      runId: params.runId,
      message: params.message,
      setMessage: params.setMessage,
    });
  const actions = buildWorkflowRunActions({
    injectMessageMutation,
    submitAnswersMutation,
    restartOrchestrationMutation,
    restartWorkItemWorkflowMutation,
    rerunOriginalWorkflowMutation,
    abortRunMutation,
    canRestartOrchestration: params.canRestartOrchestration,
    canRestartWorkItemWorkflow: params.canRestartWorkItemWorkflow,
    canRerunOriginalWorkflow: params.canRerunOriginalWorkflow,
    isRunRunning: params.isRunRunning,
  });

  return {
    restartOrchestrationMutation,
    restartWorkItemWorkflowMutation,
    rerunOriginalWorkflowMutation,
    abortRunMutation,
    injectMessageMutation,
    submitAnswersMutation,
    actions,
  };
}
