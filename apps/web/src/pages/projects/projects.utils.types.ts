import { Project } from "@/lib/api/projects.types";
import { WorkItemStatus } from "@/lib/api/work-items.types";

export interface ProjectSummary {
  project: Project;
  totalItems: number;
  statusCounts: Partial<Record<WorkItemStatus, number>>;
  activeAgentCount: number;
  totalTokenSpend: number;
}
