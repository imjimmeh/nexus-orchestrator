import type { ImprovementProposalKind } from '@nexus/core';
import type { ImprovementProposal } from '../database/entities/improvement-proposal.entity';

export interface ImprovementApplyResult {
  ok: boolean;
  detail?: string;
  unrouted?: boolean;
}

export interface IImprovementApplier {
  readonly kind: ImprovementProposalKind;
  apply(proposal: ImprovementProposal): Promise<ImprovementApplyResult>;
  rollback?(proposal: ImprovementProposal): Promise<void>;
}

export const IMPROVEMENT_APPLIERS = Symbol('IMPROVEMENT_APPLIERS');
