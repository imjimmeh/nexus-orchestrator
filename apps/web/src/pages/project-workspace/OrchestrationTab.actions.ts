import { useState } from "react";
import { ProjectOrchestrationMode } from "@/lib/api/projects.types";
import { useToast } from "@/hooks/useToast";
import { runWithNotice } from "./OrchestrationTab.helpers";
import type {
  NoticeState,
  OrchestrationTabActions,
} from "./OrchestrationTab.types";

function buildCompletionReadinessMessage(
  readiness:
    | {
        blocking_reasons: Array<{ code: string; message: string }>;
      }
    | null
    | undefined,
): string {
  if (!readiness || readiness.blocking_reasons.length === 0) {
    return "Completion is currently blocked by orchestration guardrails.";
  }

  const reasonSummary = readiness.blocking_reasons
    .slice(0, 4)
    .map((reason) => `${reason.code}: ${reason.message}`)
    .join(" | ");

  return `Completion blocked: ${reasonSummary}`;
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unexpected error";
}

interface OrchestrationTabActionsState {
  goalsSummary: string;
  mode: ProjectOrchestrationMode;
  setNotice: (notice: NoticeState) => void;
  setStartDialogOpen: (open: boolean) => void;
  startMutation: {
    mutateAsync: (params: {
      goals?: string;
      orchestrationMode: ProjectOrchestrationMode;
    }) => Promise<unknown>;
  };
  updateModeMutation: {
    mutateAsync: (mode: ProjectOrchestrationMode) => Promise<unknown>;
  };
  refetchDiagnostics: () => Promise<{
    data?: {
      completion_readiness?: {
        ok: boolean;
        blocking_reasons: Array<{ code: string; message: string }>;
      } | null;
    };
  }>;
  completeMutation: {
    mutateAsync: () => Promise<unknown>;
  };
  recoverImportedHydrationMutation: {
    mutateAsync: () => Promise<unknown>;
  };
}

export function useOrchestrationTabActions(
  state: OrchestrationTabActionsState,
): OrchestrationTabActions {
  const appToast = useToast();
  const [isCompletePending, setIsCompletePending] = useState(false);

  const handleAction = (
    runner: () => Promise<unknown>,
    successMessage: string,
  ) =>
    runWithNotice({
      runner,
      setNotice: state.setNotice,
      successTitle: "Action Applied",
      successMessage,
      errorTitle: "Action Failed",
    });

  const handleStart = () => {
    const trimmedGoals = state.goalsSummary.trim();
    void runWithNotice({
      runner: () =>
        state.startMutation.mutateAsync({
          goals: trimmedGoals.length > 0 ? trimmedGoals : undefined,
          orchestrationMode: state.mode,
        }),
      setNotice: state.setNotice,
      successTitle: "Orchestration Started",
      successMessage: "Project orchestration has been started.",
      errorTitle: "Start Failed",
      onSuccess: () => {
        state.setStartDialogOpen(false);
      },
    });
  };

  const handleModeChange = (nextMode: ProjectOrchestrationMode) => {
    void handleAction(
      () => state.updateModeMutation.mutateAsync(nextMode),
      `Mode updated to ${nextMode}.`,
    );
  };

  const handleComplete = () => {
    setIsCompletePending(true);
    void (async () => {
      try {
        const diagnosticsResult = await state.refetchDiagnostics();
        const readiness = diagnosticsResult.data?.completion_readiness ?? null;
        if (readiness && !readiness.ok) {
          throw new Error(buildCompletionReadinessMessage(readiness));
        }
        await state.completeMutation.mutateAsync();
        appToast.success(
          "Action Applied",
          "Orchestration marked as completed.",
        );
      } catch (error) {
        appToast.error("Action Failed", toErrorMessage(error));
      } finally {
        setIsCompletePending(false);
      }
    })();
  };

  const handleRecoverImportedHydration = () => {
    void runWithNotice({
      runner: () => state.recoverImportedHydrationMutation.mutateAsync(),
      setNotice: state.setNotice,
      successTitle: "Recovery Started",
      successMessage:
        "Imported repository hydration recovery has been started.",
      errorTitle: "Recovery Failed",
    });
  };

  return {
    handleAction,
    handleStart,
    handleModeChange,
    handleComplete,
    handleRecoverImportedHydration,
    isCompletePending,
  };
}
