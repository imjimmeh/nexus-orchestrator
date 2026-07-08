import type {
  ImportedRepositoryFindingDecision,
  ImportedRepositoryFindingDisposition,
  ImportedRepositoryFindingStatus,
} from "./imported-repository-finding.types";

export interface ListImportedRepositoryFindingsInput {
  readonly projectId: string;
  readonly statuses?: ImportedRepositoryFindingStatus[];
  readonly limit?: number;
}

export interface ImportedRepositoryFindingDto {
  readonly id: string;
  readonly projectId: string;
  readonly sourceId: string;
  readonly sourceHash: string;
  readonly title: string;
  readonly reason: string;
  readonly findingKind: string;
  readonly recommendedWorkType: string;
  readonly recommendedStatus: string;
  readonly status: ImportedRepositoryFindingStatus;
  readonly evidence: Record<string, unknown>;
  readonly decision: ImportedRepositoryFindingDecision | null;
  readonly workItemId: string | null;
}

export interface ResolveImportedRepositoryFindingCommand {
  readonly projectId: string;
  readonly findingId: string;
  readonly disposition: ImportedRepositoryFindingDisposition;
  readonly rationale: string;
  readonly decidedBy?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface ResolveImportedRepositoryFindingResult {
  readonly finding: ImportedRepositoryFindingDto;
  readonly workItemId?: string;
  readonly publishAction?: string;
}
