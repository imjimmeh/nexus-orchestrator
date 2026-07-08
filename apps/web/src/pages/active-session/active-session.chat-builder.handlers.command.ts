import { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import { appendMessage } from "./active-session.chat-builder";
import type { SessionChatBuildState } from "./active-session.chat-builder.types";
import { buildStepCommandModels } from "./step-command-model";
import { asString } from "./active-session.chat-helpers";

/**
 * Handles command_started / command_output / command_finished events.
 *
 * Maintains one per-step command_card chat item keyed by stepId.
 * Raw events are accumulated in state.commandEventsByStepId so the model can
 * be rebuilt from scratch on each update — the same pattern the tool handler
 * uses to merge start/update/end into one message.
 */
export function handleCommandEvent(
  state: SessionChatBuildState,
  event: WorkflowTelemetryEvent,
  id: string,
): void {
  const stepId = asString(event.payload.stepId);
  if (!stepId) return;

  const accumulated = state.commandEventsByStepId.get(stepId) ?? [];
  accumulated.push(event);
  state.commandEventsByStepId.set(stepId, accumulated);

  const models = buildStepCommandModels(accumulated);
  const model = models.find((m) => m.stepId === stepId);
  if (!model) return;

  const existingIndex = state.activeCommandMessageByKey.get(stepId);
  const existingMessage =
    existingIndex !== undefined ? state.messages[existingIndex] : undefined;

  if (existingMessage) {
    existingMessage.timestamp = event.timestamp;
    existingMessage.content = model.command;
    existingMessage.metadata = { type: "command_card", model };

    if (event.event_type === "command_finished") {
      state.activeCommandMessageByKey.delete(stepId);
    }
    return;
  }

  appendMessage(state, {
    id,
    role: "event",
    label: "Command",
    content: model.command,
    timestamp: event.timestamp,
    category: "command",
    metadata: { type: "command_card", model },
  });

  if (event.event_type !== "command_finished") {
    state.activeCommandMessageByKey.set(stepId, state.messages.length - 1);
  }
}
