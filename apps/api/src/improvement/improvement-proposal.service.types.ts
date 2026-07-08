import type { ImprovementProposalKind } from '@nexus/core';
import type { ImprovementProposal } from './database/entities/improvement-proposal.entity';
import type { ImprovementEvidencePayload } from './database/entities/improvement-proposal.entity.types';

export interface ImprovementProposalDraft {
  kind: ImprovementProposalKind;
  payload: Record<string, unknown>;
  evidence: ImprovementEvidencePayload;
  confidence: number;
  provenance?: Record<string, unknown>;
}

export interface SubmitProposalResult {
  outcome: 'auto_applied' | 'proposed' | 'dropped' | 'apply_failed';
  proposal: ImprovementProposal | null;
}

export interface BulkApproveProposalOutcome {
  id: string;
  status: 'approved' | 'failed';
  proposal: ImprovementProposal | null;
  error?: string;
}

export interface BulkRejectProposalOutcome {
  id: string;
  status: 'rejected' | 'failed';
  proposal: ImprovementProposal | null;
  error?: string;
}
