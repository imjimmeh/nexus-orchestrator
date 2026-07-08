import { useWorkflowEditorStore } from "../hooks/useWorkflowEditorStore";
import type { JobNode, JobNodeData } from "../serialization/types";
import { ExecutionJobProperties } from "./jobs/ExecutionJobProperties";
import { InvokeWorkflowProperties } from "./jobs/InvokeWorkflowProperties";
import { RunCommandProperties } from "./jobs/RunCommandProperties";
import { EmitEventProperties } from "./jobs/EmitEventProperties";
import { HttpWebhookProperties } from "./jobs/HttpWebhookProperties";
import { WebAutomationProperties } from "./jobs/WebAutomationProperties";
import { McpToolCallProperties } from "./jobs/McpToolCallProperties";
import { GitOperationProperties } from "./jobs/GitOperationProperties";
import { RegisterToolProperties } from "./jobs/RegisterToolProperties";
import { ManageToolCandidateProperties } from "./jobs/ManageToolCandidateProperties";

const JOB_COMPONENT_MAP: Record<
  string,
  React.ComponentType<{ nodeId: string }>
> = {
  execution: ExecutionJobProperties,
  invoke_workflow: InvokeWorkflowProperties,
  run_command: RunCommandProperties,
  emit_event: EmitEventProperties,
  http_webhook: HttpWebhookProperties,
  web_automation: WebAutomationProperties,
  mcp_tool_call: McpToolCallProperties,
  git_operation: GitOperationProperties,
  register_tool: RegisterToolProperties,
  manage_tool_candidate: ManageToolCandidateProperties,
};

function JobProperties() {
  const selectedElementId = useWorkflowEditorStore((s) => s.selectedElementId);
  const nodes = useWorkflowEditorStore((s) => s.nodes);

  if (selectedElementId === null) return null;

  const selectedNode = nodes.find((n) => n.id === selectedElementId) as
    | JobNode
    | undefined;
  if (!selectedNode || selectedNode.type !== "job") return null;

  const data = selectedNode.data as JobNodeData;
  const Component = JOB_COMPONENT_MAP[data.jobType];

  if (!Component) {
    return (
      <div className="p-4 text-sm text-muted-foreground text-center">
        Unknown job type
      </div>
    );
  }

  return <Component nodeId={selectedElementId} />;
}

export { JobProperties };
