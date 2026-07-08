import { AlertCircle, Loader2, Play } from "lucide-react";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { WorkflowLaunchContractResponse, WorkflowLaunchPreset } from "@/lib/api/workflow-launch.types";
import { WorkflowLaunchContractForm } from "./WorkflowLaunchContractForm";

interface WorkflowLaunchDialogViewProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly workflowName: string;
  readonly fixedProjectId?: string;
  readonly projects: Array<{ id: string; name: string }>;
  readonly isLoading: boolean;
  readonly loadError: unknown;
  readonly contractData?: WorkflowLaunchContractResponse;
  readonly presets: WorkflowLaunchPreset[];
  readonly selectedProjectId: string;
  readonly workItemId: string;
  readonly selectedPresetId: string;
  readonly presetName: string;
  readonly rawJsonEnabled: boolean;
  readonly rawJsonDraft: string;
  readonly inputDrafts: Record<string, string>;
  readonly formError: string | null;
  readonly deletePresetPending: boolean;
  readonly createPresetPending: boolean;
  readonly canDeletePreset: boolean;
  readonly executePending: boolean;
  readonly canLaunch: boolean;
  readonly onSelectedProjectIdChange: (value: string) => void;
  readonly onWorkItemIdChange: (value: string) => void;
  readonly onSelectedPresetIdChange: (value: string) => void;
  readonly onDeletePreset: () => void;
  readonly onPresetNameChange: (value: string) => void;
  readonly onSavePreset: () => void;
  readonly onRawJsonEnabledChange: (enabled: boolean) => void;
  readonly onRawJsonDraftChange: (value: string) => void;
  readonly onInputDraftChange: (key: string, value: string) => void;
  readonly onLaunch: () => void;
}

export function WorkflowLaunchDialogView({
  open,
  onOpenChange,
  workflowName,
  fixedProjectId,
  projects,
  isLoading,
  loadError,
  contractData,
  presets,
  selectedProjectId,
  workItemId,
  selectedPresetId,
  presetName,
  rawJsonEnabled,
  rawJsonDraft,
  inputDrafts,
  formError,
  deletePresetPending,
  createPresetPending,
  canDeletePreset,
  executePending,
  canLaunch,
  onSelectedProjectIdChange,
  onWorkItemIdChange,
  onSelectedPresetIdChange,
  onDeletePreset,
  onPresetNameChange,
  onSavePreset,
  onRawJsonEnabledChange,
  onRawJsonDraftChange,
  onInputDraftChange,
  onLaunch,
}: Readonly<WorkflowLaunchDialogViewProps>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Launch {workflowName}</DialogTitle>
          <DialogDescription>
            Configure launch context, apply presets, and run this workflow.
          </DialogDescription>
        </DialogHeader>
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
        {Boolean(loadError) && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Unable to load launch contract</AlertTitle>
            <AlertDescription>
              {getApiErrorMessage(
                loadError,
                "Failed to load workflow launch contract.",
              )}
            </AlertDescription>
          </Alert>
        )}
        {contractData && (
          <WorkflowLaunchContractForm
            contractData={contractData}
            fixedProjectId={fixedProjectId}
            projects={projects}
            selectedProjectId={selectedProjectId}
            workItemId={workItemId}
            selectedPresetId={selectedPresetId}
            presets={presets}
            presetName={presetName}
            rawJsonEnabled={rawJsonEnabled}
            rawJsonDraft={rawJsonDraft}
            inputDrafts={inputDrafts}
            formError={formError}
            deletePresetPending={deletePresetPending}
            createPresetPending={createPresetPending}
            canDeletePreset={canDeletePreset}
            onSelectedProjectIdChange={onSelectedProjectIdChange}
            onWorkItemIdChange={onWorkItemIdChange}
            onSelectedPresetIdChange={onSelectedPresetIdChange}
            onDeletePreset={onDeletePreset}
            onPresetNameChange={onPresetNameChange}
            onSavePreset={onSavePreset}
            onRawJsonEnabledChange={onRawJsonEnabledChange}
            onRawJsonDraftChange={onRawJsonDraftChange}
            onInputDraftChange={onInputDraftChange}
          />
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button onClick={onLaunch} disabled={executePending || !canLaunch}>
            {executePending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            Launch Workflow
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
