import { useWorkflowEditorStore } from "../../hooks/useWorkflowEditorStore";
import type { JobNodeData } from "../../serialization/types";
import { TextField } from "../fields/TextField";
import { KeyValueField } from "../fields/KeyValueField";
import { updateNodeData } from "./job-node-helpers";

interface EmitEventPropertiesProps {
  nodeId: string;
}

function EmitEventProperties({ nodeId }: EmitEventPropertiesProps) {
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

  const payloadEntries = data.payload as Record<string, string> | undefined;

  return (
    <div className="border rounded-lg p-3 space-y-3">
      <h3 className="font-medium text-sm">Emit Event Properties</h3>

      <TextField
        label="Event Name"
        value={data.eventName ?? ""}
        onChange={(value) => handleChange({ eventName: value })}
        placeholder="e.g. workflow.completed"
      />

      <KeyValueField
        label="Payload"
        entries={payloadEntries ?? {}}
        onChange={(entries) => handleChange({ payload: entries })}
        keyPlaceholder="Key"
        valuePlaceholder="Value"
      />
    </div>
  );
}

export { EmitEventProperties };
