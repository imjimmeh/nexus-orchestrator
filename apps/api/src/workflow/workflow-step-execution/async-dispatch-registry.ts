export const ASYNC_DISPATCH_MODE_ENV = 'WORKFLOW_AGENT_DISPATCH_MODE';
export const ASYNC_DISPATCH_MODE_VALUE = 'async';

const pendingDispatches = new Map<
  string,
  { resolve: () => void; reject: (e: Error) => void }
>();

function makeKey(workflowRunId: string, stepId: string): string {
  return `${workflowRunId}::${stepId}`;
}

/**
 * Registers a pending async dispatch for the given workflow run and step, returning
 * a promise that resolves or rejects when the agent signals completion via
 * `resolveAsyncDispatch` / `rejectAsyncDispatch`.
 *
 * Callers are responsible for ensuring the promise eventually settles. If neither
 * signal arrives (e.g. the container crashes before `agent_end` fires), the outer
 * Bull job timeout acts as the safety net — the job will be marked failed once the
 * timeout elapses, preventing the promise from hanging indefinitely.
 */
export function registerAsyncDispatch(
  workflowRunId: string,
  stepId: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    pendingDispatches.set(makeKey(workflowRunId, stepId), { resolve, reject });
  });
}

export function resolveAsyncDispatch(
  workflowRunId: string,
  stepId: string,
): void {
  const key = makeKey(workflowRunId, stepId);
  pendingDispatches.get(key)?.resolve();
  pendingDispatches.delete(key);
}

export function rejectAsyncDispatch(
  workflowRunId: string,
  stepId: string,
  error: Error,
): void {
  const key = makeKey(workflowRunId, stepId);
  pendingDispatches.get(key)?.reject(error);
  pendingDispatches.delete(key);
}

export function hasPendingAsyncDispatch(
  workflowRunId: string,
  stepId: string,
): boolean {
  return pendingDispatches.has(makeKey(workflowRunId, stepId));
}
