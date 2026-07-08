// packages/e2e-tests/src/driver/kanban-client.types.ts

export interface KanbanProject {
  id: string;
  name: string;
}

export interface KanbanWorkItem {
  id: string;
  title: string;
  status: string;
}

export interface Initiative {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  horizon: "now" | "next" | "later";
  priority: number;
  status: string;
  goalIds: string[];
  lastReviewedAt: string | null;
  created_at: string;
  updated_at: string;
}

export interface TimelineEntry {
  timestamp: string;
  type: string;
  reasoning?: string;
  actions?: string[];
  kind?: string;
  [key: string]: unknown;
}
