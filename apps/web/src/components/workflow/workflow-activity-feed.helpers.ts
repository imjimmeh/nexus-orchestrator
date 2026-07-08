import { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import { formatDateSafe } from "@/lib/utils";
import type {
  ActivityItem,
  ActivityQuickType,
  WorkflowActivityFeedFilters,
} from "./workflow-activity-feed.types";

type ActivityCategory = "workflow" | "tool";

export const DEFAULT_WORKFLOW_ACTIVITY_FILTERS: WorkflowActivityFeedFilters = {
  searchQuery: "",
  showWorkflowEvents: true,
  showToolEvents: true,
  showFailuresOnly: false,
  quickType: "all",
};

export const QUICK_TYPE_OPTIONS: ReadonlyArray<{
  value: ActivityQuickType;
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "step", label: "Step" },
  { value: "tool", label: "Tool" },
  { value: "question", label: "Question" },
  { value: "error", label: "Error" },
  { value: "completion", label: "Completion" },
  { value: "system", label: "System" },
];

function getPayloadStringField(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function getEventSummary(event: WorkflowTelemetryEvent): string | null {
  const reason = getPayloadStringField(event.payload, "reason");
  if (reason) {
    return reason;
  }

  const errorMessage = getPayloadStringField(event.payload, "errorMessage");
  if (errorMessage) {
    return errorMessage;
  }

  const error = getPayloadStringField(event.payload, "error");
  if (error) {
    return error;
  }

  const message = getPayloadStringField(event.payload, "message");
  if (message) {
    return message;
  }

  return null;
}

function getToolName(payload: Record<string, unknown>): string | null {
  return (
    getPayloadStringField(payload, "toolName") ??
    getPayloadStringField(payload, "tool_name") ??
    getPayloadStringField(payload, "name")
  );
}

function getStepId(payload: Record<string, unknown>): string | null {
  return (
    getPayloadStringField(payload, "stepId") ??
    getPayloadStringField(payload, "step_id")
  );
}

function getJobId(payload: Record<string, unknown>): string | null {
  return (
    getPayloadStringField(payload, "jobId") ??
    getPayloadStringField(payload, "job_id")
  );
}

function classifyCategory(event: WorkflowTelemetryEvent): ActivityCategory {
  const type = event.event_type.toLowerCase();
  const toolName = getToolName(event.payload);
  if (type.includes("tool") || toolName) {
    return "tool";
  }

  return "workflow";
}

function isFailureLikeEvent(event: WorkflowTelemetryEvent): boolean {
  const eventType = event.event_type.toLowerCase();
  if (eventType.includes("failed") || eventType.includes("error")) {
    return true;
  }

  const summary = getEventSummary(event);
  if (summary?.toLowerCase().includes("failed")) {
    return true;
  }

  const outcome = getPayloadStringField(event.payload, "outcome");
  return outcome ? outcome.toLowerCase() === "failure" : false;
}

function hasProviderRateLimitReason(payload: Record<string, unknown>): boolean {
  if (
    payload.reasonCode === "provider_rate_limit_429" ||
    payload.retryCategory === "provider_rate_limit_429"
  ) {
    return true;
  }

  const nestedKeys = ["retryMetadata", "failureClassification", "auto_retry"];
  return nestedKeys.some((key) => {
    const nested = payload[key];
    return (
      nested !== null &&
      typeof nested === "object" &&
      hasProviderRateLimitReason(nested as Record<string, unknown>)
    );
  });
}

function isRateLimitRetryEvent(event: WorkflowTelemetryEvent): boolean {
  return (
    event.event_type === "workflow.retry_scheduled" &&
    hasProviderRateLimitReason(event.payload)
  );
}

function buildSearchText(params: {
  event: WorkflowTelemetryEvent;
  summary: string | null;
  toolName: string | null;
  stepId: string | null;
  jobId: string | null;
}): string {
  let payloadJson: string;
  try {
    payloadJson = JSON.stringify(params.event.payload);
  } catch {
    payloadJson = "";
  }

  return [
    params.event.event_type,
    params.event.timestamp,
    params.summary ?? "",
    params.toolName ?? "",
    params.stepId ?? "",
    params.jobId ?? "",
    payloadJson,
  ]
    .join(" ")
    .toLowerCase();
}

function classifyQuickType(event: WorkflowTelemetryEvent): ActivityQuickType {
  const eventType = event.event_type.toLowerCase();

  if (eventType.includes("tool")) {
    return "tool";
  }

  if (
    eventType.includes("question") ||
    eventType.includes("answer") ||
    eventType.includes("input")
  ) {
    return "question";
  }

  if (eventType.includes("fail") || eventType.includes("error")) {
    return "error";
  }

  if (
    eventType.includes("complete") ||
    eventType.includes("success") ||
    eventType.includes("finish") ||
    eventType.includes("end")
  ) {
    return "completion";
  }

  if (eventType.includes("step")) {
    return "step";
  }

  return "system";
}

function normalizeEvent(
  event: WorkflowTelemetryEvent,
  index: number,
): ActivityItem {
  const summary = getEventSummary(event);
  const toolName = getToolName(event.payload);
  const stepId = getStepId(event.payload);
  const jobId = getJobId(event.payload);

  return {
    key: `${event.timestamp}-${event.event_type}-${index}`,
    event,
    category: classifyCategory(event),
    summary,
    toolName,
    stepId,
    jobId,
    isFailureLike: isFailureLikeEvent(event),
    isRateLimitRetry: isRateLimitRetryEvent(event),
    quickType: classifyQuickType(event),
    searchText: buildSearchText({
      event,
      summary,
      toolName,
      stepId,
      jobId,
    }),
  };
}

export function normalizeEvents(
  events: WorkflowTelemetryEvent[],
): ActivityItem[] {
  return events.map((event, index) => normalizeEvent(event, index));
}

export function formatEventTime(timestamp: string): string {
  return formatDateSafe(timestamp, "MMM d, yyyy HH:mm:ss", "Unknown time");
}
