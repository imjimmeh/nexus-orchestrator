import type { WaitReason } from "./agent-await.types";

/**
 * Neutral, scope-keyed projection of a workflow run that is still active
 * (PENDING or RUNNING). Used to make an orchestrating agent aware of the
 * work already in flight for its scope so it does not re-spawn duplicates.
 */
export interface RunningWorkflowSummary {
  runId: string;
  /** Human-facing workflow name (e.g. "Project Backlog Generation (CEO)"). */
  workflowName: string;
  status: "PENDING" | "RUNNING";
  /** Whole seconds since the run was created, at summary time. */
  ageSeconds: number;
  /** Parent run that spawned this run, when known. */
  parentRunId?: string;
  /** Why the run is parked, when it is suspended (e.g. "dependency"). */
  waitReason?: WaitReason;
}

const DEFAULT_SUMMARY_LIMIT = 10;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE;

function formatAge(ageSeconds: number): string {
  if (ageSeconds < SECONDS_PER_MINUTE) {
    return `${Math.max(0, Math.trunc(ageSeconds))}s`;
  }
  if (ageSeconds < SECONDS_PER_HOUR) {
    return `${Math.trunc(ageSeconds / SECONDS_PER_MINUTE)}m`;
  }
  return `${Math.trunc(ageSeconds / SECONDS_PER_HOUR)}h`;
}

function formatLine(summary: RunningWorkflowSummary): string {
  const parts = [
    `- ${summary.workflowName} [${summary.status}, ${formatAge(summary.ageSeconds)}]`,
  ];
  if (summary.waitReason) {
    parts.push(`waiting on ${summary.waitReason}`);
  }
  if (summary.parentRunId) {
    parts.push(`child of run ${summary.parentRunId}`);
  }
  parts.push(`run ${summary.runId}`);
  return parts.join(" — ");
}

/**
 * Render a deterministic, human-readable summary block of the workflows
 * already running for a scope, for injection into an agent prompt. Returns an
 * empty string when nothing is active so callers can omit the section.
 */
export function formatRunningWorkflowsSummary(
  summaries: RunningWorkflowSummary[],
  limit: number = DEFAULT_SUMMARY_LIMIT,
): string {
  if (summaries.length === 0) {
    return "";
  }

  const shown = summaries.slice(0, Math.max(0, limit));
  const lines = shown.map(formatLine);
  const hiddenCount = summaries.length - shown.length;

  const header = `Workflows already running for this scope (${summaries.length}):`;
  const footer =
    hiddenCount > 0
      ? `…and ${hiddenCount} more not shown. Use list_running_workflows for the full list.`
      : undefined;

  return [header, ...lines, footer]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}
