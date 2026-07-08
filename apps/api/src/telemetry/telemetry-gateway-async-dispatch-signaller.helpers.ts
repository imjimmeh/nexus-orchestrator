import type { AuthenticatedSocket } from './types';
import {
  hasPendingAsyncDispatch,
  rejectAsyncDispatch,
  resolveAsyncDispatch,
} from '../workflow/workflow-step-execution/async-dispatch-registry';

/**
 * Resolves or rejects any in-flight async-dispatch promise keyed by the
 * `(workflowRunId, stepId)` pair once the agent completes (success or failure).
 *
 * This unblocks any caller that is awaiting `awaitAgentExecution()` against
 * the same step. The dispatch may have been registered by a step-execution
 * orchestrator that is waiting for the agent to finish; without this
 * signaller that caller would hang until the run times out.
 *
 * Best-effort by design: missing ids, missing pending dispatches, or
 * already-settled promises are all silent no-ops. Failures are not surfaced.
 */
export function signalAsyncDispatchIfPending(
  client: AuthenticatedSocket,
  hasFailure: boolean,
  failureContext: string | undefined,
): void {
  if (!client.workflowRunId || !client.stepId) {
    return;
  }
  if (!hasPendingAsyncDispatch(client.workflowRunId, client.stepId)) {
    return;
  }
  if (hasFailure) {
    rejectAsyncDispatch(
      client.workflowRunId,
      client.stepId,
      new Error(failureContext ?? 'Agent ended with failure'),
    );
    return;
  }
  resolveAsyncDispatch(client.workflowRunId, client.stepId);
}
