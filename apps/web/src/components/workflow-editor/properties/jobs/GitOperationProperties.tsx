import { useWorkflowEditorStore } from "../../hooks/useWorkflowEditorStore";
import type { JobNodeData } from "../../serialization/types";
import { TextField } from "../fields/TextField";
import { SelectField } from "../fields/SelectField";
import { updateNodeData } from "./job-node-helpers";

interface GitOperationPropertiesProps {
  nodeId: string;
}

const ACTION_OPTIONS = [
  { value: "merge", label: "Merge" },
  { value: "provision_worktree", label: "Provision Worktree" },
  { value: "remove_worktree", label: "Remove Worktree" },
  { value: "create_branch", label: "Create Branch" },
  { value: "commit_paths", label: "Commit Paths" },
];

function GitOperationProperties({ nodeId }: GitOperationPropertiesProps) {
  const nodes = useWorkflowEditorStore((s) => s.nodes);
  const setNodes = useWorkflowEditorStore((s) => s.setNodes);
  const pushAction = useWorkflowEditorStore((s) => s.pushAction);

  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const data = node.data as JobNodeData & {
    targetBranch?: string;
    baseBranch?: string;
  };

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
      <h3 className="font-medium text-sm">Git Operation Properties</h3>

      <SelectField
        label="Action"
        value={data.action ?? "merge"}
        onChange={(value) => handleChange({ action: value })}
        options={ACTION_OPTIONS}
      />

      <TextField
        label="Repository ID"
        value={data.repositoryId ?? ""}
        onChange={(value) => handleChange({ repositoryId: value })}
        placeholder="Repository identifier"
      />

      <TextField
        label="Target Branch"
        value={data.targetBranch ?? ""}
        onChange={(value) => handleChange({ targetBranch: value })}
        placeholder="e.g. feature/new-ui"
      />

      <TextField
        label="Base Branch"
        value={data.baseBranch ?? ""}
        onChange={(value) => handleChange({ baseBranch: value })}
        placeholder="e.g. main"
      />
    </div>
  );
}

export { GitOperationProperties };
