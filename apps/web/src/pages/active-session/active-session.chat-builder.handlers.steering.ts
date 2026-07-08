import type { SteeringPlan } from "@/lib/api/steering.types";
import type { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import { asString } from "./active-session.chat-helpers";
import { appendMessage, clearAllStreams } from "./active-session.chat-builder";
import type { SessionChatBuildState } from "./active-session.chat-builder.types";

export function handleSteeringPlanProposedEvent(
  state: SessionChatBuildState,
  event: WorkflowTelemetryEvent,
  id: string,
): void {
  clearAllStreams(state);
  const plan = event.payload.plan as SteeringPlan | undefined;
  if (!plan) {
    return;
  }
  const planId = asString(event.payload.plan_id) || plan.id || "";
  const planDescription = plan.description;
  const content =
    planDescription || `Steering plan: ${plan.intent || "proposed"}`;

  appendMessage(state, {
    id,
    role: "agent",
    content,
    label: "Steering Plan",
    timestamp: event.timestamp,
    category: "agent",
    metadata: {
      type: "steering_plan",
      plan,
      planId,
    },
  });
}

export function handleSteeringPlanApprovedEvent(
  state: SessionChatBuildState,
  event: WorkflowTelemetryEvent,
  id: string,
): void {
  clearAllStreams(state);
  appendMessage(state, {
    id,
    role: "event",
    content: "Steering plan approved",
    label: "System",
    timestamp: event.timestamp,
    category: "system",
  });
}

export function handleSteeringPlanRejectedEvent(
  state: SessionChatBuildState,
  event: WorkflowTelemetryEvent,
  id: string,
): void {
  clearAllStreams(state);
  appendMessage(state, {
    id,
    role: "event",
    content: "Steering plan rejected",
    label: "System",
    timestamp: event.timestamp,
    category: "system",
  });
}
