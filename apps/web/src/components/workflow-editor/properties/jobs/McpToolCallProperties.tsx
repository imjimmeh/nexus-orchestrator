import { useWorkflowEditorStore } from "../../hooks/useWorkflowEditorStore";
import type { JobNodeData } from "../../serialization/types";
import { TextField } from "../fields/TextField";
import { KeyValueField } from "../fields/KeyValueField";
import { updateNodeData } from "./job-node-helpers";

interface McpToolCallPropertiesProps {
  nodeId: string;
}

function McpToolCallProperties({ nodeId }: McpToolCallPropertiesProps) {
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

  const params = data.params as Record<string, string> | undefined;

  return (
    <div className="border rounded-lg p-3 space-y-3">
      <h3 className="font-medium text-sm">MCP Tool Call Properties</h3>

      <TextField
        label="Server ID"
        value={data.serverId ?? ""}
        onChange={(value) => handleChange({ serverId: value })}
        placeholder="MCP server identifier"
      />

      <TextField
        label="Tool Name"
        value={data.toolName ?? ""}
        onChange={(value) => handleChange({ toolName: value })}
        placeholder="e.g. list_files"
      />

      <KeyValueField
        label="Params"
        entries={params ?? {}}
        onChange={(entries) => handleChange({ params: entries })}
        keyPlaceholder="Param"
        valuePlaceholder="Value"
      />
    </div>
  );
}

export { McpToolCallProperties };
