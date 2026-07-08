import { WorkflowRunStatus } from "@/lib/api/common.types";
import { ProjectOrchestrationStatus } from "@/lib/api/projects.types";
import { WorkflowRun } from "@/lib/api/workflows.types";
import type {
  FallbackRunResolution,
  NoticeState,
} from "./OrchestrationTab.types";

export function statusAllowsPause(status: ProjectOrchestrationStatus): boolean {
  return (
    status === "initializing" ||
    status === "awaiting_approval" ||
    status === "bootstrapping" ||
    status === "orchestrating"
  );
}

export function extractTriggerContext(
  stateVariables: Record<string, unknown>,
): { projectId: string | null; orchestrationId: string | null } {
  const trigger = stateVariables.trigger;
  if (!trigger || typeof trigger !== "object") {
    return { projectId: null, orchestrationId: null };
  }

  const record = trigger as Record<string, unknown>;
  return {
    projectId: typeof record.projectId === "string" ? record.projectId : null,
    orchestrationId:
      typeof record.orchestrationId === "string"
        ? record.orchestrationId
        : null,
  };
}

export function getRunBadgeVariant(
  status: WorkflowRunStatus | "none" | "loading",
): "default" | "secondary" | "outline" | "destructive" {
  if (status === "FAILED") {
    return "destructive";
  }

  if (status === "RUNNING") {
    return "default";
  }

  if (status === "PENDING" || status === "loading") {
    return "secondary";
  }

  return "outline";
}

function sortRunsByMostRecent(runs: WorkflowRun[]): WorkflowRun[] {
  return [...runs].sort(
    (left, right) =>
      new Date(right.updated_at).getTime() -
      new Date(left.updated_at).getTime(),
  );
}

function pickRunningOrLatest(runs: WorkflowRun[]): WorkflowRun | null {
  return runs.find((run) => run.status === "RUNNING") ?? runs[0] ?? null;
}

export function resolveFallbackRun(params: {
  candidateRuns: WorkflowRun[];
  projectId: string;
  orchestrationId: string | null | undefined;
}): FallbackRunResolution {
  const projectRuns = params.candidateRuns.filter((run) => {
    const trigger = extractTriggerContext(run.state_variables);
    return trigger.projectId === params.projectId;
  });

  if (!params.orchestrationId) {
    const looseRuns = sortRunsByMostRecent(projectRuns);
    return {
      run: pickRunningOrLatest(looseRuns),
      matchType: looseRuns.length > 0 ? "project-only" : "none",
    };
  }

  const strictRuns = sortRunsByMostRecent(
    projectRuns.filter((run) => {
      const trigger = extractTriggerContext(run.state_variables);
      return trigger.orchestrationId === params.orchestrationId;
    }),
  );

  if (strictRuns.length > 0) {
    return {
      run: pickRunningOrLatest(strictRuns),
      matchType: "orchestration",
    };
  }

  // Avoid linking stale runs by project-only context when an orchestration
  // identity exists but no strict run match is currently linked.
  return {
    run: null,
    matchType: "none",
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unexpected error";
}

export async function runWithNotice(params: {
  runner: () => Promise<unknown>;
  setNotice: (notice: NoticeState) => void;
  successTitle: string;
  successMessage: string;
  errorTitle: string;
  onSuccess?: () => void;
}): Promise<void> {
  try {
    await params.runner();
    params.onSuccess?.();
    params.setNotice({
      type: "info",
      title: params.successTitle,
      message: params.successMessage,
    });
  } catch (error) {
    params.setNotice({
      type: "error",
      title: params.errorTitle,
      message: toErrorMessage(error),
    });
  }
}
