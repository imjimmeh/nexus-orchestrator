import { useCallback, useEffect, useMemo, useState } from "react";
import { WorkflowLaunchContractResponse } from "@/lib/api/workflow-launch.types";
import {
  buildInputDrafts,
  readOptionalString,
  sanitizeTriggerDraft,
} from "./workflowLaunchDialog.helpers";

interface UseWorkflowLaunchDialogStateParams {
  readonly open: boolean;
  readonly workflowId: string;
  readonly fixedProjectId?: string;
  readonly initialTriggerData?: Record<string, unknown> | null;
  readonly initialWorkItemId?: string;
}

export function useWorkflowLaunchDialogState({
  open,
  workflowId,
  fixedProjectId,
  initialTriggerData,
  initialWorkItemId,
}: Readonly<UseWorkflowLaunchDialogStateParams>) {
  const sanitizedInitialTrigger = useMemo(
    () => sanitizeTriggerDraft(initialTriggerData),
    [initialTriggerData],
  );

  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [workItemId, setWorkItemId] = useState<string>("");
  const [selectedPresetId, setSelectedPresetId] = useState<string>("");
  const [presetName, setPresetName] = useState<string>("");
  const [inputDrafts, setInputDrafts] = useState<Record<string, string>>({});
  const [rawJsonEnabled, setRawJsonEnabled] = useState<boolean>(false);
  const [rawJsonDraft, setRawJsonDraft] = useState<string>("{}");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const initialProject =
      fixedProjectId ?? readOptionalString(sanitizedInitialTrigger.projectId);

    setSelectedProjectId(initialProject);
    setWorkItemId(
      readOptionalString(initialWorkItemId) ||
        readOptionalString(sanitizedInitialTrigger.workItemId),
    );
    setSelectedPresetId("");
    setPresetName("");
    setRawJsonEnabled(false);
    setRawJsonDraft(JSON.stringify(sanitizedInitialTrigger, null, 2));
    setFormError(null);
  }, [
    fixedProjectId,
    initialWorkItemId,
    open,
    sanitizedInitialTrigger,
    workflowId,
  ]);

  const applyPreset = useCallback(
    (presetId: string, contractData?: WorkflowLaunchContractResponse) => {
      if (!contractData) {
        return;
      }

      const preset = contractData.presets.find(
        (candidate) => candidate.id === presetId,
      );
      if (!preset) {
        return;
      }

      const payload = sanitizeTriggerDraft(preset.trigger_data);

      if (!fixedProjectId && preset.project_id) {
        setSelectedProjectId(preset.project_id);
      }

      const nextWorkItemId = readOptionalString(payload.workItemId);
      if (nextWorkItemId) {
        setWorkItemId(nextWorkItemId);
      }

      setInputDrafts(buildInputDrafts(contractData, payload));
      setRawJsonDraft(JSON.stringify(payload, null, 2));
    },
    [fixedProjectId],
  );

  return {
    sanitizedInitialTrigger,
    selectedProjectId,
    setSelectedProjectId,
    workItemId,
    setWorkItemId,
    selectedPresetId,
    setSelectedPresetId,
    presetName,
    setPresetName,
    inputDrafts,
    setInputDrafts,
    rawJsonEnabled,
    setRawJsonEnabled,
    rawJsonDraft,
    setRawJsonDraft,
    formError,
    setFormError,
    applyPreset,
  };
}
