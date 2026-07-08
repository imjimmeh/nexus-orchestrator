import { ProjectOrchestrationDecisionEntry, ProjectOrchestrationStatus } from "@/lib/api/projects.types";
import { WorkItem } from "@/lib/api/work-items.types";
import { WorkflowRun, WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import type { OrchestrationNotification } from "@/components/notifications/OrchestrationNotificationFeed";
import { getPendingQuestions } from "@/pages/active-session/active-session.utils";
import { addWarRoomNotifications } from "./OrchestrationTab.notifications.war-room";

const RUN_PENDING_EVENT_TYPES = new Set(["workflow.started", "job.queued"]);
const WAITING_SIGNAL_MS = 90_000;
const AGENT_MESH_EVENT_TYPES = new Set([
  "agent_mention_requested",
  "agent_mention_received",
  "agent_mention_responded",
  "agent_mention_timeout",
  "agent_thread_resolved",
  "agent_mention_denied",
]);

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function firstString(
  payload: Record<string, unknown>,
  fields: string[],
): string {
  for (const field of fields) {
    const value = asString(payload[field]);
    if (value) {
      return value;
    }
  }

  return "";
}

function decisionCategory(type: string): OrchestrationNotification["category"] {
  const normalizedType = type.toLowerCase();

  if (
    normalizedType.includes("war_room") ||
    normalizedType.includes("war room")
  ) {
    return "war_room";
  }

  if (
    normalizedType.includes("mesh") ||
    normalizedType.includes("mention") ||
    normalizedType.includes("thread")
  ) {
    return "agent_mesh";
  }

  if (normalizedType.includes("dispatch")) {
    return "dispatch";
  }

  if (normalizedType.includes("subagent")) {
    return "subagent";
  }

  if (
    normalizedType.includes("review") ||
    normalizedType.includes("approval")
  ) {
    return "review";
  }

  return "lifecycle";
}

function decisionSeverity(
  decision: ProjectOrchestrationDecisionEntry,
  category: OrchestrationNotification["category"],
): OrchestrationNotification["severity"] {
  if (decision.executionStatus === "denied") {
    return "warning";
  }

  return category === "review" ? "warning" : "info";
}

function decisionMessage(decision: ProjectOrchestrationDecisionEntry): string {
  return decision.recommendation
    ? `${decision.reasoning}\nRecommendation: ${decision.recommendation}`
    : decision.reasoning;
}

function decisionNotification(
  decision: ProjectOrchestrationDecisionEntry,
): OrchestrationNotification {
  if (
    decision.type === "action_deduped_existing_run" &&
    decision.requestedAction === "invoke_agent_workflow"
  ) {
    return {
      id: `decision-${decision.timestamp}-${decision.type}`,
      category: "lifecycle",
      title: "Invoke Agent Deduped",
      message: decisionMessage(decision),
      timestamp: decision.timestamp,
      severity: "info",
    };
  }

  const category = decisionCategory(decision.type);

  return {
    id: `decision-${decision.timestamp}-${decision.type}`,
    category,
    title: `Decision: ${decision.type}`,
    message: decisionMessage(decision),
    timestamp: decision.timestamp,
    severity: decisionSeverity(decision, category),
  };
}

function addWorkflowRunNotifications(params: {
  notifications: OrchestrationNotification[];
  workflowRun: WorkflowRun;
  latestEvent?: WorkflowTelemetryEvent;
}): void {
  const { notifications, workflowRun, latestEvent } = params;

  notifications.push({
    id: `run-status-${workflowRun.id}`,
    category: "lifecycle",
    title: "Workflow Run Visibility",
    message: `Run ${workflowRun.id} is ${workflowRun.status} (step: ${workflowRun.current_step_id ?? "n/a"}).`,
    timestamp: workflowRun.updated_at,
    severity: workflowRun.status === "FAILED" ? "error" : "info",
  });

  if (!latestEvent) {
    return;
  }

  notifications.push({
    id: `latest-event-${workflowRun.id}`,
    category: "lifecycle",
    title: "Latest Workflow Event",
    message: `${latestEvent.event_type} at ${new Date(latestEvent.timestamp).toLocaleString()}`,
    timestamp: latestEvent.timestamp,
    severity: "info",
  });

  const latestEventAgeMs =
    Date.now() - new Date(latestEvent.timestamp).getTime();
  if (
    workflowRun.status === "RUNNING" &&
    RUN_PENDING_EVENT_TYPES.has(latestEvent.event_type) &&
    latestEventAgeMs > WAITING_SIGNAL_MS
  ) {
    notifications.push({
      id: `possible-waiting-${workflowRun.id}`,
      category: "lifecycle",
      title: "Run Waiting For Input",
      message:
        "No progress event has arrived recently. Discovery may be waiting for user responses.",
      timestamp: new Date().toISOString(),
      severity: "warning",
    });
  }
}

function addPendingQuestionNotification(params: {
  notifications: OrchestrationNotification[];
  workflowEvents: WorkflowTelemetryEvent[];
}): void {
  const pendingQuestions = getPendingQuestions(params.workflowEvents);
  if (!pendingQuestions || pendingQuestions.length === 0) {
    return;
  }

  const condensedQuestions = pendingQuestions
    .map((question, index) => `Q${index + 1}: ${question.question}`)
    .join("\n");

  params.notifications.push({
    id: "run-awaiting-user-input",
    category: "review",
    title: "Agent Requested Input",
    message: condensedQuestions,
    timestamp: new Date().toISOString(),
    severity: "warning",
  });
}

function getMeshEventMessage(event: WorkflowTelemetryEvent): string {
  const threadId = firstString(event.payload, ["thread_id", "threadId"]);
  const targetProfile = firstString(event.payload, [
    "target_profile",
    "target_agent_profile",
    "targetProfile",
    "recipient_profile",
  ]);
  const resolutionNote = firstString(event.payload, [
    "resolution_note",
    "resolutionNote",
    "note",
  ]);
  const denialReason = firstString(event.payload, [
    "reason",
    "denial_reason",
    "denialReason",
    "message",
  ]);
  const threadSuffix = threadId ? ` (thread: ${threadId})` : "";

  if (event.event_type === "agent_mention_requested") {
    const targetSuffix = targetProfile ? ` for ${targetProfile}` : "";
    return `Mention requested${targetSuffix}${threadSuffix}.`;
  }

  if (event.event_type === "agent_mention_received") {
    return `Mention request received${threadSuffix}.`;
  }

  if (event.event_type === "agent_mention_responded") {
    return `Mention response received${threadSuffix}.`;
  }

  if (event.event_type === "agent_mention_timeout") {
    return `Mention request timed out${threadSuffix}.`;
  }

  if (event.event_type === "agent_thread_resolved") {
    return resolutionNote
      ? `Thread resolved${threadSuffix}: ${resolutionNote}`
      : `Thread resolved${threadSuffix}.`;
  }

  if (event.event_type === "agent_mention_denied") {
    return denialReason
      ? `Mention request denied${threadSuffix}: ${denialReason}`
      : `Mention request denied${threadSuffix}.`;
  }

  return event.event_type;
}

function getMeshEventTitle(eventType: string): string {
  if (eventType === "agent_mention_requested") {
    return "Agent Mention Requested";
  }
  if (eventType === "agent_mention_received") {
    return "Agent Mention Received";
  }
  if (eventType === "agent_mention_responded") {
    return "Agent Mention Responded";
  }
  if (eventType === "agent_mention_timeout") {
    return "Agent Mention Timed Out";
  }
  if (eventType === "agent_thread_resolved") {
    return "Agent Thread Resolved";
  }
  if (eventType === "agent_mention_denied") {
    return "Agent Mention Denied";
  }

  return "Agent Mesh Event";
}

function addAgentMeshNotifications(params: {
  notifications: OrchestrationNotification[];
  workflowEvents: WorkflowTelemetryEvent[];
}): void {
  const { notifications, workflowEvents } = params;
  for (const [index, event] of workflowEvents.entries()) {
    if (!AGENT_MESH_EVENT_TYPES.has(event.event_type)) {
      continue;
    }

    notifications.push({
      id: `mesh-${event.timestamp}-${event.event_type}-${index}`,
      category: "agent_mesh",
      title: getMeshEventTitle(event.event_type),
      message: getMeshEventMessage(event),
      timestamp: event.timestamp,
      severity:
        event.event_type === "agent_mention_timeout" ||
        event.event_type === "agent_mention_denied"
          ? "warning"
          : "info",
    });
  }
}

export function buildOrchestrationNotifications(items: {
  status: ProjectOrchestrationStatus;
  revisionFeedback: string | null;
  decisionLog: ProjectOrchestrationDecisionEntry[];
  workItems: WorkItem[];
  workflowRun?: WorkflowRun | null;
  workflowEvents?: WorkflowTelemetryEvent[];
}): OrchestrationNotification[] {
  const notifications: OrchestrationNotification[] = [];
  const workflowEvents = items.workflowEvents ?? [];
  const latestEvent = [...workflowEvents].sort(
    (left, right) =>
      new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime(),
  )[0];

  notifications.push({
    id: `status-${items.status}`,
    category: "lifecycle",
    title: "Orchestration Status",
    message: `Project orchestration is currently ${items.status}.`,
    timestamp: new Date().toISOString(),
    severity: items.status === "failed" ? "error" : "info",
  });

  if (items.workflowRun) {
    addWorkflowRunNotifications({
      notifications,
      workflowRun: items.workflowRun,
      latestEvent,
    });
  }

  if (items.status === "awaiting_approval") {
    notifications.push({
      id: "specs-awaiting-approval",
      category: "review",
      title: "Specs Ready For Approval",
      message:
        "PRD and SDD are ready. Check the Pending Action Requests section below to review and approve.",
      timestamp: new Date().toISOString(),
      severity: "warning",
    });
  }

  addPendingQuestionNotification({ notifications, workflowEvents });
  addAgentMeshNotifications({ notifications, workflowEvents });
  addWarRoomNotifications({ notifications, workflowEvents });

  if (items.revisionFeedback) {
    notifications.push({
      id: "specs-rejected",
      category: "review",
      title: "Specs Revision Requested",
      message: items.revisionFeedback,
      timestamp: new Date().toISOString(),
      severity: "warning",
    });
  }

  const blockedByRejections = items.workItems.filter(
    (item) =>
      item.status === "blocked" &&
      (item.executionConfig?.rejectionCount ?? 0) >= 3,
  );
  for (const workItem of blockedByRejections) {
    notifications.push({
      id: `blocked-${workItem.id}`,
      category: "review",
      title: "Work Item Blocked By QA Rejections",
      message: `${workItem.title} reached ${workItem.executionConfig?.rejectionCount ?? 0} rejection(s).`,
      timestamp: workItem.updated_at,
      severity: "error",
    });
  }

  for (const decision of items.decisionLog) {
    notifications.push(decisionNotification(decision));
  }

  return notifications.sort(
    (left, right) =>
      new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime(),
  );
}
