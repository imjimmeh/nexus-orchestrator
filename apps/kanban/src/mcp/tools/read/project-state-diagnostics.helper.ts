/**
 * `kanban.project_state` is a board *summary* tool: it should give the CEO a
 * compact, bounded snapshot, not the full decision log. The shared diagnostics
 * already cap the decision history by count (DEFAULT_DECISION_HISTORY_LIMIT),
 * but each entry carries an unbounded `reasoning` string, so 20 verbose entries
 * alone reached ~260KB in production and pushed the cycle over the model's
 * context limit. Deep history remains available via `kanban.orchestration_timeline`.
 */
export const PROJECT_STATE_DECISION_HISTORY_LIMIT = 5;
export const PROJECT_STATE_DECISION_REASONING_CHAR_LIMIT = 600;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function truncateReasoning(value: unknown): unknown {
  if (
    typeof value !== "string" ||
    value.length <= PROJECT_STATE_DECISION_REASONING_CHAR_LIMIT
  ) {
    return value;
  }
  return `${value.slice(0, PROJECT_STATE_DECISION_REASONING_CHAR_LIMIT - 1)}…`;
}

function compactDecisionEntry(entry: unknown): unknown {
  if (!isRecord(entry)) {
    return entry;
  }
  if (!("reasoning" in entry)) {
    return entry;
  }
  return { ...entry, reasoning: truncateReasoning(entry["reasoning"]) };
}

/**
 * Bound the `decisionHistory` carried inside the orchestration diagnostics that
 * `kanban.project_state` returns: keep only the most-recent entries (the input
 * is oldest-first) and truncate each entry's `reasoning` text. `decisionCount`
 * is left intact so the agent still sees the true total.
 */
export function compactOrchestrationDiagnostics(diagnostics: unknown): unknown {
  if (!isRecord(diagnostics)) {
    return diagnostics;
  }

  const history = diagnostics["decisionHistory"];
  if (!Array.isArray(history)) {
    return diagnostics;
  }

  const recent = history
    .slice(-PROJECT_STATE_DECISION_HISTORY_LIMIT)
    .map(compactDecisionEntry);

  return { ...diagnostics, decisionHistory: recent };
}
