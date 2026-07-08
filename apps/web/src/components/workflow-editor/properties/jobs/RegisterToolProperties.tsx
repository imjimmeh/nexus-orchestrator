import { useWorkflowEditorStore } from "../../hooks/useWorkflowEditorStore";
import type { JobNodeData } from "../../serialization/types";
import { TextField } from "../fields/TextField";
import { TextareaField } from "../fields/TextareaField";
import { updateNodeData } from "./job-node-helpers";

interface RegisterToolPropertiesProps {
  nodeId: string;
}

function RegisterToolProperties({ nodeId }: RegisterToolPropertiesProps) {
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

  const schemaStr =
    data.toolSchema !== null && data.toolSchema !== undefined
      ? JSON.stringify(data.toolSchema, null, 2)
      : "";

  function handleSchemaChange(value: string) {
    try {
      updateNodeData(
        nodeId,
        { toolSchema: JSON.parse(value) },
        nodes,
        setNodes,
        pushAction,
      );
    } catch {
      updateNodeData(
        nodeId,
        { toolSchema: { raw: value } },
        nodes,
        setNodes,
        pushAction,
      );
    }
  }

  return (
    <div className="border rounded-lg p-3 space-y-3">
      <h3 className="font-medium text-sm">Register Tool Properties</h3>

      <TextField
        label="Name"
        value={((data as Record<string, unknown>).name as string) ?? ""}
        onChange={(value) =>
          handleChange({ name: value } as Partial<JobNodeData>)
        }
        placeholder="e.g. my-custom-tool"
      />

      <TextareaField
        label="Schema"
        value={schemaStr}
        onChange={handleSchemaChange}
        placeholder='{"type": "object", "properties": {}}'
        rows={4}
        description="JSON Schema for the tool"
      />

      <TextareaField
        label="TypeScript Code"
        value={data.typescriptCode ?? ""}
        onChange={(value) => handleChange({ typescriptCode: value })}
        placeholder="export default function myTool(args) { ... }"
        rows={5}
      />
    </div>
  );
}

export { RegisterToolProperties };
