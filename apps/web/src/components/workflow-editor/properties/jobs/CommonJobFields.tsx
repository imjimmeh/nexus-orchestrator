import { useWorkflowEditorStore } from "../../hooks/useWorkflowEditorStore";
import type { JobNodeData } from "../../serialization/types";
import { TextField } from "../fields/TextField";
import { SelectField } from "../fields/SelectField";
import { HandlebarsField } from "../fields/HandlebarsField";
import { updateNodeData, splitTrim } from "./job-node-helpers";

interface CommonJobFieldsProps {
  nodeId: string;
}

const TIER_OPTIONS = [
  { value: "light", label: "Light" },
  { value: "heavy", label: "Heavy" },
];

function CommonJobFields({ nodeId }: CommonJobFieldsProps) {
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
      <h3 className="font-medium text-sm">Job Settings</h3>

      <TextField
        label="Job ID"
        value={data.jobId ?? ""}
        onChange={(value) => handleChange({ jobId: value })}
        placeholder="Enter job ID"
      />

      <SelectField
        label="Tier"
        value={data.tier ?? "light"}
        onChange={(value) => handleChange({ tier: value })}
        options={TIER_OPTIONS}
      />

      <HandlebarsField
        label="Condition"
        value={data.condition ?? ""}
        onChange={(value) => handleChange({ condition: value })}
        placeholder="e.g. {{needs.previous.status}} == 'success'"
        showHelper
      />

      <TextField
        label="Depends On"
        value={(data.dependsOn ?? []).join(", ")}
        onChange={(value) => handleChange({ dependsOn: splitTrim(value) })}
        placeholder="job-a, job-b"
        description="Comma-separated job IDs"
      />

      <TextField
        label="Max Retries"
        value={
          data.maxRetries !== null && data.maxRetries !== undefined
            ? String(data.maxRetries)
            : ""
        }
        onChange={(value) =>
          handleChange({
            maxRetries: value === "" ? undefined : Number(value),
          })
        }
        placeholder="1"
      />
    </div>
  );
}

export { CommonJobFields };
