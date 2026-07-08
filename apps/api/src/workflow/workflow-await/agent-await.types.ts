/** Parameters for opening a new durable await record. */
export interface CreateAgentAwaitInput {
  parentRunId: string;
  parentStepId: string;
  parentSessionTreeId?: string | null;
  awaitedRunIds: string[];
  resumeNodeId?: string | null;
}
