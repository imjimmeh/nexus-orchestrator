/** Minimal raw PI event shapes expected by mapPiEventToCanonical */

export interface RawPiTurnStart {
  type: "turn_start";
}

export interface RawPiToolExecutionStart {
  type: "tool_execution_start";
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface RawPiToolExecutionEnd {
  type: "tool_execution_end";
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError: boolean;
}

export interface RawPiAgentEnd {
  type: "agent_end";
  messages: Array<{ content: Array<{ type: "text"; text: string }> }>;
}

export type RawPiEvent =
  | RawPiTurnStart
  | RawPiToolExecutionStart
  | RawPiToolExecutionEnd
  | RawPiAgentEnd;
