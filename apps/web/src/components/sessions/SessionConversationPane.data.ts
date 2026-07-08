import { useWorkflowRun } from "@/hooks/useWorkflows";
import { useChatSession } from "@/hooks/useChatSessions";
import { useChatSessionTelemetry } from "@/hooks/useChatSessionTelemetry";
import { useWorkflowRunTelemetry } from "@/hooks/useWorkflowRunTelemetry";
import { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import { useWorkspaceDerivedState } from "@/pages/active-session/active-session.workspace.helpers";
import { useWorkspaceArtifacts } from "@/pages/active-session/ActiveSessionWorkspace.actions";
import {
  isRateLimitRetry,
  isTerminalStatus,
  resolvePaneTitle,
} from "./sessionConversationPane.helpers";
import { buildWorkflowRunRuntimeNotice } from "./workflowRunPresentation.helpers";
import { resolveTriggerField } from "./triggerField.helpers";

interface SessionConversationPaneDataParams {
  threadId: string;
  kind: "chat" | "workflow" | "subagent";
}

function resolveKindFlags(kind: SessionConversationPaneDataParams["kind"]) {
  return {
    isChatSession: kind === "chat" || kind === "subagent",
    isWorkflowRun: kind === "workflow",
  };
}

function resolveChatThreadId(
  isChatSession: boolean,
  threadId: string,
): string | undefined {
  if (!isChatSession) {
    return undefined;
  }

  return threadId;
}

function resolveWorkflowThreadId(
  isWorkflowRun: boolean,
  threadId: string,
): string {
  if (!isWorkflowRun) {
    return "";
  }

  return threadId;
}

function resolveWorkflowThreadIdOrUndefined(
  isWorkflowRun: boolean,
  threadId: string,
): string | undefined {
  if (!isWorkflowRun) {
    return undefined;
  }

  return threadId;
}

function resolveWorkflowName(params: {
  displayName: string | undefined;
  workflowName: string | null | undefined;
  workflowRunStateVariables: Record<string, unknown> | undefined;
}): string | undefined {
  if (params.displayName) {
    return params.displayName;
  }

  const trigger = params.workflowRunStateVariables?.trigger;
  const triggerDisplayName = resolveTriggerField(
    typeof trigger === "object" && trigger !== null
      ? (trigger as Record<string, unknown>)
      : undefined,
    ["displayName", "display_name", "workflowName", "workflow_name"],
  );
  if (triggerDisplayName) {
    return triggerDisplayName;
  }

  return params.workflowName ?? undefined;
}

function selectTelemetry(params: {
  isChatSession: boolean;
  chatTelemetry: {
    events: WorkflowTelemetryEvent[];
    connectionState: string;
  };
  workflowTelemetry: {
    events: WorkflowTelemetryEvent[];
    connectionState: string;
  };
}) {
  if (params.isChatSession) {
    return params.chatTelemetry;
  }

  return params.workflowTelemetry;
}

function isSubagentPayloadEvent(event: WorkflowTelemetryEvent): boolean {
  const payload = event.payload;
  return (
    payload.isSubagent === true ||
    typeof payload.subagentExecutionId === "string"
  );
}

function filterTelemetryEvents(params: {
  isChatSession: boolean;
  events: WorkflowTelemetryEvent[];
}) {
  if (!params.isChatSession) {
    return params.events.filter((event) => !isSubagentPayloadEvent(event));
  }

  return params.events;
}

function resolveStatus(params: {
  isChatSession: boolean;
  chatStatus: string | undefined;
  workflowStatus: string | undefined;
}): string | undefined {
  return params.isChatSession ? params.chatStatus : params.workflowStatus;
}

function resolveIsWaitingOnRateLimit(params: {
  isChatSession: boolean;
  chatSessionData:
    | {
        executionState?: string;
        retryMetadata?: { reasonCode?: string } | null;
      }
    | undefined;
}) {
  if (!params.isChatSession || !params.chatSessionData) {
    return false;
  }

  return isRateLimitRetry(params.chatSessionData);
}

function resolveIsLoading(params: {
  isChatSession: boolean;
  chatSessionLoading: boolean;
  chatTelemetryLoading: boolean;
  workflowRunLoading: boolean;
  workflowTelemetryLoading: boolean;
}) {
  if (params.isChatSession) {
    return params.chatSessionLoading || params.chatTelemetryLoading;
  }

  return params.workflowRunLoading || params.workflowTelemetryLoading;
}

function resolveProjectId(params: {
  isChatSession: boolean;
  projectId: string | null | undefined;
}): string | undefined {
  if (!params.isChatSession) {
    return undefined;
  }

  return params.projectId ?? undefined;
}

function resolveCanAbortWorkflowRun(params: {
  isWorkflowRun: boolean;
  isTerminal: boolean;
}): boolean {
  return params.isWorkflowRun && !params.isTerminal;
}

function resolveWorkflowRunStateVariables(
  stateVariables: unknown,
): Record<string, unknown> | undefined {
  if (!stateVariables || typeof stateVariables !== "object") {
    return undefined;
  }

  return stateVariables as Record<string, unknown>;
}

interface DerivedPaneDataParams {
  threadId: string;
  isChatSession: boolean;
  isWorkflowRun: boolean;
  chatSession: ReturnType<typeof useChatSession>;
  chatTelemetry: ReturnType<typeof useChatSessionTelemetry>;
  workflowRun: ReturnType<typeof useWorkflowRun>;
  workflowTelemetry: ReturnType<typeof useWorkflowRunTelemetry>;
  chatMessages: any;
  agentTodos: any;
  pendingQuestions: any;
  filteredTelemetryEvents: WorkflowTelemetryEvent[];
  connectionState: string;
}

function resolveDerivedPaneData({
  threadId,
  isChatSession,
  isWorkflowRun,
  chatSession,
  chatTelemetry,
  workflowRun,
  workflowTelemetry,
  chatMessages,
  agentTodos,
  pendingQuestions,
  filteredTelemetryEvents,
  connectionState,
}: DerivedPaneDataParams) {
  const chatSessionData = chatSession.data;
  const workflowRunData = workflowRun.data;

  const workflowRunStateVariables = resolveWorkflowRunStateVariables(
    workflowRunData?.state_variables,
  );

  const workflowName = resolveWorkflowName({
    displayName: workflowRunData?.display_name,
    workflowName: workflowRunData?.workflow_name,
    workflowRunStateVariables,
  });

  const title = resolvePaneTitle(
    isChatSession,
    chatSessionData?.displayName,
    workflowName,
    workflowRunData?.id,
  );

  const status = resolveStatus({
    isChatSession,
    chatStatus: chatSessionData?.status,
    workflowStatus: workflowRunData?.status,
  });
  const isTerminal = isTerminalStatus(status);
  const canAbortWorkflowRun = resolveCanAbortWorkflowRun({
    isWorkflowRun,
    isTerminal,
  });
  const isWaitingOnRateLimit = resolveIsWaitingOnRateLimit({
    isChatSession,
    chatSessionData,
  });
  const runtimeNotice = isWorkflowRun
    ? buildWorkflowRunRuntimeNotice({
        workflowRun: workflowRunData,
        events: filteredTelemetryEvents,
      })
    : null;
  const isWaitingOnRetry = runtimeNotice?.isWaitingOnRetry === true;

  const isLoading = resolveIsLoading({
    isChatSession,
    chatSessionLoading: chatSession.isLoading,
    chatTelemetryLoading: chatTelemetry.isLoading,
    workflowRunLoading: workflowRun.isLoading,
    workflowTelemetryLoading: workflowTelemetry.isLoading,
  });

  return {
    threadId,
    isChatSession,
    isWorkflowRun,
    chatSession,
    chatTelemetry,
    workflowRun,
    workflowTelemetry,
    connectionState,
    chatMessages,
    agentTodos,
    pendingQuestions,
    projectId: resolveProjectId({
      isChatSession,
      projectId: chatSessionData?.projectId,
    }),
    workflowName,
    title,
    status,
    isTerminal,
    canAbortWorkflowRun,
    isWaitingOnRateLimit,
    isWaitingOnRetry,
    runtimeNotice,
    retryMetadata: chatSessionData?.retryMetadata,
    isLoading,
  };
}

export function useSessionConversationPaneData({
  threadId,
  kind,
}: Readonly<SessionConversationPaneDataParams>) {
  const { isChatSession, isWorkflowRun } = resolveKindFlags(kind);
  const chatThreadId = resolveChatThreadId(isChatSession, threadId);
  const workflowThreadId = resolveWorkflowThreadId(isWorkflowRun, threadId);
  const workflowThreadIdOrUndefined = resolveWorkflowThreadIdOrUndefined(
    isWorkflowRun,
    threadId,
  );

  const chatSession = useChatSession(chatThreadId);
  const chatTelemetry = useChatSessionTelemetry(chatThreadId);

  const workflowRun = useWorkflowRun(workflowThreadId);
  const workflowTelemetry = useWorkflowRunTelemetry(
    workflowThreadIdOrUndefined,
  );

  useWorkspaceArtifacts(workflowThreadIdOrUndefined);

  const { events: telemetryEvents, connectionState } = selectTelemetry({
    isChatSession,
    chatTelemetry: {
      events: chatTelemetry.events as WorkflowTelemetryEvent[],
      connectionState: chatTelemetry.connectionState,
    },
    workflowTelemetry: {
      events: workflowTelemetry.events as WorkflowTelemetryEvent[],
      connectionState: workflowTelemetry.connectionState,
    },
  });

  const filteredTelemetryEvents = filterTelemetryEvents({
    isChatSession,
    events: telemetryEvents,
  });

  const { chatMessages, agentTodos, pendingQuestions } =
    useWorkspaceDerivedState({
      isChatSession,
      chatSessionInitialMessage: chatSession.data?.initialMessage,
      workflowRunStateVariables: workflowRun.data?.state_variables,
      events: filteredTelemetryEvents,
      chatSessionStatus: chatSession.data?.status,
      workflowRunStatus: workflowRun.data?.status,
      workItem: null,
    });

  return resolveDerivedPaneData({
    threadId,
    isChatSession,
    isWorkflowRun,
    chatSession,
    chatTelemetry,
    workflowRun,
    workflowTelemetry,
    chatMessages,
    agentTodos,
    pendingQuestions,
    filteredTelemetryEvents,
    connectionState,
  });
}
