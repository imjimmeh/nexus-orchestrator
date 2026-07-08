import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { ExecuteWorkflowRequest, WorkflowLaunchContractResponse, WorkflowLaunchSource } from "@/lib/api/workflow-launch.types";
import {
  buildTriggerPayload,
  getContextReasonMessage,
} from "./workflowLaunchDialog.helpers";
import { getApiErrorMessage } from "@/lib/api/error-message";

interface SharedMutationParams {
  readonly workflowId: string;
  readonly contextQuery: {
    projectId?: string;
    workItemId?: string;
  };
  readonly contractData?: WorkflowLaunchContractResponse;
  readonly inputDrafts: Record<string, string>;
  readonly rawJsonEnabled: boolean;
  readonly rawJsonDraft: string;
  readonly selectedProjectId: string;
  readonly workItemId: string;
}

export function useCreatePresetMutation(
  params: SharedMutationParams & {
    readonly presetName: string;
    readonly onSaved: (presetId: string) => void;
  },
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const contractData = params.contractData;
      if (!contractData) {
        throw new Error("Launch contract is still loading.");
      }

      const trimmedPresetName = params.presetName.trim();
      if (!trimmedPresetName) {
        throw new Error("Preset name is required.");
      }

      const payloadResult = buildTriggerPayload({
        contractData,
        inputDrafts: params.inputDrafts,
        rawJsonEnabled: params.rawJsonEnabled,
        rawJsonDraft: params.rawJsonDraft,
        selectedProjectId: params.selectedProjectId,
        workItemId: params.workItemId,
      });

      if (!payloadResult.ok) {
        throw new Error(payloadResult.message);
      }

      return api.createWorkflowLaunchPreset(params.workflowId, {
        name: trimmedPresetName,
        project_id: params.selectedProjectId || undefined,
        trigger_data: payloadResult.payload,
      });
    },
    onSuccess: async (preset) => {
      params.onSaved(preset.id);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.workflows.launchContract(
          params.workflowId,
          params.contextQuery,
        ),
      });
    },
  });
}

export function useDeletePresetMutation(
  params: Pick<SharedMutationParams, "workflowId" | "contextQuery"> & {
    readonly selectedPresetId: string;
    readonly onDeleted: () => void;
  },
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!params.selectedPresetId) {
        throw new Error("Select a preset to delete.");
      }

      return api.deleteWorkflowLaunchPreset(
        params.workflowId,
        params.selectedPresetId,
      );
    },
    onSuccess: async () => {
      params.onDeleted();
      await queryClient.invalidateQueries({
        queryKey: queryKeys.workflows.launchContract(
          params.workflowId,
          params.contextQuery,
        ),
      });
    },
  });
}

export function useExecuteWorkflowMutation(
  params: SharedMutationParams & {
    readonly selectedPresetId: string;
    readonly fixedProjectId?: string;
    readonly defaultLaunchSource?: WorkflowLaunchSource;
    readonly onLaunched?: (runId: string | null) => void;
    readonly onCompleted: () => void;
  },
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const contractData = params.contractData;
      if (!contractData) {
        throw new Error("Launch contract is still loading.");
      }

      if (!contractData.eligibility.eligible) {
        throw new Error(getContextReasonMessage(contractData));
      }

      const payloadResult = buildTriggerPayload({
        contractData,
        inputDrafts: params.inputDrafts,
        rawJsonEnabled: params.rawJsonEnabled,
        rawJsonDraft: params.rawJsonDraft,
        selectedProjectId: params.selectedProjectId,
        workItemId: params.workItemId,
      });

      if (!payloadResult.ok) {
        throw new Error(payloadResult.message);
      }

      const request: ExecuteWorkflowRequest = {
        trigger_data: payloadResult.payload,
        project_id: params.selectedProjectId || undefined,
        work_item_id: params.workItemId.trim() || undefined,
        preset_id: params.selectedPresetId || undefined,
        launch_source:
          params.defaultLaunchSource ??
          (params.fixedProjectId ? "project_scoped" : "manual"),
      };

      if (params.fixedProjectId) {
        return api.executeProjectScopedWorkflow(
          params.fixedProjectId,
          params.workflowId,
          request,
        );
      }

      return api.executeWorkflow(params.workflowId, request);
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.workflowRuns.list(),
      });
      params.onLaunched?.(
        typeof result.runId === "string" ? result.runId : null,
      );
      params.onCompleted();
    },
  });
}

export function useWorkflowLaunchDialogActions(
  params: SharedMutationParams & {
    readonly selectedPresetId: string;
    readonly presetName: string;
    readonly fixedProjectId?: string;
    readonly defaultLaunchSource?: WorkflowLaunchSource;
    readonly onPresetSaved: (presetId: string) => void;
    readonly onPresetDeleted: () => void;
    readonly onLaunched?: (runId: string | null) => void;
    readonly onLaunchCompleted: () => void;
    readonly setFormError: (error: string | null) => void;
  },
) {
  const createPresetMutation = useCreatePresetMutation({
    ...params,
    presetName: params.presetName,
    onSaved: params.onPresetSaved,
  });

  const deletePresetMutation = useDeletePresetMutation({
    workflowId: params.workflowId,
    contextQuery: params.contextQuery,
    selectedPresetId: params.selectedPresetId,
    onDeleted: params.onPresetDeleted,
  });

  const executeMutation = useExecuteWorkflowMutation({
    ...params,
    selectedPresetId: params.selectedPresetId,
    fixedProjectId: params.fixedProjectId,
    defaultLaunchSource: params.defaultLaunchSource,
    onLaunched: params.onLaunched,
    onCompleted: params.onLaunchCompleted,
  });

  const handleLaunch = () => {
    params.setFormError(null);
    executeMutation.mutate(undefined, {
      onError: (error) => {
        params.setFormError(
          getApiErrorMessage(error, "Failed to launch workflow."),
        );
      },
    });
  };

  const handleSavePreset = () => {
    params.setFormError(null);
    createPresetMutation.mutate(undefined, {
      onError: (error) => {
        params.setFormError(
          getApiErrorMessage(error, "Failed to save preset."),
        );
      },
    });
  };

  const handleDeletePreset = () => {
    params.setFormError(null);
    deletePresetMutation.mutate(undefined, {
      onError: (error) => {
        params.setFormError(
          getApiErrorMessage(error, "Failed to delete preset."),
        );
      },
    });
  };

  return {
    createPresetMutation,
    deletePresetMutation,
    executeMutation,
    handleLaunch,
    handleSavePreset,
    handleDeletePreset,
  };
}
