import type {
  ImprovementProposalKind,
  ImprovementProposalStatus,
} from "@nexus/core";

export interface ImprovementProposalFilters {
  kind?: ImprovementProposalKind[];
  status?: ImprovementProposalStatus[];
}
