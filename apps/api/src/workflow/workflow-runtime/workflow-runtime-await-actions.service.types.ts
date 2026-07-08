/** Raw parameters accepted by the `await_agent_workflow` runtime action. */
export type AwaitAgentWorkflowParams = Record<string, unknown>;

/** Capability/action name for the durable agent await. */
export const AWAIT_REQUESTED_ACTION = 'await_agent_workflow' as const;

/** Directive returned to the runner instructing it to durably suspend. */
export const AWAIT_EXECUTION_STATUS_SUSPENDED = 'suspended' as const;

/**
 * Response envelope for a successful `await_agent_workflow` action. The
 * `executionStatus` directive tells the runner to durably suspend the calling
 * step until every awaited child run reaches a terminal state.
 */
export interface AwaitAgentWorkflowResponse {
  ok: true;
  requestedAction: 'await_agent_workflow';
  executionStatus: typeof AWAIT_EXECUTION_STATUS_SUSPENDED;
  awaitId: string;
  awaitedRunIds: string[];
}
