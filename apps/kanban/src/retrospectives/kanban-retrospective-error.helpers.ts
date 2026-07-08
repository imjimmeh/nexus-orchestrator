/**
 * Pure helper that formats an `unknown` value caught from a
 * try/catch into a single-line string suitable for log lines and
 * the `diagnostics_json` payload. Extracted so the
 * `private formatErrorMessage(error)` copies in
 * {@link KanbanRetrospectiveService} and
 * {@link KanbanRetrospectiveFailureThresholdService} stop drifting.
 *
 * Work item: ef4d6799-8468-4c4b-b8d6-20e8f0fca384 (M3).
 */

/**
 * Returns `error.message` for a real `Error` instance, otherwise
 * coerces the value via `String(...)`. Never throws.
 */
export function formatUnknownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}