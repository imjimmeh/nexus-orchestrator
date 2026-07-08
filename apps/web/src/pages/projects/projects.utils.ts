import { Project } from "@/lib/api/projects.types";
import { WorkItem, WorkItemStatus } from "@/lib/api/work-items.types";
import type { ProjectSummary } from "./projects.utils.types";

export type { ProjectSummary } from "./projects.utils.types";

export function buildProjectSummary(
  project: Project,
  workItems: WorkItem[],
): ProjectSummary {
  const statusCounts: Partial<Record<WorkItemStatus, number>> = {};
  let activeAgentCount = 0;
  let totalTokenSpend = 0;

  for (const item of workItems) {
    statusCounts[item.status] = (statusCounts[item.status] ?? 0) + 1;

    if (
      (item.status === "refinement" ||
        item.status === "in-progress" ||
        item.status === "in-review") &&
      item.currentExecutionId
    ) {
      activeAgentCount += 1;
    }

    totalTokenSpend += item.tokenSpend ?? 0;
  }

  return {
    project,
    totalItems: workItems.length,
    statusCounts,
    activeAgentCount,
    totalTokenSpend,
  };
}

export function getProgressPercentage(summary: ProjectSummary): number {
  if (summary.totalItems === 0) {
    return 0;
  }

  const done = summary.statusCounts["done"] ?? 0;
  return Math.round((done / summary.totalItems) * 100);
}
