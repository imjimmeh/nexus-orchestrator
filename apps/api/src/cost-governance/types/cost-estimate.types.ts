export type RateInfo = {
  input_token_cents_per_million: number;
  output_token_cents_per_million: number;
};

export type CostEstimateInput = {
  providerName: string;
  modelName: string;
  expectedInputTokens: number | null;
  expectedOutputTokens: number | null;
  expectedTotalTokens: number | null;
};

export type CostEstimateResult = {
  estimatedCents: number | null;
  estimateSource: 'model_rate' | 'unknown';
  rateMatched: RateInfo | null;
  /** The id of the resolved `llm_models` row, or null when no row matched. */
  modelId: string | null;
};
