import type { RetrospectiveFinding } from '@nexus/core';

export type RejectedRetrospectiveFindingReason =
  | 'schema_invalid'
  | 'kind_none'
  | 'evidence_missing';

export interface RejectedRetrospectiveFinding {
  index: number;
  reasonCode: RejectedRetrospectiveFindingReason;
  issues: string[];
}

export interface ParsedRetrospectiveFindings {
  valid: RetrospectiveFinding[];
  rejected: RejectedRetrospectiveFinding[];
}

export interface EvidenceFilteredRetrospectiveFindings {
  valid: RetrospectiveFinding[];
  rejected: RejectedRetrospectiveFinding[];
}
