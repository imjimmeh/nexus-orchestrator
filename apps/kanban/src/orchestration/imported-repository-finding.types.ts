import type { RepositoryWorkItemSpec } from "./imported-repository-backlog-reconciler.types";

export type WorkItemRecommendationStatus = "done" | "todo" | "blocked";

export type ImportedRepositoryFindingWorkType =
  | "existing_capability"
  | "gap"
  | "bug"
  | "test"
  | "docs"
  | "architecture"
  | "investigation"
  | "human_decision";

export type ImportedRepositoryFindingStatus =
  | "pending_investigation"
  | "ready_for_work_item"
  | "converted_to_work_item"
  | "suppressed"
  | "needs_human"
  | "resolved_existing";

export type ImportedRepositoryFindingDisposition =
  | "create_work_item"
  | "suppress"
  | "needs_human"
  | "resolved_existing";

export type ImportedRepositoryFindingEvidence =
  RepositoryWorkItemSpec["evidence"] & {
    readonly sourceId: string;
    readonly originalWorkType?: string;
  };

export interface ImportedRepositoryFindingDecision {
  readonly disposition: ImportedRepositoryFindingDisposition;
  readonly rationale: string;
  readonly decidedBy: string;
  readonly decidedAt: string;
  readonly policy?: string;
  readonly autonomousDecision?: boolean;
  readonly generatedWorkItemId?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface UpsertImportedRepositoryFindingInput {
  readonly projectId: string;
  readonly sourceId: string;
  readonly sourceHash: string;
  readonly probeArtifactPath: string;
  readonly probeScopeId?: string;
  readonly projectScopeId?: string;
  readonly title: string;
  readonly reason: string;
  readonly findingKind: ImportedRepositoryFindingWorkType;
  readonly recommendedWorkType: ImportedRepositoryFindingWorkType;
  readonly recommendedStatus: WorkItemRecommendationStatus;
  readonly status?: ImportedRepositoryFindingStatus;
  readonly confidenceScore?: number;
  readonly evidence: ImportedRepositoryFindingEvidence;
  readonly decision?: ImportedRepositoryFindingDecision | null;
  readonly workItemId?: string | null;
  readonly metadata?: Record<string, unknown> | null;
  readonly observedAt?: Date;
  readonly resolvedAt?: Date | null;
}

export interface ResolveImportedRepositoryFindingInput {
  readonly projectId: string;
  readonly findingId: string;
  readonly status: ImportedRepositoryFindingStatus;
  readonly decision: ImportedRepositoryFindingDecision;
  readonly workItemId?: string | null;
  readonly metadata?: Record<string, unknown> | null;
  readonly resolvedAt?: Date;
}
