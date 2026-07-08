import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LifecycleResultsCard } from "@/components/workflows/LifecycleResultsCard";
import { useWorkflowRunGraph } from "@/hooks/useWorkflowRunGraph";
import { WorkflowLifecycleResultsQuery } from "@/lib/api/workflow-lifecycle.types";
import { WorkflowRun } from "@/lib/api/workflows.types";
import { WorkflowRunDetailContent } from "./WorkflowRunDetailContent";
import { getChatEmptyMessage } from "./workflow-run-detail.helpers";
import { useWorkflowRunDetailState } from "./workflow-run-detail.state";

function getBackPath(workflowId?: string): string {
  return workflowId ? `/workflows/${workflowId}` : "/workflows";
}

function getLifecycleResultsQuery(
  run: WorkflowRun,
): WorkflowLifecycleResultsQuery | null {
  if (run.source_type !== "repository") {
    return null;
  }

  const trigger = run.state_variables?.trigger;
  if (!trigger || typeof trigger !== "object") {
    return null;
  }

  const triggerFields = trigger as Record<string, unknown>;
  if (typeof triggerFields.scopeId !== "string") {
    return null;
  }

  return {
    scopeId: triggerFields.scopeId,
    contextId:
      typeof triggerFields.contextId === "string"
        ? triggerFields.contextId
        : undefined,
  };
}

export function WorkflowRunDetail() {
  const { id: workflowId, runId } = useParams<{ id: string; runId: string }>();
  const navigate = useNavigate();
  const state = useWorkflowRunDetailState(runId);
  const {
    data: graph,
    isLoading: isLoadingGraph,
    error: graphError,
  } = useWorkflowRunGraph({
    workflowId: workflowId || "",
    runId,
  });

  const backPath = getBackPath(workflowId);

  if (!runId) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground">Missing run ID.</p>
        <Button asChild>
          <Link to={backPath}>Back to workflow</Link>
        </Button>
      </div>
    );
  }

  if (state.isLoadingRun) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (state.runError || !state.run) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground">Unable to load workflow run.</p>
        <Button
          onClick={() => {
            navigate(backPath);
          }}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to workflow
        </Button>
      </div>
    );
  }

  const handleBack = () => {
    navigate(backPath);
  };

  const lifecycleResultsQuery = getLifecycleResultsQuery(state.run);

  return (
    <div className="space-y-4">
      <WorkflowRunDetailContent
        run={state.run}
        workflowId={workflowId}
        graph={graph}
        isLoadingGraph={isLoadingGraph}
        graphError={graphError}
        autonomyDiagnostics={state.autonomyDiagnostics}
        retrospectiveTrace={state.retrospectiveTrace}
        connectionState={state.connectionState}
        telemetryError={state.telemetryError}
        phaseMarkers={state.phaseMarkers}
        events={state.events}
        isLoadingTelemetry={state.isLoadingTelemetry}
        chatMessages={state.chatMessages}
        chatEmptyMessage={getChatEmptyMessage(state.dispatchControlRun)}
        message={state.message}
        onMessageChange={state.setMessage}
        onInjectMessage={state.onInjectMessage}
        isInjectingMessage={state.injectMessageMutation.isPending}
        pendingQuestions={state.pendingQuestions}
        onSubmitAnswers={state.onSubmitAnswers}
        isSubmittingAnswers={state.submitAnswersMutation.isPending}
        isInteractive={state.run.status === "RUNNING"}
        stepOutputs={state.stepOutputs}
        runExecutions={state.runExecutions}
        activeSessionPath={state.activeSessionPath}
        onBack={handleBack}
        onRestartOrchestration={state.onRestartOrchestration}
        isRestartOrchestrationPending={
          state.restartOrchestrationMutation.isPending
        }
        onRestartWorkItemWorkflow={state.onRestartWorkItemWorkflow}
        isRestartWorkItemWorkflowPending={
          state.restartWorkItemWorkflowMutation.isPending
        }
        onRerunOriginalWorkflow={state.onRerunOriginalWorkflow}
        isRerunOriginalWorkflowPending={
          state.rerunOriginalWorkflowMutation.isPending
        }
        failureReason={state.failureReason}
        workItemRestartNotice={state.workItemRestartNotice}
        onAbortRun={state.onAbortRun}
        isAbortRunPending={state.abortRunMutation.isPending}
      />
      {lifecycleResultsQuery ? (
        <LifecycleResultsCard query={lifecycleResultsQuery} />
      ) : null}
    </div>
  );
}
