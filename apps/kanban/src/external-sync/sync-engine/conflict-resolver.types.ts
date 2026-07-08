export interface ConflictCheckInput {
  externalUpdatedAt: string | null | undefined;
  workItemUpdatedAt: string;
  externalId: string;
  workItemId: string;
}

export interface ConflictResolutionResult {
  decision: "apply_external" | "skip_external" | "noop";
  reason: string;
  details: {
    externalUpdatedAt: string | null;
    workItemUpdatedAt: string;
    externalId: string;
    workItemId: string;
  };
}
