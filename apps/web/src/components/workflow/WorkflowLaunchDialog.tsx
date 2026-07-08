import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useProjectList } from "@/hooks/useProjects";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { buildInputDrafts } from "./workflowLaunchDialog.helpers";
import { WorkflowLaunchDialogView } from "./WorkflowLaunchDialogView";
import type { WorkflowLaunchDialogProps } from "./workflow-launch-dialog.types";
import { useWorkflowLaunchDialogState } from "./workflowLaunchDialog.state";
import { useWorkflowLaunchDialogActions } from "./workflowLaunchDialog.mutations";

export type { WorkflowLaunchDialogProps } from "./workflow-launch-dialog.types";

export function WorkflowLaunchDialog(
  props: Readonly<WorkflowLaunchDialogProps>,
) {
  const {
    open,
    onOpenChange,
    workflowId,
    fixedProjectId,
    initialTriggerData,
    initialWorkItemId,
    defaultLaunchSource,
    onLaunched,
  } = props;
  const { data: projects = [] } = useProjectList();
  const state = useWorkflowLaunchDialogState({
    open,
    workflowId,
    fixedProjectId,
    initialTriggerData,
    initialWorkItemId,
  });

  const contextQuery = useMemo(
    () => ({
      projectId: state.selectedProjectId || undefined,
      workItemId: state.workItemId.trim() || undefined,
    }),
    [state.selectedProjectId, state.workItemId],
  );

  const launchContractQuery = useQuery({
    queryKey: queryKeys.workflows.launchContract(workflowId, contextQuery),
    queryFn: () => api.getWorkflowLaunchContract(workflowId, contextQuery),
    enabled: open && workflowId.length > 0,
  });
  const contractData = launchContractQuery.data;

  useEffect(() => {
    if (!contractData) {
      return;
    }

    state.setInputDrafts(
      buildInputDrafts(contractData, state.sanitizedInitialTrigger),
    );
  }, [contractData, state.sanitizedInitialTrigger, state.setInputDrafts]);

  const presets = contractData?.presets ?? [];
  const selectedPreset = presets.find(
    (preset) => preset.id === state.selectedPresetId,
  );

  const actions = useWorkflowLaunchDialogActions({
    workflowId,
    contextQuery,
    contractData,
    inputDrafts: state.inputDrafts,
    rawJsonEnabled: state.rawJsonEnabled,
    rawJsonDraft: state.rawJsonDraft,
    selectedProjectId: state.selectedProjectId,
    workItemId: state.workItemId,
    selectedPresetId: state.selectedPresetId,
    presetName: state.presetName,
    fixedProjectId,
    defaultLaunchSource,
    onPresetSaved: (presetId) => {
      state.setPresetName("");
      state.setSelectedPresetId(presetId);
    },
    onPresetDeleted: () => {
      state.setSelectedPresetId("");
    },
    onLaunched: (runId) => {
      onLaunched?.({ runId });
    },
    onLaunchCompleted: () => {
      onOpenChange(false);
    },
    setFormError: state.setFormError,
  });

  return (
    <WorkflowLaunchDialogView
      {...props}
      projects={projects}
      isLoading={launchContractQuery.isLoading}
      loadError={launchContractQuery.error}
      contractData={contractData}
      presets={presets}
      selectedProjectId={state.selectedProjectId}
      workItemId={state.workItemId}
      selectedPresetId={state.selectedPresetId}
      presetName={state.presetName}
      rawJsonEnabled={state.rawJsonEnabled}
      rawJsonDraft={state.rawJsonDraft}
      inputDrafts={state.inputDrafts}
      formError={state.formError}
      deletePresetPending={actions.deletePresetMutation.isPending}
      createPresetPending={actions.createPresetMutation.isPending}
      canDeletePreset={Boolean(selectedPreset)}
      executePending={actions.executeMutation.isPending}
      canLaunch={
        !launchContractQuery.isLoading &&
        Boolean(contractData?.eligibility.eligible)
      }
      onSelectedProjectIdChange={state.setSelectedProjectId}
      onWorkItemIdChange={state.setWorkItemId}
      onSelectedPresetIdChange={(nextPresetId) => {
        state.setSelectedPresetId(nextPresetId);
        if (nextPresetId) {
          state.applyPreset(nextPresetId, contractData);
        }
      }}
      onDeletePreset={actions.handleDeletePreset}
      onPresetNameChange={state.setPresetName}
      onSavePreset={actions.handleSavePreset}
      onRawJsonEnabledChange={state.setRawJsonEnabled}
      onRawJsonDraftChange={state.setRawJsonDraft}
      onInputDraftChange={(key, value) => {
        state.setInputDrafts((current) => ({
          ...current,
          [key]: value,
        }));
      }}
      onLaunch={actions.handleLaunch}
    />
  );
}
