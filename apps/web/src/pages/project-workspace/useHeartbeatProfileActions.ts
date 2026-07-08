import { useCallback } from "react";
import {
  useCreateHeartbeatProfile,
  useDeleteHeartbeatProfile,
  useRunHeartbeatProfileNow,
  useUpdateHeartbeatProfile,
} from "@/hooks/useAutomationControls";
import { useToast } from "@/hooks/useToast";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { parseSchedulePayloadJson } from "./SchedulesTab.helpers";
import type {
  UseHeartbeatProfileActionsParams,
  UseHeartbeatProfileActionsResult,
} from "./useHeartbeatProfileActions.types";

function useHeartbeatProfileSubmit(
  form: UseHeartbeatProfileActionsParams["form"],
  resetForm: () => void,
  createProfile: ReturnType<typeof useCreateHeartbeatProfile>,
  toast: ReturnType<typeof useToast>,
): () => Promise<void> {
  return useCallback(async () => {
    const parsedInterval = Number.parseInt(form.intervalSecondsText, 10);
    if (!Number.isFinite(parsedInterval) || parsedInterval < 10) {
      toast.error(
        "Invalid interval",
        "Interval must be an integer of at least 10 seconds.",
      );
      return;
    }

    if (!form.workflowId) {
      toast.error(
        "Workflow required",
        "Select a workflow for heartbeat checks.",
      );
      return;
    }

    let payloadJson: Record<string, unknown> | undefined;
    try {
      payloadJson = parseSchedulePayloadJson(form.payloadText);
    } catch (error) {
      toast.error(
        "Invalid payload JSON",
        getApiErrorMessage(error, "Heartbeat payload must be an object."),
      );
      return;
    }

    if (!form.name.trim()) {
      toast.error("Name required", "Heartbeat profile name is required.");
      return;
    }

    try {
      await createProfile.mutateAsync({
        name: form.name.trim(),
        enabled: form.enabled,
        interval_seconds: parsedInterval,
        workflow_id: form.workflowId,
        payload_json: payloadJson,
      });
      toast.success(
        "Heartbeat profile created",
        "Periodic checks are configured.",
      );
      resetForm();
    } catch (error) {
      toast.error(
        "Failed to create heartbeat profile",
        getApiErrorMessage(error, "Unable to save heartbeat profile."),
      );
    }
  }, [form, resetForm, toast, createProfile]);
}

function useToggleHeartbeatProfile(
  updateProfile: ReturnType<typeof useUpdateHeartbeatProfile>,
  toast: ReturnType<typeof useToast>,
) {
  return useCallback(
    async (profile: Parameters<UseHeartbeatProfileActionsResult["handleToggleEnabled"]>[0]) => {
      try {
        await updateProfile.mutateAsync({
          id: profile.id,
          data: { enabled: !profile.enabled },
        });
        toast.info(
          profile.enabled ? "Heartbeat paused" : "Heartbeat resumed",
          profile.enabled
            ? "This heartbeat profile will stop polling."
            : "This heartbeat profile is now active.",
        );
      } catch (error) {
        toast.error(
          "Failed to update heartbeat profile",
          getApiErrorMessage(error, "Unable to update heartbeat profile."),
        );
      }
    },
    [updateProfile, toast],
  );
}

function useRunHeartbeatNow(
  runNowProfile: ReturnType<typeof useRunHeartbeatProfileNow>,
  toast: ReturnType<typeof useToast>,
  onAfterRunNow: (profileId: string) => void,
) {
  return useCallback(
    async (profileId: string): Promise<void> => {
      try {
        await runNowProfile.mutateAsync(profileId);
        onAfterRunNow(profileId);
        toast.success("Heartbeat triggered", "Heartbeat run has been queued.");
      } catch (error) {
        toast.error(
          "Failed to run heartbeat",
          getApiErrorMessage(error, "Unable to trigger heartbeat run."),
        );
      }
    },
    [runNowProfile, toast, onAfterRunNow],
  );
}

function useDeleteHeartbeatProfileAction(
  deleteProfile: ReturnType<typeof useDeleteHeartbeatProfile>,
  toast: ReturnType<typeof useToast>,
  onAfterDelete: (deletedProfileId: string) => void,
) {
  return useCallback(
    async (profileId: string): Promise<void> => {
      try {
        await deleteProfile.mutateAsync(profileId);
        toast.info("Heartbeat profile deleted", "Profile removed.");
        onAfterDelete(profileId);
      } catch (error) {
        toast.error(
          "Failed to delete heartbeat profile",
          getApiErrorMessage(error, "Unable to delete heartbeat profile."),
        );
      }
    },
    [deleteProfile, toast, onAfterDelete],
  );
}

export function useHeartbeatProfileActions({
  projectId,
  form,
  resetForm,
  onAfterRunNow,
  onAfterDelete,
}: Readonly<UseHeartbeatProfileActionsParams>): UseHeartbeatProfileActionsResult {
  const toast = useToast();
  const createProfile = useCreateHeartbeatProfile(projectId);
  const updateProfile = useUpdateHeartbeatProfile(projectId);
  const runNowProfile = useRunHeartbeatProfileNow(projectId);
  const deleteProfile = useDeleteHeartbeatProfile(projectId);

  const handleCreate = useHeartbeatProfileSubmit(
    form,
    resetForm,
    createProfile,
    toast,
  );
  const handleToggleEnabled = useToggleHeartbeatProfile(updateProfile, toast);
  const handleRunNow = useRunHeartbeatNow(
    runNowProfile,
    toast,
    onAfterRunNow,
  );
  const handleDelete = useDeleteHeartbeatProfileAction(
    deleteProfile,
    toast,
    onAfterDelete,
  );

  return {
    createPending: createProfile.isPending,
    updatePending: updateProfile.isPending,
    runNowPending: runNowProfile.isPending,
    deletePending: deleteProfile.isPending,
    handleCreate,
    handleToggleEnabled,
    handleRunNow,
    handleDelete,
  };
}
