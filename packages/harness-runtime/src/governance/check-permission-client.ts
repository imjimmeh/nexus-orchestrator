import type { PermissionDecision } from "../engine/session-context.js";
import type {
  CheckPermission,
  CheckPermissionConfig,
} from "./check-permission-client.types.js";

export type {
  CheckPermissionConfig,
  CheckPermission,
} from "./check-permission-client.types.js";

const API_PREFIX = "/api";
const GOVERNANCE_PATH = "/workflow-runtime/check-permission";
const GOVERNANCE_MAX_ATTEMPTS = 3;
const GOVERNANCE_RETRY_BASE_MS = 500;

/**
 * Denial code stamped on a governance decision when the API rejected the
 * agent's own credential (HTTP 401/403) — almost always an expired token on a
 * long-running step. Distinct from a policy denial so callers can fail fast /
 * refresh instead of letting the model retry the tool forever.
 */
export const GOVERNANCE_AUTH_FAILED_CODE = "governance_auth_failed";

function buildCheckPermissionUrl(apiBaseUrl: string): string {
  const normalizedBaseUrl = apiBaseUrl.endsWith("/")
    ? apiBaseUrl.slice(0, -1)
    : apiBaseUrl;
  const path = GOVERNANCE_PATH;

  if (normalizedBaseUrl.endsWith(API_PREFIX)) {
    return `${normalizedBaseUrl}${path}`;
  }

  return `${normalizedBaseUrl}${API_PREFIX}${path}`;
}

/**
 * Creates an HTTP client that POSTs to the Nexus API check-permission endpoint.
 * Implements a 3-attempt backoff retry for network failures.
 * Returns a {@link PermissionDecision} based on the API response.
 */
export function createCheckPermission(
  config: CheckPermissionConfig,
): CheckPermission {
  const governanceUrl = buildCheckPermissionUrl(config.apiBaseUrl);

  return async (toolName, params) => {
    const requestBody = JSON.stringify({
      tool_name: toolName,
      payload: params,
      workflow_run_id: config.workflowRunId,
      chat_session_id: config.chatSessionId,
      job_id: config.jobId,
    });

    let lastError: unknown;

    for (let attempt = 1; attempt <= GOVERNANCE_MAX_ATTEMPTS; attempt++) {
      try {
        const response = await fetch(governanceUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.agentJwt}`,
            "Content-Type": "application/json",
          },
          body: requestBody,
        });

        if (!response.ok) {
          const errorText = await response.text();
          const reason = `Governance check failed (HTTP ${response.status}): ${errorText}`;
          // 401/403 mean the agent's own credential is invalid (almost always
          // an expired token on a long step) — distinct from a policy denial,
          // so the caller can fail fast / refresh instead of looping forever.
          if (response.status === 401 || response.status === 403) {
            return {
              status: "denied",
              code: GOVERNANCE_AUTH_FAILED_CODE,
              reason,
            } satisfies PermissionDecision;
          }
          // Non-retryable: return a synthetic denied decision so the caller
          // can surface the governance failure without crashing the tool run.
          return {
            status: "denied",
            reason,
          } satisfies PermissionDecision;
        }

        const { data } = (await response.json()) as {
          data: {
            status: "allow" | "allowed" | "denied" | "approval_required";
            reason?: string;
            denied_reason_code?: string;
          };
        };

        if (
          !data ||
          typeof (data as { status?: unknown }).status !== "string"
        ) {
          return {
            status: "denied",
            reason: "Invalid permission response from server",
          } satisfies PermissionDecision;
        }

        if (data.status === "denied") {
          return {
            status: "denied",
            reason: data.reason,
            code: data.denied_reason_code,
          } satisfies PermissionDecision;
        }

        if (data.status === "approval_required") {
          return {
            status: "approval_required",
            reason: data.reason,
          } satisfies PermissionDecision;
        }

        // "allow" and "allowed" both map to allowed
        return { status: "allowed" } satisfies PermissionDecision;
      } catch (error: unknown) {
        lastError = error;
        if (attempt < GOVERNANCE_MAX_ATTEMPTS) {
          await new Promise<void>((resolve) =>
            setTimeout(resolve, GOVERNANCE_RETRY_BASE_MS * attempt),
          );
        }
      }
    }

    const message =
      lastError instanceof Error
        ? lastError.message
        : "governance check failed (unknown error)";

    return {
      status: "denied",
      reason: `Governance check network error: ${message}`,
    } satisfies PermissionDecision;
  };
}
