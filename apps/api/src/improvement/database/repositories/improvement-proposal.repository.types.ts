import type {
  ImprovementProposalKind,
  ImprovementProposalStatus,
} from '@nexus/core';

export interface ListImprovementProposalsFilter {
  kinds?: ImprovementProposalKind[];
  statuses?: ImprovementProposalStatus[];
  page?: number;
  limit?: number;
}
