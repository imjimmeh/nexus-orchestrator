import { useWorkflowEditorStore } from "../hooks/useWorkflowEditorStore";
import type { StepNodeData, StepNode } from "../serialization/types";
import { TextField } from "./fields/TextField";
import { TextareaField } from "./fields/TextareaField";
import { SelectField } from "./fields/SelectField";
import { HandlebarsField } from "./fields/HandlebarsField";
import { KeyValueField } from "./fields/KeyValueField";
import { updateNodeData } from "./jobs/job-node-helpers";
import { HarnessSelector } from "@/components/HarnessSelector/HarnessSelector";
import { useHarnesses } from "@/hooks/useHarnesses";
import { ProviderCompatibilityHint } from "@/components/harnesses/ProviderCompatibilityHint";

const STEP_TYPE_OPTIONS = [
  { value: "agent", label: "Agent" },
  { value: "run_command", label: "Command" },
  { value: "set_variable", label: "Set Variable" },
  { value: "wait", label: "Wait" },
];

const ON_ERROR_OPTIONS = [
  { value: "fail", label: "Fail" },
  { value: "continue", label: "Continue" },
  { value: "goto:", label: "GoTo <step-id>" },
];

const PROMPT_MODE_OPTIONS = [
  { value: "override", label: "Override" },
  { value: "append", label: "Append" },
];

interface StepTypeFieldsProps {
  data: StepNodeData;
  onUpdate: (partial: Partial<StepNodeData>) => void;
}

function StepTypeSpecificFields({
  data,
  onUpdate,
}: Readonly<StepTypeFieldsProps>) {
  const { data: harnesses = [] } = useHarnesses();

  return (
    <>
      {data.stepType === "agent" && (
        <>
          <TextareaField
            label="Prompt"
            value={data.prompt ?? ""}
            onChange={(prompt) => onUpdate({ prompt })}
            placeholder="Enter agent prompt"
          />
          <TextField
            label="Prompt File"
            value={data.promptFile ?? ""}
            onChange={(promptFile) => onUpdate({ promptFile })}
            placeholder="path/to/prompt.txt"
          />
          <SelectField
            label="Prompt Mode"
            value={data.promptMode ?? "override"}
            onChange={(promptMode) =>
              onUpdate({
                promptMode: promptMode as StepNodeData["promptMode"],
              })
            }
            options={PROMPT_MODE_OPTIONS}
          />
          <HarnessSelector
            label="Harness Override"
            harnesses={harnesses.map((h) => ({
              harnessId: h.harnessId,
              displayName: h.displayName,
            }))}
            value={data.harnessId}
            onChange={(harnessId) => onUpdate({ harnessId })}
            allowInherit
          />
          {(() => {
            const selected = harnesses.find(
              (h) => h.harnessId === data.harnessId,
            );
            return (
              <ProviderCompatibilityHint
                compatibleProviderIds={selected?.compatibleProviderIds}
                selectedProviderId={undefined}
              />
            );
          })()}
        </>
      )}

      {data.stepType === "run_command" && (
        <>
          <TextField
            label="Command"
            value={data.command ?? ""}
            onChange={(command) => onUpdate({ command })}
            placeholder="Enter command"
          />
          <TextField
            label="Working Dir"
            value={data.workingDir ?? ""}
            onChange={(workingDir) => onUpdate({ workingDir })}
            placeholder="/path/to/dir"
          />
        </>
      )}

      {data.stepType === "set_variable" && (
        <KeyValueField
          label="Variables"
          entries={(data.variables as Record<string, string>) ?? {}}
          onChange={(variables) => onUpdate({ variables })}
          keyPlaceholder="Name"
          valuePlaceholder="Value"
        />
      )}

      {data.stepType === "wait" && (
        <TextField
          label="Timeout (ms)"
          value={data.timeoutMs !== undefined ? String(data.timeoutMs) : ""}
          onChange={(v) =>
            onUpdate({ timeoutMs: v === "" ? undefined : Number(v) })
          }
          placeholder="5000"
        />
      )}
    </>
  );
}

function StepProperties() {
  const selectedElementId = useWorkflowEditorStore((s) => s.selectedElementId);
  const nodes = useWorkflowEditorStore((s) => s.nodes);
  const setNodes = useWorkflowEditorStore((s) => s.setNodes);
  const pushAction = useWorkflowEditorStore((s) => s.pushAction);

  if (!selectedElementId) {
    return null;
  }

  const selectedNode = nodes.find((n) => n.id === selectedElementId) as
    | StepNode
    | undefined;
  if (!selectedNode || selectedNode.type !== "step") {
    return null;
  }

  const data = selectedNode.data as StepNodeData;
  const nodeId = selectedElementId;

  function handleUpdate(partial: Partial<StepNodeData>) {
    updateNodeData(
      nodeId,
      partial as Record<string, unknown>,
      nodes,
      setNodes,
      pushAction,
    );
  }

  return (
    <div className="space-y-3 p-3">
      <div className="border rounded-lg p-3 space-y-3">
        <h3 className="font-medium text-sm">Step Properties</h3>

        <div className="space-y-1.5">
          <span className="text-sm font-medium leading-none">Step ID</span>
          <p className="text-sm text-muted-foreground">{data.stepId}</p>
        </div>

        <SelectField
          label="Type"
          value={data.stepType}
          onChange={(stepType) =>
            handleUpdate({ stepType: stepType as StepNodeData["stepType"] })
          }
          options={STEP_TYPE_OPTIONS}
        />

        <StepTypeSpecificFields data={data} onUpdate={handleUpdate} />

        <div className="border-t pt-3 mt-2">
          <h4 className="text-xs font-medium text-muted-foreground mb-2">
            Common
          </h4>
          <SelectField
            label="On Error"
            value={data.onError ?? "fail"}
            onChange={(onError) =>
              handleUpdate({
                onError: onError as StepNodeData["onError"],
              })
            }
            options={ON_ERROR_OPTIONS}
          />
          <HandlebarsField
            label="If Condition"
            value={data.if ?? ""}
            onChange={(ifCondition) => handleUpdate({ if: ifCondition })}
            placeholder="{{eq step.status 'done'}}"
          />
        </div>
      </div>
    </div>
  );
}

export { StepProperties };
