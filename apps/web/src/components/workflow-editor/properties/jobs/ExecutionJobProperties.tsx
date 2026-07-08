import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useWorkflowEditorStore } from "../../hooks/useWorkflowEditorStore";
import type { JobNodeData } from "../../serialization/types";
import type { OutputContract } from "@nexus/core";
import { TextField } from "../fields/TextField";
import { TextareaField } from "../fields/TextareaField";
import { updateNodeData, splitTrim } from "./job-node-helpers";

interface ExecutionJobPropertiesProps {
  nodeId: string;
}

const OUTPUT_REQUIRED_LABEL = "Required Outputs";
const OUTPUT_OPTIONAL_LABEL = "Optional Outputs";

function PermissionsSection() {
  const [open, setOpen] = useState(false);

  return (
    <div className="border rounded-lg">
      <Button
        type="button"
        variant="ghost"
        className="w-full flex items-center justify-between px-3 py-2 h-auto font-medium text-sm"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Permissions"
      >
        <span>Permissions</span>
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0" />
        )}
      </Button>
      {open && (
        <div className="px-3 pb-3 space-y-3">
          <div className="flex items-center gap-2 py-2">
            <Badge variant="secondary">Coming Soon</Badge>
            <p className="text-xs text-muted-foreground">
              Tool and host mount permission policies will be available in a
              future update.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function ExecutionJobProperties({ nodeId }: ExecutionJobPropertiesProps) {
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

  const outputContract = data.outputContract as OutputContract | undefined;

  return (
    <div className="border rounded-lg p-3 space-y-3">
      <h3 className="font-medium text-sm">Execution Properties</h3>

      <TextField
        label="Agent Profile"
        value={data.agentProfile ?? ""}
        onChange={(value) => handleChange({ agentProfile: value })}
        placeholder="e.g. code-reviewer"
      />

      <TextField
        label="Max Step Loops"
        value={String(data.maxStepLoops ?? 10)}
        onChange={(value) =>
          handleChange({
            maxStepLoops: value === "" ? undefined : Number(value),
          })
        }
        placeholder="10"
      />

      <TextareaField
        label={OUTPUT_REQUIRED_LABEL}
        value={(outputContract?.required ?? []).join(", ")}
        onChange={(value) =>
          handleChange({
            outputContract: {
              required: splitTrim(value),
              optional: outputContract?.optional ?? [],
            } as OutputContract,
          })
        }
        placeholder="result, summary"
        rows={2}
        description="Comma-separated output keys"
      />

      <TextareaField
        label={OUTPUT_OPTIONAL_LABEL}
        value={(outputContract?.optional ?? []).join(", ")}
        onChange={(value) =>
          handleChange({
            outputContract: {
              required: outputContract?.required ?? [],
              optional: splitTrim(value),
            } as OutputContract,
          })
        }
        placeholder="details, logs"
        rows={2}
        description="Comma-separated output keys"
      />

      <PermissionsSection />
    </div>
  );
}

export { ExecutionJobProperties };
