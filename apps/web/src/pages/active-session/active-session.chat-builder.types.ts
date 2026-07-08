import type { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import type { SessionChatMessage } from "./active-session.utils.types";

export interface AgentStreamState {
  messageIndex: number;
  streamKey: string;
}

export interface ThoughtStreamState {
  messageIndex: number;
  streamKey: string;
}

export interface SessionChatBuildState {
  messages: SessionChatMessage[];
  activeAgentStream: AgentStreamState | null;
  /** Index of the most recently completed agent stream message, cleared on full stream reset. */
  lastCompletedAgentStreamIndex: number | null;
  activeThoughtStream: ThoughtStreamState | null;
  activeToolMessageByKey: Map<string, number>;
  activeSubagentMessageByKey: Map<string, number>;
  /** Tracks the message index of each in-progress command card, keyed by stepId. */
  activeCommandMessageByKey: Map<string, number>;
  /** Accumulates raw command events per stepId so the model can be rebuilt on each update. */
  commandEventsByStepId: Map<string, WorkflowTelemetryEvent[]>;
}

export type EventHandler = (
  state: SessionChatBuildState,
  event: WorkflowTelemetryEvent,
  id: string,
) => void;
