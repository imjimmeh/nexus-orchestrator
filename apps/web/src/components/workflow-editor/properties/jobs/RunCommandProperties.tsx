import { useWorkflowEditorStore } from "../../hooks/useWorkflowEditorStore";
import type { JobNodeData } from "../../serialization/types";
import { TextField } from "../fields/TextField";
import { TimeoutField } from "./TimeoutField";
import { updateNodeData } from "./job-node-helpers";

interface RunCommandPropertiesProps {
  nodeId: string;
}

function RunCommandProperties({ nodeId }: RunCommandPropertiesProps) {
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
      <h3 className="font-medium text-sm">Run Command Properties</h3>

      <TextField
        label="Command"
        value={data.command ?? ""}
        onChange={(value) => handleChange({ command: value })}
        placeholder="e.g. npm run build"
      />

      <TextField
        label="Working Directory"
        value={data.workingDir ?? ""}
        onChange={(value) => handleChange({ workingDir: value })}
        placeholder="/home/runner"
      />

      <TimeoutField
        label="Timeout (ms)"
        value={data.timeoutMs}
        defaultValueMs={30000}
        onChange={(v) => handleChange({ timeoutMs: v })}
      />
    </div>
  );
}

export { RunCommandProperties };
