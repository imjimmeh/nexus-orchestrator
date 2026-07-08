import type { BucketTierConfig, TokenDistribution } from "./bucket-tiers.types";

export type { BucketTierConfig, TokenDistribution } from "./bucket-tiers.types";

export const BUCKET_TIERS: BucketTierConfig[] = [
  {
    name: "workflow_type_points",
    minSampleSize: 5,
    usesWorkflow: true,
    usesStoryPoints: true,
  },
  {
    name: "workflow_type",
    minSampleSize: 5,
    usesWorkflow: true,
    usesStoryPoints: false,
  },
  {
    name: "global",
    minSampleSize: 1,
    usesWorkflow: false,
    usesStoryPoints: false,
  },
];

function percentile(sorted: number[], fraction: number): number {
  const index = Math.min(
    sorted.length - 1,
    Math.floor(fraction * sorted.length),
  );
  return sorted[index] ?? 0;
}

export function computeTokenDistribution(samples: number[]): TokenDistribution {
  if (samples.length === 0) {
    return { n: 0, mean: 0, p25: 0, p75: 0 };
  }

  const sorted = [...samples].sort((left, right) => left - right);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;

  return {
    n: sorted.length,
    mean,
    p25: percentile(sorted, 0.25),
    p75: percentile(sorted, 0.75),
  };
}
