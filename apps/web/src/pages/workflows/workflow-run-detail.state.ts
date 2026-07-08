import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  useWorkflowRun,
  useWorkflowRunAutonomyDiagnostics,
  useWorkflowRunExecutions,
  useWorkflowRunRetrospectiveTrace,
} from "@/hooks/useWorkflows";
import { useWorkflowRunTelemetry } from "@/hooks/useWorkflowRunTelemetry";
import {
  getPendingQuestions,
  toSessionChatMessages,
} from "@/pages/active-session/active-session.utils";
import {
  extractPhaseMarkers,
  getWorkflowFailureReason,
  isDispatchControlRun,
  isTerminalWorkflowRunStatus,
  parseStepOutputsFromRunState,
  parseTurnEndOutputs,
  readInitialUserMessage,
  readRunTrigger,
  readWorkItemIdFromTrigger,
} from "./workflow-run-detail.helpers";
import { useWorkflowRunDetailMutations } from "./workflow-run-detail.mutations";

function useWorkflowRunDerivedState(params: {
  run: ReturnType<typeof useWorkflowRun>["data"];
  events: ReturnType<typeof useWorkflowRunTelemetry>["events"];
  runId: string | undefined;
}) {
  const runTrigger = readRunTrigger(params.run?.state_variables);
  const initialUserMessage = readInitialUserMessage(runTrigger);
  const workItemIdFromTrigger = readWorkItemIdFromTrigger(runTrigger);
  const dispatchControlRun = isDispatchControlRun(runTrigger);
  const projectIdFromTrigger =
    typeof runTrigger?.projectId === "string" ? runTrigger.projectId : null;
  const isTerminalRunStatus = isTerminalWorkflowRunStatus(params.run?.status);

  const chatMessages = useMemo(
    () => toSessionChatMessages(params.events, { initialUserMessage }),
    [params.events, initialUserMessage],
  );

  const toolEvents = useMemo(
    () =>
      params.events.filter(
        (event) =>
          event.event_type === "tool_execution_start" ||
          event.event_type === "tool_execution_end",
      ),
    [params.events],
  );

  const phaseMarkers = useMemo(
    () => extractPhaseMarkers(params.events),
    [params.events],
  );
  const pendingQuestions = useMemo(
    () => getPendingQuestions(params.events),
    [params.events],
  );
  const failureReason = useMemo(
    () => getWorkflowFailureReason(params.events, params.run?.status),
    [params.events, params.run?.status],
  );

  const stepOutputs = useMemo(() => {
    const fromState = params.run?.state_variables
      ? parseStepOutputsFromRunState(params.run.state_variables)
      : [];

    if (fromState.length > 0) {
      return fromState;
    }

    return parseTurnEndOutputs(params.events);
  }, [params.run?.state_variables, params.events]);

  const canRestartOrchestration = !!projectIdFromTrigger && isTerminalRunStatus;
  const canRestartWorkItemWorkflow =
    !!projectIdFromTrigger && !!workItemIdFromTrigger && isTerminalRunStatus;
  const activeSessionPath =
    projectIdFromTrigger && params.runId
      ? `/projects/${projectIdFromTrigger}/runs/${params.runId}/active-session`
      : undefined;

  return {
    dispatchControlRun,
    projectIdFromTrigger,
    workItemIdFromTrigger,
    activeSessionPath,
    chatMessages,
    toolEvents,
    phaseMarkers,
    pendingQuestions,
    failureReason,
    stepOutputs,
    canRestartOrchestration,
    canRestartWorkItemWorkflow,
  };
}

export function useWorkflowRunDetailState(runId: string | undefined) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const effectiveRunId = runId ?? "";
  const [message, setMessage] = useState("");
  const [workItemRestartNotice, setWorkItemRestartNotice] = useState<
    string | null
  >(null);

  const {
    data: run,
    isLoading: isLoadingRun,
    error: runError,
  } = useWorkflowRun(effectiveRunId);
  const autonomyDiagnosticsQuery = useWorkflowRunAutonomyDiagnostics(
    effectiveRunId,
    run?.status,
  );
  const runExecutionsQuery = useWorkflowRunExecutions(
    effectiveRunId,
    run?.status,
  );
  const retrospectiveTraceQuery =
    useWorkflowRunRetrospectiveTrace(effectiveRunId);

  const {
    events,
    isLoading: isLoadingTelemetry,
    error: telemetryError,
    connectionState,
  } = useWorkflowRunTelemetry(runId);

  const derivedState = useWorkflowRunDerivedState({ run, events, runId });
  const originalTrigger = readRunTrigger(run?.state_variables);
  const canRerunOriginalWorkflow =
    isTerminalWorkflowRunStatus(run?.status) &&
    !!run?.workflow_id &&
    !!originalTrigger;

  const {
    restartOrchestrationMutation,
    restartWorkItemWorkflowMutation,
    rerunOriginalWorkflowMutation,
    abortRunMutation,
    injectMessageMutation,
    submitAnswersMutation,
    actions,
  } = useWorkflowRunDetailMutations({
    runId,
    runWorkflowId: run?.workflow_id,
    originalTrigger,
    projectIdFromTrigger: derivedState.projectIdFromTrigger,
    workItemIdFromTrigger: derivedState.workItemIdFromTrigger,
    queryClient,
    navigate,
    message,
    setMessage,
    setWorkItemRestartNotice,
    canRestartOrchestration: derivedState.canRestartOrchestration,
    canRestartWorkItemWorkflow: derivedState.canRestartWorkItemWorkflow,
    canRerunOriginalWorkflow,
    isRunRunning: run?.status === "RUNNING",
  });

  return {
    run,
    isLoadingRun,
    runError,
    autonomyDiagnostics: autonomyDiagnosticsQuery.data,
    retrospectiveTrace: retrospectiveTraceQuery.data,
    runExecutions: runExecutionsQuery.data ?? [],
    events,
    isLoadingTelemetry,
    telemetryError,
    connectionState,
    dispatchControlRun: derivedState.dispatchControlRun,
    projectIdFromTrigger: derivedState.projectIdFromTrigger,
    activeSessionPath: derivedState.activeSessionPath,
    message,
    setMessage,
    chatMessages: derivedState.chatMessages,
    toolEvents: derivedState.toolEvents,
    phaseMarkers: derivedState.phaseMarkers,
    pendingQuestions: derivedState.pendingQuestions,
    failureReason: derivedState.failureReason,
    stepOutputs: derivedState.stepOutputs,
    canRestartOrchestration: derivedState.canRestartOrchestration,
    canRestartWorkItemWorkflow: derivedState.canRestartWorkItemWorkflow,
    canRerunOriginalWorkflow,
    restartOrchestrationMutation,
    restartWorkItemWorkflowMutation,
    rerunOriginalWorkflowMutation,
    abortRunMutation,
    injectMessageMutation,
    submitAnswersMutation,
    onInjectMessage: actions.onInjectMessage,
    onSubmitAnswers: actions.onSubmitAnswers,
    onRestartOrchestration: actions.onRestartOrchestration,
    onRestartWorkItemWorkflow: actions.onRestartWorkItemWorkflow,
    onRerunOriginalWorkflow: actions.onRerunOriginalWorkflow,
    onAbortRun: actions.onAbortRun,
    workItemRestartNotice,
  };
}
