import type { AgentAwaitEntity } from './agent-await.entity';

/** Parameters for registering a new durable agent await. */
export interface RegisterAgentAwaitInput {
  parentRunId: string;
  parentStepId: string;
  parentSessionTreeId?: string | null;
  awaitedRunIds: string[];
  resumeNodeId?: string | null;
}

/**
 * Outcome of processing a child run reaching a terminal state. `ready` is the
 * await whose status transition to `RESUMING` was won (via CAS), or `null` when
 * no await became ready as a result of this notification.
 */
export interface ChildTerminalResult {
  ready: AgentAwaitEntity | null;
}
