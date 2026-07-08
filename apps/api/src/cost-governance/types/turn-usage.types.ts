/**
 * Input for recording a single agent turn's token usage as a budget event.
 *
 * A "turn" is one request/response cycle in an agentic session (a tool-use
 * turn or the terminal turn). Each turn that consumed tokens is recorded as its
 * own {@link BudgetUsageEvent} so spend reflects the full multi-turn session
 * cost rather than only the final turn.
 */
export interface TurnUsageRecordInput {
  /** 'workflow_run' for workflow agents, 'chat' for chat-session agents. */
  contextType: 'workflow_run' | 'chat';
  /** The workflow run id or chat session id this turn belongs to. */
  contextId: string;
  /** Budget scope id, when the run is scoped. */
  scopeId: string | null;
  /** Provider name resolved from the agent's runner config. */
  providerName: string | null;
  /** Model name resolved from the agent's runner config. */
  modelName: string | null;
  /** The workflow step id, when available. */
  stepId: string | null;
  /** The raw provider `usage` object carried on the turn payload. */
  usage: unknown;
}
