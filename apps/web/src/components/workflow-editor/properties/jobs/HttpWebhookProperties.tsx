import { useWorkflowEditorStore } from "../../hooks/useWorkflowEditorStore";
import type { JobNodeData } from "../../serialization/types";
import { TextField } from "../fields/TextField";
import { SelectField } from "../fields/SelectField";
import { KeyValueField } from "../fields/KeyValueField";
import { TextareaField } from "../fields/TextareaField";
import { TimeoutField } from "./TimeoutField";
import { updateNodeData } from "./job-node-helpers";

interface HttpWebhookPropertiesProps {
  nodeId: string;
}

const METHOD_OPTIONS = [
  { value: "GET", label: "GET" },
  { value: "POST", label: "POST" },
  { value: "PUT", label: "PUT" },
  { value: "PATCH", label: "PATCH" },
  { value: "DELETE", label: "DELETE" },
];

function HttpWebhookProperties({ nodeId }: HttpWebhookPropertiesProps) {
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

  const headers = data.headers as Record<string, string> | undefined;

  return (
    <div className="border rounded-lg p-3 space-y-3">
      <h3 className="font-medium text-sm">HTTP Webhook Properties</h3>

      <TextField
        label="URL"
        value={data.url ?? ""}
        onChange={(value) => handleChange({ url: value })}
        placeholder="https://api.example.com/webhook"
      />

      <SelectField
        label="Method"
        value={data.method ?? "GET"}
        onChange={(value) => handleChange({ method: value })}
        options={METHOD_OPTIONS}
      />

      <KeyValueField
        label="Headers"
        entries={headers ?? {}}
        onChange={(entries) => handleChange({ headers: entries })}
        keyPlaceholder="Header"
        valuePlaceholder="Value"
      />

      <TextareaField
        label="Body"
        value={typeof data.body === "string" ? data.body : ""}
        onChange={(value) => handleChange({ body: value })}
        placeholder="JSON body"
        rows={3}
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

export { HttpWebhookProperties };
