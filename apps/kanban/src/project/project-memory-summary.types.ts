export type ProjectMemoryType = "preference" | "fact" | "history";

export interface ProjectMemorySummary {
  entity_type: string;
  entity_id: string;
  totalCount: number;
  byType: Record<ProjectMemoryType, number>;
  retrievalTool: "query_memory";
}
