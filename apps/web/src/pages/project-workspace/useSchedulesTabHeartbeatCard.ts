import { useCallback, useState } from "react";
import {
  useHeartbeatProfiles,
  useHeartbeatRuns,
} from "@/hooks/useAutomationControls";
import { useHeartbeatProfileActions } from "./useHeartbeatProfileActions";
import { useHeartbeatProfileForm } from "./useHeartbeatProfileForm";
import type {
  UseSchedulesTabHeartbeatCardParams,
  UseSchedulesTabHeartbeatCardResult,
} from "./useSchedulesTabHeartbeatCard.types";

export type {
  HeartbeatFormSetters,
  UseSchedulesTabHeartbeatCardParams,
  UseSchedulesTabHeartbeatCardResult,
} from "./useSchedulesTabHeartbeatCard.types";

export function useSchedulesTabHeartbeatCard({
  projectId,
  workflows,
}: Readonly<UseSchedulesTabHeartbeatCardParams>): UseSchedulesTabHeartbeatCardResult {
  const profilesQuery = useHeartbeatProfiles(projectId);
  const [selectedRunsProfileId, setSelectedRunsProfileIdState] =
    useState<string | null>(null);
  const runsQuery = useHeartbeatRuns(selectedRunsProfileId ?? undefined);
  const { form, setters, resetForm } = useHeartbeatProfileForm({ workflows });

  const toggleSelectedRunsProfileId = useCallback((profileId: string) => {
    setSelectedRunsProfileIdState((current) =>
      current === profileId ? null : profileId,
    );
  }, []);

  const onAfterRunNow = useCallback((profileId: string) => {
    setSelectedRunsProfileIdState(profileId);
  }, []);

  const onAfterDelete = useCallback((deletedProfileId: string) => {
    setSelectedRunsProfileIdState((current) =>
      current === deletedProfileId ? null : current,
    );
  }, []);

  const actions = useHeartbeatProfileActions({
    projectId,
    form,
    resetForm,
    onAfterRunNow,
    onAfterDelete,
  });

  return {
    form,
    formSetters: setters,
    selectedRunsProfileId,
    toggleSelectedRunsProfileId,
    profiles: profilesQuery.data?.items ?? [],
    profilesLoading: profilesQuery.isLoading,
    runsLoading: runsQuery.isLoading,
    runs: runsQuery.data?.items ?? [],
    createPending: actions.createPending,
    updatePending: actions.updatePending,
    runNowPending: actions.runNowPending,
    deletePending: actions.deletePending,
    handleCreate: actions.handleCreate,
    handleToggleEnabled: actions.handleToggleEnabled,
    handleRunNow: actions.handleRunNow,
    handleDelete: actions.handleDelete,
  };
}
