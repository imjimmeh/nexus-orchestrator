import { WorkItem, WorkItemStatus } from "@/lib/api/work-items.types";
import type { DecisionMetadata } from "./kanban-card-ui.types";

export function parseDecisionMetadata(
  metadata: Record<string, unknown> | null | undefined,
): DecisionMetadata | null {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  return {
    feedbackNeeded: metadata.feedbackNeeded === true,
    decisionPrompt:
      typeof metadata.decisionPrompt === "string"
        ? metadata.decisionPrompt
        : null,
    autonomousDecision: metadata.autonomousDecision === true,
    resolutionRationale:
      typeof metadata.resolutionRationale === "string"
        ? metadata.resolutionRationale
        : null,
    humanDecisionResponse:
      typeof metadata.humanDecisionResponse === "string"
        ? metadata.humanDecisionResponse
        : null,
    humanDecisionResolvedBy:
      typeof metadata.humanDecisionResolvedBy === "string"
        ? metadata.humanDecisionResolvedBy
        : null,
    humanDecisionResolvedAt:
      typeof metadata.humanDecisionResolvedAt === "string"
        ? metadata.humanDecisionResolvedAt
        : null,
    userStatusOverride: metadata.userStatusOverride === true,
    generatedRecommendation:
      typeof metadata.generatedRecommendation === "string"
        ? metadata.generatedRecommendation
        : null,
    currentDisposition:
      typeof metadata.currentDisposition === "string"
        ? metadata.currentDisposition
        : null,
    lastGeneratedStatus:
      typeof metadata.lastGeneratedStatus === "string"
        ? metadata.lastGeneratedStatus
        : null,
  };
}

const STATUS_PROGRESS: Partial<Record<WorkItemStatus, number>> = {
  backlog: 5,
  todo: 15,
  refinement: 30,
  "in-progress": 60,
  "in-review": 85,
  "ready-to-merge": 92,
  "awaiting-pr-merge": 95,
  blocked: 45,
  done: 100,
};

export function getStatusProgress(status: WorkItemStatus): number {
  return STATUS_PROGRESS[status] ?? 0;
}

export function getPriorityBorderClass(priority: string | undefined): string {
  switch (priority?.toUpperCase()) {
    case "P0":
      return "border-l-error";
    case "P1":
      return "border-l-accent-orange";
    case "P2":
      return "border-l-warning";
    default:
      return "border-l-muted-foreground";
  }
}

export function getDependencyLabel(item: WorkItem): string {
  const dependencyCount = item.dependsOn?.length ?? 0;
  if (dependencyCount === 0) {
    return "Ready";
  }
  return `${dependencyCount} dep${dependencyCount === 1 ? "" : "s"}`;
}
