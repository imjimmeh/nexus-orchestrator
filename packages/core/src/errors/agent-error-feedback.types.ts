export interface AgentErrorFeedback {
  error_code: string;
  summary: string;
  details: string;
  suggested_fix: string;
  retryable: boolean;
  retry_after_ms?: number;
  context?: Record<string, unknown>;
  examples?: string[];
}

export function toAgentErrorFeedback(params: {
  code: string;
  summary: string;
  details?: string;
  suggestedFix: string;
  retryable?: boolean;
  retryAfterMs?: number;
  context?: Record<string, unknown>;
  examples?: string[];
}): AgentErrorFeedback {
  const details = params.details?.trim();

  return {
    error_code: params.code,
    summary: params.summary,
    details: details && details.length > 0 ? details : params.summary,
    suggested_fix: params.suggestedFix,
    retryable: params.retryable ?? false,
    ...(typeof params.retryAfterMs === "number"
      ? { retry_after_ms: params.retryAfterMs }
      : {}),
    ...(params.context ? { context: params.context } : {}),
    ...(params.examples && params.examples.length > 0
      ? { examples: params.examples }
      : {}),
  };
}

export function classifyAgentErrorFeedback(params: {
  action: string;
  error: string;
  defaultSummary: string;
}): AgentErrorFeedback {
  const error = params.error.trim();
  const action = params.action;

  if (error.includes("Unknown workflow identifier")) {
    return toAgentErrorFeedback({
      code: "validation.unknown_workflow_identifier",
      summary: "The workflow identifier could not be resolved.",
      details: error,
      suggestedFix:
        "Use a workflow UUID or canonical workflow_id. If combining with agent_profile, ensure they are compatible.",
      context: { action, field: "workflow_id" },
    });
  }

  if (error.includes("does not match agent_profile")) {
    return toAgentErrorFeedback({
      code: "validation.workflow_agent_profile_mismatch",
      summary: "The selected workflow and agent_profile do not match.",
      details: error,
      suggestedFix:
        "Use only workflow_id or only agent_profile, or provide a matching pair.",
      context: { action },
    });
  }

  if (
    error.includes("High traffic detected") ||
    error.includes("HTTP 529") ||
    error.includes("529")
  ) {
    return toAgentErrorFeedback({
      code: "provider.overload_529",
      summary: "The model provider is overloaded (HTTP 529).",
      details: error,
      suggestedFix:
        "Wait for the configured retry window or switch to an alternative provider/model if urgent.",
      retryable: true,
      context: { action },
    });
  }

  return toAgentErrorFeedback({
    code: "action.failed",
    summary: params.defaultSummary,
    details: error,
    suggestedFix:
      "Review the error details and adjust inputs before retrying the action.",
    context: { action },
  });
}
