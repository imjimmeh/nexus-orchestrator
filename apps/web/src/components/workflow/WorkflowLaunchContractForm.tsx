import { AlertCircle, Loader2, Save, Trash2 } from "lucide-react";
import { WorkflowLaunchContractResponse, WorkflowLaunchPreset } from "@/lib/api/workflow-launch.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SelectItem } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { NullableSelect } from "@/components/ui/nullable-select";
import { WorkflowLaunchInputField } from "./WorkflowLaunchInputField";

interface WorkflowLaunchContractFormProps {
  readonly contractData: WorkflowLaunchContractResponse;
  readonly fixedProjectId?: string;
  readonly projects: Array<{ id: string; name: string }>;
  readonly selectedProjectId: string;
  readonly workItemId: string;
  readonly selectedPresetId: string;
  readonly presets: WorkflowLaunchPreset[];
  readonly presetName: string;
  readonly rawJsonEnabled: boolean;
  readonly rawJsonDraft: string;
  readonly inputDrafts: Record<string, string>;
  readonly formError: string | null;
  readonly deletePresetPending: boolean;
  readonly createPresetPending: boolean;
  readonly canDeletePreset: boolean;
  readonly onSelectedProjectIdChange: (value: string) => void;
  readonly onWorkItemIdChange: (value: string) => void;
  readonly onSelectedPresetIdChange: (value: string) => void;
  readonly onDeletePreset: () => void;
  readonly onPresetNameChange: (value: string) => void;
  readonly onSavePreset: () => void;
  readonly onRawJsonEnabledChange: (enabled: boolean) => void;
  readonly onRawJsonDraftChange: (value: string) => void;
  readonly onInputDraftChange: (key: string, value: string) => void;
}

function LaunchContextFields(props: Readonly<WorkflowLaunchContractFormProps>) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="workflow-launch-project">Project</Label>
        {props.fixedProjectId ? (
          <Input
            id="workflow-launch-project"
            value={props.fixedProjectId}
            readOnly
          />
        ) : (
          <NullableSelect
            value={props.selectedProjectId || null}
            onValueChange={(v) => props.onSelectedProjectIdChange(v ?? "")}
            placeholder="No project"
          >
            {props.projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </NullableSelect>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="workflow-launch-work-item">Work Item ID</Label>
        <Input
          id="workflow-launch-work-item"
          value={props.workItemId}
          onChange={(event) => {
            props.onWorkItemIdChange(event.target.value);
          }}
          placeholder="Optional work item id"
        />
      </div>
    </div>
  );
}

function PresetSection(props: Readonly<WorkflowLaunchContractFormProps>) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="workflow-launch-preset">Preset</Label>
        <div className="flex gap-2">
          <NullableSelect
            value={props.selectedPresetId || null}
            onValueChange={(v) => props.onSelectedPresetIdChange(v ?? "")}
            placeholder="No preset"
            className="flex-1"
          >
            {props.presets.map((preset) => (
              <SelectItem key={preset.id} value={preset.id}>
                {preset.name}
              </SelectItem>
            ))}
          </NullableSelect>
          <Button
            type="button"
            variant="outline"
            onClick={props.onDeletePreset}
            disabled={!props.canDeletePreset || props.deletePresetPending}
          >
            {props.deletePresetPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-4 w-4" />
            )}
            Delete
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="workflow-launch-preset-name">
          Save Current As Preset
        </Label>
        <div className="flex gap-2">
          <Input
            id="workflow-launch-preset-name"
            value={props.presetName}
            onChange={(event) => {
              props.onPresetNameChange(event.target.value);
            }}
            placeholder="Preset name"
          />
          <Button
            type="button"
            variant="outline"
            onClick={props.onSavePreset}
            disabled={props.createPresetPending}
          >
            {props.createPresetPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save
          </Button>
        </div>
      </div>
    </>
  );
}

function PayloadModeSection(props: Readonly<WorkflowLaunchContractFormProps>) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Checkbox
          id="workflow-launch-raw-json"
          checked={props.rawJsonEnabled}
          disabled={!props.contractData.contract.allowRawJson}
          onCheckedChange={(checked) => {
            props.onRawJsonEnabledChange(checked === true);
          }}
        />
        <Label htmlFor="workflow-launch-raw-json">Use raw JSON payload</Label>
      </div>

      {!props.contractData.contract.allowRawJson && (
        <p className="text-sm text-muted-foreground">
          Raw JSON mode is disabled for this workflow contract.
        </p>
      )}
    </div>
  );
}

function PayloadEditorSection(
  props: Readonly<WorkflowLaunchContractFormProps>,
) {
  if (props.rawJsonEnabled) {
    return (
      <div className="space-y-2">
        <Label htmlFor="workflow-launch-json">Trigger Payload JSON</Label>
        <Textarea
          id="workflow-launch-json"
          value={props.rawJsonDraft}
          onChange={(event) => {
            props.onRawJsonDraftChange(event.target.value);
          }}
          className="min-h-[200px] font-mono text-xs"
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {props.contractData.contract.inputs.map((input) => (
        <div key={input.key} className="space-y-2">
          <Label htmlFor={`workflow-launch-${input.key}`}>
            {input.label}
            {input.required ? " *" : ""}
          </Label>
          <WorkflowLaunchInputField
            input={input}
            value={props.inputDrafts[input.key] || ""}
            onChange={(value) => {
              props.onInputDraftChange(input.key, value);
            }}
          />
          {input.description && (
            <p className="text-xs text-muted-foreground">{input.description}</p>
          )}
        </div>
      ))}
    </div>
  );
}

export function WorkflowLaunchContractForm(
  props: Readonly<WorkflowLaunchContractFormProps>,
) {
  return (
    <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
      {!props.contractData.eligibility.eligible && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Launch is blocked for current context</AlertTitle>
          <AlertDescription>
            {props.contractData.eligibility.reasons
              .map((reason) => reason.message)
              .join(" ")}
          </AlertDescription>
        </Alert>
      )}

      <LaunchContextFields {...props} />
      <PresetSection {...props} />
      <PayloadModeSection {...props} />
      <PayloadEditorSection {...props} />

      {props.formError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Launch failed</AlertTitle>
          <AlertDescription>{props.formError}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
