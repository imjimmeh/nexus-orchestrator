import { WorkItem, WorkItemStatus } from "@/lib/api/work-items.types";
import type { SessionSummary } from "./workspace.utils.types";

export type { SessionSummary } from "./workspace.utils.types";

export function getRunStatusBadgeVariant(
  status: WorkItemStatus,
): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "refinement":
    case "in-progress":
      return "default";
    case "in-review":
      return "secondary";
    case "blocked":
      return "destructive";
    default:
      return "outline";
  }
}

/**
 * Builds a context message for the architect agent based on selected work items.
 * This allows users to refine specs with awareness of existing board items.
 */
export function buildRefinementContext(items: WorkItem[]): string {
  if (items.length === 0) return "";

  const lines = [
    `I have the following ${items.length} work item(s) on my board that I want to refine:`,
    "",
  ];

  for (const item of items) {
    lines.push(
      `- [${item.type.toUpperCase()}] "${item.title}" (${item.status}, ${item.priority ?? "unknown"})`,
    );
    if (item.description) {
      lines.push(`  Description: ${item.description}`);
    }
  }

  lines.push("");
  lines.push(
    "Please help me refine the specs considering these existing items.",
  );

  return lines.join("\n");
}

/**
 * Validates spec markdown content for basic structural completeness.
 * Returns true if the spec has meaningful content beyond just headers.
 */
export function hasSpecContent(markdown: string | null | undefined): boolean {
  if (!markdown) return false;
  const stripped = markdown.replace(/^#{1,6}\s+.*$/gm, "").trim();
  return stripped.length > 0;
}

/**
 * Derives a human-readable session summary from a work item's execution state.
 * Uses the real workflow run status when available.
 */
export function deriveSessionSummary(item: WorkItem): SessionSummary {
  const hasExecution = !!item.currentExecutionId;
  const execStatus = item.lastExecutionStatus;

  if (execStatus === "FAILED" || execStatus === "CANCELLED") {
    return { status: "error", hasExecution, label: "Execution Failed" };
  }

  if (execStatus === "RUNNING" && item.waitingForInput) {
    return { status: "awaiting-input", hasExecution, label: "Awaiting Input" };
  }

  if (execStatus === "RUNNING") {
    return { status: "running", hasExecution, label: "Agent Running" };
  }

  if (execStatus === "PENDING") {
    return { status: "queued", hasExecution, label: "Queued" };
  }

  if (item.status === "blocked") {
    return {
      status: "blocked",
      hasExecution,
      label: hasExecution ? "Blocked (Session Active)" : "Blocked",
    };
  }

  if (item.status === "done") {
    return { status: "completed", hasExecution: false, label: "Completed" };
  }

  if (item.status === "ready-to-merge") {
    return {
      status: "completed",
      hasExecution: false,
      label: "Ready to Merge",
    };
  }

  if (execStatus === "COMPLETED") {
    return { status: "completed", hasExecution, label: "Execution Complete" };
  }

  return { status: "idle", hasExecution: false, label: "No Session" };
}
