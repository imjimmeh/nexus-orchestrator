export interface BucketAccumulator {
  workflowId: string | null;
  type: string;
  storyPoints: number | null;
  inputTokens: number[];
  outputTokens: number[];
  pricedTurnCounts: number[];
}

export interface WorkItemCostAttemptSample {
  work_item_id: string;
  workflow_id: string | null;
  type: string;
  story_points: number | null;
  total_input_tokens: number;
  total_output_tokens: number;
  priced_turn_count: number;
  created_at?: Date;
}

export interface WorkItemTotal {
  workItemId: string;
  workflowId: string | null;
  type: string;
  storyPoints: number | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  pricedTurnCount: number;
}
