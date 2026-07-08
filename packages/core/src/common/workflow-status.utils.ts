const TERMINAL_WORKFLOW_RUN_STATUSES = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

/**
 * Returns true if the given workflow run status is terminal (COMPLETED, FAILED, or CANCELLED).
 * Safe to call with any value — non-matching values always return false.
 */
export function isTerminalWorkflowRunStatus(status: unknown): boolean {
  return (
    typeof status === "string" && TERMINAL_WORKFLOW_RUN_STATUSES.has(status)
  );
}
