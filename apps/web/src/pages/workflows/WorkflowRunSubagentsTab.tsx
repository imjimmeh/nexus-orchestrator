import { SubagentExecutionPanel } from "@/components/orchestration/SubagentExecutionPanel";
import { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";

export type WorkflowRunSubagentsTabProps = {
  events: WorkflowTelemetryEvent[];
};

export function WorkflowRunSubagentsTab({
  events,
}: WorkflowRunSubagentsTabProps) {
  return <SubagentExecutionPanel events={events} />;
}
