import type { ModelUsageBreakdownRow } from "../entities/kanban-work-item-run-cost.entity.types";

export interface RecordRunCostAttemptInput {
  work_item_id: string;
  run_id: string;
  workflow_id: string | null;
  type: string;
  story_points: number | null;
  priority: string;
  model_breakdown: ModelUsageBreakdownRow[];
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_cents: number;
  priced_turn_count: number;
  started_at: Date | null;
  completed_at: Date | null;
}
