export interface BucketTierConfig {
  name: "workflow_type_points" | "workflow_type" | "global";
  minSampleSize: number;
  usesWorkflow: boolean;
  usesStoryPoints: boolean;
}

export interface TokenDistribution {
  n: number;
  mean: number;
  p25: number;
  p75: number;
}
