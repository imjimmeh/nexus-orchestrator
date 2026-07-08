export interface BucketKey {
  tier: string;
  workflowId: string | null;
  type: string;
  storyPoints: number | null;
}

export interface UpsertBucketInput extends BucketKey {
  sampleCount: number;
  meanInputTokens: number;
  p25InputTokens: number;
  p75InputTokens: number;
  meanOutputTokens: number;
  p25OutputTokens: number;
  p75OutputTokens: number;
  meanPricedTurnCount: number;
  p25PricedTurnCount: number;
  p75PricedTurnCount: number;
}
