import { useState } from "react";
import {
  useDoctorReport,
  useDoctorRepairHistory,
  useExecuteDoctorRepair,
  useLifecycleResumeSummary,
} from "@/hooks/useOperationsDoctor";
import { useToast } from "@/hooks/useToast";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { DoctorRepairActionId } from "@/lib/api/doctor.types";
import { DEFAULT_ACTION_ARGUMENTS, parseActionArguments } from "./doctor.helpers";
import type { DoctorRepairDialogTarget } from "./useDoctorChecks.types";

const DEFAULT_HISTORY_LIMIT = 20;

interface UseDoctorChecksModel {
  resumeQuery: ReturnType<typeof useLifecycleResumeSummary>;
  reportQuery: ReturnType<typeof useDoctorReport>;
  historyQuery: ReturnType<typeof useDoctorRepairHistory>;
  repairPending: boolean;
  argumentsByAction: Record<DoctorRepairActionId, string>;
  setActionArguments: (actionId: DoctorRepairActionId, value: string) => void;
  historyLimit: number;
  historyOffset: number;
  setHistoryOffset: (offset: number) => void;
  onRunDryRepair: (actionId: DoctorRepairActionId, checkId: string) => void;
  onRunLiveRepair: (actionId: DoctorRepairActionId, checkId: string) => void;
  confirmLiveRepair: () => void;
  liveRepairTarget: DoctorRepairDialogTarget | null;
  setLiveRepairTarget: (target: DoctorRepairDialogTarget | null) => void;
}

export function useDoctorChecks(): UseDoctorChecksModel {
  const toast = useToast();
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyLimit] = useState(DEFAULT_HISTORY_LIMIT);
  const [argumentsByAction, setArgumentsByAction] = useState<
    Record<DoctorRepairActionId, string>
  >(DEFAULT_ACTION_ARGUMENTS);
  const [liveRepairTarget, setLiveRepairTarget] =
    useState<DoctorRepairDialogTarget | null>(null);

  const reportQuery = useDoctorReport();
  const resumeQuery = useLifecycleResumeSummary();
  const historyQuery = useDoctorRepairHistory({
    limit: historyLimit,
    offset: historyOffset,
  });
  const repairMutation = useExecuteDoctorRepair();

  const runRepairMutation = (
    actionId: DoctorRepairActionId,
    dryRun: boolean,
    confirm: boolean,
  ): boolean => {
    const parsed = parseActionArguments(argumentsByAction[actionId] ?? "{}");
    if (!parsed.ok) {
      toast.error("Invalid repair arguments", parsed.reason);
      return false;
    }

    repairMutation.mutate(
      {
        action_id: actionId,
        dry_run: dryRun,
        confirm,
        arguments: parsed.value,
      },
      {
        onSuccess: (result) => {
          toast.success("Doctor repair executed", result.message);
        },
        onError: (error) => {
          toast.error(
            "Doctor repair failed",
            getApiErrorMessage(error, "Unable to run doctor repair action."),
          );
        },
      },
    );

    return true;
  };

  const onRunDryRepair = (
    actionId: DoctorRepairActionId,
    _checkId: string,
  ): void => {
    runRepairMutation(actionId, true, false);
  };

  const onRunLiveRepair = (
    actionId: DoctorRepairActionId,
    checkId: string,
  ): void => {
    setLiveRepairTarget({ actionId, checkId });
  };

  const confirmLiveRepair = (): void => {
    if (!liveRepairTarget) {
      return;
    }

    const started = runRepairMutation(
      liveRepairTarget.actionId,
      false,
      true,
    );

    if (started) {
      setLiveRepairTarget(null);
    }
  };

  return {
    resumeQuery,
    reportQuery,
    historyQuery,
    repairPending: repairMutation.isPending,
    argumentsByAction,
    setActionArguments: (actionId, value) => {
      setArgumentsByAction((previous) => ({
        ...previous,
        [actionId]: value,
      }));
    },
    historyLimit,
    historyOffset,
    setHistoryOffset,
    onRunDryRepair,
    onRunLiveRepair,
    confirmLiveRepair,
    liveRepairTarget,
    setLiveRepairTarget,
  };
}
