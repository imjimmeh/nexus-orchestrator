import { useWorkflowEditorStore } from "../../hooks/useWorkflowEditorStore";
import type { JobNodeData } from "../../serialization/types";
import { TextField } from "../fields/TextField";
import { SelectField } from "../fields/SelectField";
import { updateNodeData } from "./job-node-helpers";

interface ManageToolCandidatePropertiesProps {
  nodeId: string;
}

const ACTION_OPTIONS = [
  { value: "validate", label: "Validate" },
  { value: "publish", label: "Publish" },
];

function ManageToolCandidateProperties({
  nodeId,
}: ManageToolCandidatePropertiesProps) {
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
      <h3 className="font-medium text-sm">Manage Tool Candidate Properties</h3>

      <SelectField
        label="Action"
        value={data.action ?? "validate"}
        onChange={(value) => handleChange({ action: value })}
        options={ACTION_OPTIONS}
      />

      <TextField
        label="Artifact ID"
        value={data.artifactId ?? ""}
        onChange={(value) => handleChange({ artifactId: value })}
        placeholder="Artifact identifier"
      />
    </div>
  );
}

export { ManageToolCandidateProperties };
