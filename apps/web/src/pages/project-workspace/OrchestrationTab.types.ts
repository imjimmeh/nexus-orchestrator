import { ProjectOrchestrationMode } from "@/lib/api/projects.types";
import { WorkflowRun } from "@/lib/api/workflows.types";

export type FallbackRunResolution = {
  run: WorkflowRun | null;
  matchType: "orchestration" | "project-only" | "none";
};

export type NoticeState = {
  type: "info" | "error";
  title: string;
  message: string;
};

export interface OrchestrationTabActions {
  handleAction: (
    runner: () => Promise<unknown>,
    successMessage: string,
  ) => Promise<void>;
  handleStart: () => void;
  handleModeChange: (nextMode: ProjectOrchestrationMode) => void;
  handleComplete: () => void;
  handleRecoverImportedHydration: () => void;
  isCompletePending: boolean;
}
