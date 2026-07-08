import { useWorkflowEditorStore } from "../../hooks/useWorkflowEditorStore";
import type { JobNodeData } from "../../serialization/types";
import { TextField } from "../fields/TextField";
import { TextareaField } from "../fields/TextareaField";
import { updateNodeData } from "./job-node-helpers";

interface WebAutomationPropertiesProps {
  nodeId: string;
}

function WebAutomationProperties({ nodeId }: WebAutomationPropertiesProps) {
  const nodes = useWorkflowEditorStore((s) => s.nodes);
  const setNodes = useWorkflowEditorStore((s) => s.setNodes);
  const pushAction = useWorkflowEditorStore((s) => s.pushAction);

  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const data = node.data as JobNodeData & {
    selectorConfig?: Record<string, unknown>;
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

  const selectorConfigStr =
    data.selectorConfig !== null
      ? JSON.stringify(data.selectorConfig, null, 2)
      : "";

  function handleSelectorConfigChange(value: string) {
    try {
      const parsed = JSON.parse(value);
      updateNodeData(
        nodeId,
        { selectorConfig: parsed },
        nodes,
        setNodes,
        pushAction,
      );
    } catch {
      updateNodeData(
        nodeId,
        { selectorConfig: { raw: value } },
        nodes,
        setNodes,
        pushAction,
      );
    }
  }

  return (
    <div className="border rounded-lg p-3 space-y-3">
      <h3 className="font-medium text-sm">Web Automation Properties</h3>

      <TextField
        label="Action"
        value={data.action ?? ""}
        onChange={(value) => handleChange({ action: value })}
        placeholder="e.g. click, fill, navigate"
      />

      <TextField
        label="URL"
        value={data.url ?? ""}
        onChange={(value) => handleChange({ url: value })}
        placeholder="https://example.com"
      />

      <TextareaField
        label="Selector Config"
        value={selectorConfigStr}
        onChange={handleSelectorConfigChange}
        placeholder='{"selector": ".main-button", "waitMs": 1000}'
        rows={3}
        description="JSON selector configuration"
      />
    </div>
  );
}

export { WebAutomationProperties };
