export interface AgentEndOutput {
  ok?: boolean;
  response?: string;
  errorMessage?: string;
  stopReason?: string;
  /** Set when the turn ended via a deliberate durable-await suspend. */
  suspended?: boolean;
}

export interface SessionCompletionResult {
  ok: boolean;
  response: string;
  error?: string;
  /** The turn ended because the agent durably suspended (await / delegate_*). */
  suspended?: boolean;
}
