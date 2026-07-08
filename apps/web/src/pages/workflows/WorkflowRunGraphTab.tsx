import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExecutionSummary, WorkflowRun, WorkflowRunGraph } from "@/lib/api/workflows.types";
import { ProviderModelBadge } from "@/components/ai/ProviderModelBadge";
import { WorkflowRunContextStrip } from "@/components/workflow/WorkflowRunContextStrip";
import { WorkflowVisualizer } from "@/components/workflow/WorkflowVisualizer";
import {
  StepResults,
  type StepOutput,
} from "./WorkflowRunDetailSupport";

export type WorkflowRunGraphTabProps = {
  run: WorkflowRun;
  workflowId?: string;
  graph?: WorkflowRunGraph | null;
  isLoadingGraph?: boolean;
  graphError?: unknown;
  stepOutputs: StepOutput[];
  runExecutions: ExecutionSummary[];
};

export function WorkflowRunGraphTab({
  run,
  workflowId,
  graph,
  isLoadingGraph,
  graphError,
  stepOutputs,
  runExecutions,
}: WorkflowRunGraphTabProps) {
  return (
    <>
      <WorkflowRunContextStrip
        workflowId={workflowId ?? run.workflow_id}
        runs={[run]}
        selectedRunId={run.id}
      />
      <WorkflowVisualizer
        graph={graph}
        isLoading={isLoadingGraph}
        error={graphError}
      />
      <Card>
        <CardHeader>
          <CardTitle>Models used</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {runExecutions.length === 0 ? (
            <span className="text-sm text-muted-foreground">
              No executions recorded yet.
            </span>
          ) : (
            runExecutions.map((execution) => (
              <ProviderModelBadge
                key={execution.id}
                provider={execution.provider}
                model={execution.model}
                harnessId={execution.harnessId}
                providerSource={execution.providerSource}
              />
            ))
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Step Results</CardTitle>
        </CardHeader>
        <CardContent>
          <StepResults entries={stepOutputs} />
        </CardContent>
      </Card>
    </>
  );
}
