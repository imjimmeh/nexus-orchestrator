export interface CostEstimateInput {
  workflowId: string | null;
  type: string;
  storyPoints: number | null;
  modelId: string | null;
}

export interface CostEstimateWhatIf {
  modelId: string;
  modelName: string;
  providerName: string | null;
  estimatedCostCents: number;
}

export interface CostEstimateResult {
  available: boolean;
  bucketTier: string | null;
  sampleCount: number;
  estimatedCostCents: number | null;
  lowCostCents: number | null;
  highCostCents: number | null;
  whatIf: CostEstimateWhatIf[];
}
