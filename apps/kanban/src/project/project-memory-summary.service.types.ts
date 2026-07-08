// apps/kanban/src/project/project-memory-summary.service.types.ts

export interface CharterMemoryRow {
  id: string;
  content: string;
  memory_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
