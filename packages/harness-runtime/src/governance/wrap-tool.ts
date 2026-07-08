import type { CanonicalToolDefinition } from "../engine/session-context.js";
import {
  GOVERNANCE_AUTH_FAILED_CODE,
  type CheckPermission,
} from "./check-permission-client.js";

/**
 * Wraps a {@link CanonicalToolDefinition} so that every call is gated behind a
 * permission check. The caller supplies the `checkPermission` function so this
 * module has no HTTP or environment dependencies of its own.
 *
 * - "allowed" / "approval_required" → delegates to the original `execute`.
 * - "denied" (policy) → returns a soft structured error without calling the tool.
 * - "denied" (auth failure) → returns a hard, turn-terminating error so the run
 *   fails fast and can be retried with a fresh credential instead of the model
 *   retrying the tool against an expired token forever.
 */
export function wrapToolWithGovernance(
  tool: CanonicalToolDefinition,
  checkPermission: CheckPermission,
): CanonicalToolDefinition {
  return {
    ...tool,
    execute: async (callId, params, signal) => {
      const decision = await checkPermission(tool.name, params);

      if (decision.status === "denied") {
        const isAuthFailure = decision.code === GOVERNANCE_AUTH_FAILED_CODE;
        return {
          content: [
            {
              type: "text",
              text: isAuthFailure
                ? `${decision.reason ?? "Agent credential rejected"} — this run's agent token is no longer valid; stop and let the run be retried with a fresh container.`
                : (decision.reason ?? "Denied by governance policy"),
            },
          ],
          details: {
            ok: false,
            error: isAuthFailure
              ? GOVERNANCE_AUTH_FAILED_CODE
              : "permission_denied",
            reason: decision.reason,
            code: decision.code,
          },
          ...(isAuthFailure ? { terminate: true } : {}),
        };
      }

      // "allowed" and "approval_required" both proceed to execution.
      // approval_required means the API held the request until it was approved,
      // so by the time we receive the decision, execution is cleared to proceed.
      return tool.execute(callId, params, signal);
    },
  };
}
