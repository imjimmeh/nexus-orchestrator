import { useMemo } from "react";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { WorkItem } from "@/lib/api/work-items.types";
import { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import {
  getBashOutputChunks,
  getMergeConflictReason,
  getPendingQuestions,
  getTodoItems,
  isWorkflowRunPaused,
  toSessionChatMessages,
} from "./active-session.utils";

type WorkspaceEvent = {
  event_type: string;
  payload: Record<string, unknown>;
};

export function requireValue<T>(value: T | null | undefined, name: string): T {
  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function toLowerCaseText(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

export function readInitialUserMessageFromRunState(
  stateVariables: unknown,
): string | undefined {
  if (!stateVariables || typeof stateVariables !== "object") {
    return undefined;
  }

  const trigger = (stateVariables as { trigger?: unknown }).trigger;
  if (!trigger || typeof trigger !== "object") {
    return undefined;
  }

  const triggerRecord = trigger as {
    task_prompt?: unknown;
    taskPrompt?: unknown;
  };
  let candidate: string | undefined;
  if (typeof triggerRecord.task_prompt === "string") {
    candidate = triggerRecord.task_prompt;
  } else if (typeof triggerRecord.taskPrompt === "string") {
    candidate = triggerRecord.taskPrompt;
  }

  if (!candidate) {
    return undefined;
  }

  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function extractPhaseMarkers(events: WorkspaceEvent[]): string[] {
  const hasPlanning = events.some((event) => {
    const stepId = toLowerCaseText(event.payload.stepId);
    const eventType = event.event_type.toLowerCase();
    return (
      stepId.includes("plan") ||
      stepId.includes("spec") ||
      eventType.includes("orchestration") ||
      eventType.includes("project_state")
    );
  });

  const hasDelegation = events.some((event) => {
    const toolName = toLowerCaseText(event.payload.toolName);
    const eventType = event.event_type.toLowerCase();
    return (
      toolName === "spawn_subagent_async" ||
      toolName.includes("wait_for_subagents") ||
      eventType.includes("subagent")
    );
  });

  const hasImplementation = events.some((event) => {
    const toolName = toLowerCaseText(event.payload.toolName);
    const eventType = event.event_type.toLowerCase();
    const stepId = toLowerCaseText(event.payload.stepId);
    return (
      eventType === "bash_output" ||
      toolName.includes("write") ||
      toolName.includes("bash") ||
      stepId.includes("implement")
    );
  });

  const hasReviewHandoff = events.some((event) => {
    const stepId = toLowerCaseText(event.payload.stepId);
    const eventType = event.event_type.toLowerCase();
    return (
      stepId.includes("review") ||
      eventType.includes("qa") ||
      eventType.includes("merge")
    );
  });

  const phases: string[] = [];
  if (hasPlanning) phases.push("Planning");
  if (hasDelegation) phases.push("Delegation");
  if (hasImplementation) phases.push("Implementation");
  if (hasReviewHandoff) phases.push("Review Handoff");
  return phases;
}

export function isSubagentEvent(event: WorkspaceEvent): boolean {
  const payload = event.payload;
  const isLifecycleEvent =
    payload.domain === "subagent" ||
    event.event_type.startsWith("spawn.") ||
    event.event_type.startsWith("execution.");

  if (isLifecycleEvent) {
    return false;
  }

  return (
    typeof payload.subagentExecutionId === "string" ||
    (typeof payload.chatSessionId === "string" && payload.isSubagent === true)
  );
}

function resolveApiErrorMessage(
  error: unknown,
  fallbackMessage: string,
): string | null {
  if (!error) {
    return null;
  }

  return getApiErrorMessage(error, fallbackMessage);
}

export function resolveWorkspaceErrorMessages(params: {
  telemetryError: unknown;
  workspaceDiffError: unknown;
  workspaceTreeError: unknown;
  runTodoListError?: unknown;
}) {
  return {
    telemetryErrorMessage: resolveApiErrorMessage(
      params.telemetryError,
      "Live telemetry is unavailable. Falling back to event polling.",
    ),
    workspaceDiffErrorMessage: resolveApiErrorMessage(
      params.workspaceDiffError,
      "Workspace diff is unavailable for this run.",
    ),
    workspaceTreeErrorMessage: resolveApiErrorMessage(
      params.workspaceTreeError,
      "Workspace tree is unavailable for this run.",
    ),
    runTodoListErrorMessage: resolveApiErrorMessage(
      params.runTodoListError,
      "Run todo list is unavailable for this run.",
    ),
  };
}

function buildWorkspaceMeta(params: {
  workItemTitle: string | undefined;
  runId: string | undefined;
  projectId: string | undefined;
  workItemId: string | undefined;
  workItemStatus: string | undefined;
}): {
  isBlocked: boolean;
  sessionTitle: string;
  backPath: string;
} {
  const { workItemTitle, runId, projectId, workItemId, workItemStatus } =
    params;

  let defaultBackPath = "/sessions";
  if (projectId) {
    defaultBackPath = workItemId
      ? `/projects/${projectId}/board`
      : `/projects/${projectId}`;
  }

  return {
    isBlocked: workItemStatus === "blocked",
    sessionTitle:
      workItemTitle ||
      (runId ? `Run ${runId.slice(0, 8)}` : "Orchestration run"),
    backPath: defaultBackPath,
  };
}

function renderWorkspaceGuard(params: {
  projectId: string | undefined;
  workItemId: string | undefined;
  selectedWorkItem: { id: string } | null;
  runId: string | undefined;
}) {
  const { workItemId, selectedWorkItem, runId } = params;

  if (workItemId && !selectedWorkItem) {
    return (
      <p className="text-sm text-muted-foreground">
        Loading active session context...
      </p>
    );
  }

  if (!runId) {
    return (
      <p className="text-sm text-muted-foreground">
        No active run is linked to this session yet.
      </p>
    );
  }

  return null;
}

export function resolveArtifactsRunId(
  isChatSession: boolean,
  runId: string | undefined,
): string | undefined {
  return isChatSession ? undefined : runId;
}

export function resolveInitialUserMessage(params: {
  isChatSession: boolean;
  chatSessionInitialMessage: string | undefined;
  workflowRunStateVariables: unknown;
}): string | undefined {
  if (params.isChatSession) {
    return params.chatSessionInitialMessage;
  }

  return readInitialUserMessageFromRunState(params.workflowRunStateVariables);
}

export function resolveRunTerminalState(params: {
  isChatSession: boolean;
  chatSessionStatus: string | undefined;
  workflowRunStatus: string | undefined;
}): boolean {
  if (params.isChatSession) {
    return (
      params.chatSessionStatus === "COMPLETED" ||
      params.chatSessionStatus === "FAILED" ||
      params.chatSessionStatus === "CANCELLED"
    );
  }

  return (
    params.workflowRunStatus === "COMPLETED" ||
    params.workflowRunStatus === "FAILED" ||
    params.workflowRunStatus === "CANCELLED"
  );
}

export function resolveWorkspaceGuard(params: {
  isChatSession: boolean;
  projectId: string | undefined;
  workItemId: string | undefined;
  selectedWorkItem: { id: string } | null;
  runId: string | undefined;
}) {
  if (params.isChatSession) {
    return null;
  }

  return renderWorkspaceGuard({
    projectId: params.projectId,
    workItemId: params.workItemId,
    selectedWorkItem: params.selectedWorkItem,
    runId: params.runId,
  });
}

export function resolveWorkspaceMetaByMode(params: {
  isChatSession: boolean;
  chatSessionDisplayName: string | undefined;
  workItemTitle: string | undefined;
  chatSessionIdParam: string | undefined;
  runId: string | undefined;
  projectId: string | undefined;
  workItemId: string | undefined;
  workItemStatus: string | undefined;
}) {
  return buildWorkspaceMeta({
    workItemTitle: params.isChatSession
      ? params.chatSessionDisplayName
      : params.workItemTitle,
    runId: params.isChatSession ? params.chatSessionIdParam : params.runId,
    projectId: params.projectId,
    workItemId: params.workItemId,
    workItemStatus: params.workItemStatus,
  });
}

export function resolveContentRunId(params: {
  isChatSession: boolean;
  chatSessionIdParam: string | undefined;
  runId: string | undefined;
}): string | null {
  return params.isChatSession
    ? (params.chatSessionIdParam ?? null)
    : (params.runId ?? null);
}

export function useWorkspaceDerivedState(params: {
  isChatSession: boolean;
  chatSessionInitialMessage: string | undefined;
  workflowRunStateVariables: unknown;
  events: WorkflowTelemetryEvent[];
  chatSessionStatus: string | undefined;
  workflowRunStatus: string | undefined;
  workItem: WorkItem | null;
}) {
  const terminalChunks = useMemo(
    () => getBashOutputChunks(params.events),
    [params.events],
  );
  const initialUserMessage = useMemo(
    () =>
      resolveInitialUserMessage({
        isChatSession: params.isChatSession,
        chatSessionInitialMessage: params.chatSessionInitialMessage,
        workflowRunStateVariables: params.workflowRunStateVariables,
      }),
    [
      params.isChatSession,
      params.chatSessionInitialMessage,
      params.workflowRunStateVariables,
    ],
  );
  const chatMessages = useMemo(
    () => toSessionChatMessages(params.events, { initialUserMessage }),
    [params.events, initialUserMessage],
  );
  const isRunPaused = useMemo(
    () => isWorkflowRunPaused(params.events),
    [params.events],
  );
  const isRunTerminal = resolveRunTerminalState({
    isChatSession: params.isChatSession,
    chatSessionStatus: params.chatSessionStatus,
    workflowRunStatus: params.workflowRunStatus,
  });
  const pendingQuestions = useMemo(
    () => getPendingQuestions(params.events),
    [params.events],
  );
  const phaseMarkers = useMemo(
    () => extractPhaseMarkers(params.events),
    [params.events],
  );
  const mergeConflictReason = useMemo(
    () => getMergeConflictReason(params.workItem),
    [params.workItem],
  );
  const agentTodos = useMemo(
    () => getTodoItems(params.events),
    [params.events],
  );

  return {
    terminalChunks,
    chatMessages,
    isRunPaused,
    isRunTerminal,
    pendingQuestions,
    phaseMarkers,
    mergeConflictReason,
    agentTodos,
  };
}
