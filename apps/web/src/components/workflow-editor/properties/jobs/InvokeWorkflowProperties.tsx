import { useWorkflowEditorStore } from "../../hooks/useWorkflowEditorStore";
import type { JobNodeData } from "../../serialization/types";
import { TextField } from "../fields/TextField";
import { SwitchField } from "../fields/SwitchField";
import { updateNodeData } from "./job-node-helpers";

interface InvokeWorkflowPropertiesProps {
  nodeId: string;
}

function InvokeWorkflowProperties({ nodeId }: InvokeWorkflowPropertiesProps) {
  const nodes = useWorkflowEditorStore((s) => s.nodes);
  const setNodes = useWorkflowEditorStore((s) => s.setNodes);
  const pushAction = useWorkflowEditorStore((s) => s.pushAction);

  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const data = node.data as JobNodeData;

  function handleChange(partial: Partial<JobNodeData>) {
    updateNodeData(
      nodeId,
      partial as Record<string, unknown>,
      nodes,
      setNodes,
      pushAction,
    );
  }

  return (
    <div className="border rounded-lg p-3 space-y-3">
      <h3 className="font-medium text-sm">Invoke Workflow Properties</h3>

      <TextField
        label="Workflow ID"
        value={data.targetWorkflowId ?? ""}
        onChange={(value) => handleChange({ targetWorkflowId: value })}
        placeholder="Target workflow identifier"
      />

      <SwitchField
        label="Wait for Completion"
        checked={data.waitForCompletion ?? false}
        onChange={(value) => handleChange({ waitForCompletion: value })}
      />
    </div>
  );
}

export { InvokeWorkflowProperties };
