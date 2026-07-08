import { WorkItem } from "@/lib/api/work-items.types";
import { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import type { CognitiveBlock } from "./active-session.utils.types";

export type {
  CognitiveBlockType,
  CognitiveBlock,
  SessionChatRole,
  SessionChatMessage,
} from "./active-session.utils.types";
export {
  getPendingQuestions,
  toSessionChatMessages,
} from "./active-session.chat-builder";
export { getTodoItems } from "./active-session.chat-builder.todos";

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function isTextStreamTelemetry(telemetryType: string | undefined): boolean {
  return (
    telemetryType === "text_delta" ||
    telemetryType === "text_end" ||
    telemetryType === "message_delta" ||
    telemetryType === "message_end"
  );
}

function toolSummary(event: WorkflowTelemetryEvent): string {
  const toolName = asString(event.payload.toolName) || "unknown";
  const status =
    event.event_type === "tool_execution_end" ? "finished" : "started";
  return `Ran tool ${toolName} (${status})`;
}

function parseAgentTelemetryBlock(
  event: WorkflowTelemetryEvent,
  id: string,
): CognitiveBlock | null {
  const telemetryType = asString(event.payload.type);

  if (
    telemetryType?.includes("thinking") ||
    telemetryType?.includes("reasoning")
  ) {
    return {
      id,
      type: "thought",
      title: "Thought",
      body:
        asString(event.payload.delta) ||
        asString(event.payload.content) ||
        JSON.stringify(event.payload),
      timestamp: event.timestamp,
    };
  }

  if (!isTextStreamTelemetry(telemetryType)) {
    return null;
  }

  return {
    id,
    type: "agent",
    title: "Agent",
    body:
      asString(event.payload.delta) ||
      asString(event.payload.content) ||
      asString(event.payload.message) ||
      "",
    timestamp: event.timestamp,
  };
}

export function toCognitiveBlocks(
  events: WorkflowTelemetryEvent[],
): CognitiveBlock[] {
  const blocks: CognitiveBlock[] = [];

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const id = `${event.timestamp}:${event.event_type}:${index}`;

    if (event.event_type === "user_message") {
      blocks.push({
        id,
        type: "user",
        title: "User",
        body: asString(event.payload.message) || "",
        timestamp: event.timestamp,
      });
      continue;
    }

    if (
      event.event_type === "tool_execution_start" ||
      event.event_type === "tool_execution_end"
    ) {
      blocks.push({
        id,
        type: "tool",
        title: "Tool Call",
        body: toolSummary(event),
        timestamp: event.timestamp,
      });
      continue;
    }

    if (event.event_type === "agent_telemetry") {
      const block = parseAgentTelemetryBlock(event, id);
      if (block) {
        blocks.push(block);
        continue;
      }
    }

    if (event.event_type === "workflow_control") {
      blocks.push({
        id,
        type: "system",
        title: "System",
        body:
          asString(event.payload.action)?.toUpperCase() ||
          JSON.stringify(event.payload),
        timestamp: event.timestamp,
      });
    }
  }

  return blocks.filter((block) => block.body.trim().length > 0);
}

export function getBashOutputChunks(
  events: WorkflowTelemetryEvent[],
): string[] {
  return events
    .filter((event) => event.event_type === "bash_output")
    .map((event) =>
      asString(event.payload.chunk) ? String(event.payload.chunk) : "",
    )
    .filter((chunk) => chunk.length > 0);
}

export function isWorkflowRunPaused(events: WorkflowTelemetryEvent[]): boolean {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.event_type !== "workflow_control") {
      continue;
    }

    const action = asString(event.payload.action);
    if (!action) {
      continue;
    }

    const normalized = action.toLowerCase();
    if (normalized === "pause") {
      return true;
    }

    if (normalized === "resume" || normalized === "abort") {
      return false;
    }
  }

  return false;
}

export function getMergeConflictReason(
  workItem: Pick<WorkItem, "metadata"> | null | undefined,
): string | null {
  if (!workItem?.metadata || typeof workItem.metadata !== "object") {
    return null;
  }

  const lifecycle = workItem.metadata.lifecycle;
  if (!lifecycle || typeof lifecycle !== "object") {
    return null;
  }

  const merge = (lifecycle as Record<string, unknown>).merge;
  if (!merge || typeof merge !== "object") {
    return null;
  }

  const reason = (merge as Record<string, unknown>).reason;
  return asString(reason) || null;
}

export function buildConflictResolutionInstruction(params: {
  workItemTitle: string;
  mergeReason?: string | null;
  userGuidance?: string;
}): string {
  const { workItemTitle, mergeReason, userGuidance } = params;
  const guidance = asString(userGuidance);
  const reason = asString(mergeReason);

  const sections = [
    `Resolve merge conflicts for work item "${workItemTitle}" and prepare the branch for review.`,
    reason ? `Merge failure reason: ${reason}` : null,
    guidance ? `Additional human guidance: ${guidance}` : null,
    "Use the current workspace diff and file tree to identify conflict markers, resolve them carefully, and run relevant tests.",
    "After resolving conflicts, summarize the files changed and the validation steps performed.",
  ];

  return sections
    .filter((section): section is string => Boolean(section))
    .join("\n\n");
}
