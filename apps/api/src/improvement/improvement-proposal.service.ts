import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ImprovementProposalRepository } from './database/repositories/improvement-proposal.repository';
import type { ImprovementProposal } from './database/entities/improvement-proposal.entity';
import type { ListImprovementProposalsFilter } from './database/repositories/improvement-proposal.repository.types';
import { ImprovementGovernancePolicyService } from './governance/improvement-governance-policy.service';
import { ImprovementApplierRegistry } from './appliers/improvement-applier.registry';
import type { IImprovementApplier } from './appliers/improvement-applier.types';
import { EventLedgerService } from '../observability/event-ledger.service';
import { emitImprovementAudit } from './improvement-proposal.audit';
import type {
  BulkApproveProposalOutcome,
  BulkRejectProposalOutcome,
  ImprovementProposalDraft,
  SubmitProposalResult,
} from './improvement-proposal.service.types';

export type {
  BulkApproveProposalOutcome,
  BulkRejectProposalOutcome,
  ImprovementProposalDraft,
  SubmitProposalResult,
};

@Injectable()
export class ImprovementProposalService {
  private readonly logger = new Logger(ImprovementProposalService.name);

  constructor(
    private readonly proposals: ImprovementProposalRepository,
    private readonly governance: ImprovementGovernancePolicyService,
    private readonly appliers: ImprovementApplierRegistry,
    private readonly ledger: EventLedgerService,
  ) {}

  async submitProposal(
    draft: ImprovementProposalDraft,
  ): Promise<SubmitProposalResult> {
    const action = await this.governance.resolveAction({
      kind: draft.kind,
      evidenceClass: draft.evidence.evidenceClass,
      confidence: draft.confidence,
      provenanceSource: readProvenanceSource(draft.provenance),
    });

    if (action === 'drop') {
      await emitImprovementAudit(this.ledger, {
        eventName: 'improvement.proposal.dropped',
        proposalId: null,
        outcome: 'success',
        payload: { kind: draft.kind, confidence: draft.confidence },
      });
      return { outcome: 'dropped', proposal: null };
    }

    const proposal = await this.proposals.create({
      kind: draft.kind,
      status: 'pending',
      payload: draft.payload,
      evidence: draft.evidence,
      confidence: draft.confidence,
      provenance: draft.provenance ?? {},
    });

    await emitImprovementAudit(this.ledger, {
      eventName: 'improvement.proposal.created',
      proposalId: proposal.id,
      outcome: 'success',
      payload: { kind: proposal.kind, action },
    });

    if (action === 'propose') {
      return { outcome: 'proposed', proposal };
    }

    const applied = await this.applyProposal(proposal);
    return {
      outcome: applied.status === 'applied' ? 'auto_applied' : 'apply_failed',
      proposal: applied,
    };
  }

  async list(
    filter: ListImprovementProposalsFilter,
  ): Promise<{ data: ImprovementProposal[]; total: number }> {
    return await this.proposals.list(filter);
  }

  async getById(id: string): Promise<ImprovementProposal> {
    const proposal = await this.proposals.findById(id);
    if (!proposal) throw new NotFoundException(`Proposal ${id} not found`);
    return proposal;
  }

  /**
   * Look up an existing pending `skill_create` proposal for the given
   * target skill name. Used by the `create_skill_proposal` agent tool to
   * dedupe repeated tool calls onto the same pending proposal instead of
   * submitting a duplicate (see `MemoryToolsHandler.createSkillProposal`).
   */
  async findPendingSkillCreateByTargetName(
    targetSkillName: string,
  ): Promise<ImprovementProposal | null> {
    return this.proposals.findPendingSkillCreateByTargetName(targetSkillName);
  }

  async approve(id: string): Promise<ImprovementProposal> {
    const approved = await this.proposals.updatePendingById(id, {
      status: 'approved',
    });
    if (!approved) {
      const existing = await this.proposals.findById(id);
      if (!existing) throw new NotFoundException(`Proposal ${id} not found`);
      throw new ConflictException(`Proposal ${id} is not pending`);
    }
    return await this.applyProposal(approved);
  }

  async reject(id: string, reason?: string): Promise<ImprovementProposal> {
    const existing = await this.proposals.findById(id);
    if (!existing) throw new NotFoundException(`Proposal ${id} not found`);

    const rejected = await this.proposals.updatePendingById(id, {
      status: 'rejected',
      ...(reason
        ? { provenance: { ...existing.provenance, reject_reason: reason } }
        : {}),
    });
    if (!rejected) {
      throw new ConflictException(`Proposal ${id} is not pending`);
    }
    await emitImprovementAudit(this.ledger, {
      eventName: 'improvement.proposal.rejected',
      proposalId: id,
      outcome: 'success',
      payload: { kind: rejected.kind, ...(reason ? { reason } : {}) },
    });
    return rejected;
  }

  /**
   * Approves each proposal id in turn, isolating per-id failures so one bad
   * id (not found / not pending / applier error) never blocks the rest of
   * the batch.
   */
  async bulkApprove(
    proposalIds: string[],
  ): Promise<BulkApproveProposalOutcome[]> {
    const outcomes: BulkApproveProposalOutcome[] = [];
    for (const id of proposalIds) {
      try {
        const proposal = await this.approve(id);
        outcomes.push({ id, status: 'approved', proposal });
      } catch (error) {
        outcomes.push({
          id,
          status: 'failed',
          proposal: null,
          error: String(error instanceof Error ? error.message : error),
        });
      }
    }
    return outcomes;
  }

  /**
   * Rejects each proposal id in turn, isolating per-id failures so one bad
   * id (not found / not pending) never blocks the rest of the batch.
   */
  async bulkReject(
    proposalIds: string[],
    reason?: string,
  ): Promise<BulkRejectProposalOutcome[]> {
    const outcomes: BulkRejectProposalOutcome[] = [];
    for (const id of proposalIds) {
      try {
        const proposal = await this.reject(id, reason);
        outcomes.push({ id, status: 'rejected', proposal });
      } catch (error) {
        outcomes.push({
          id,
          status: 'failed',
          proposal: null,
          error: String(error instanceof Error ? error.message : error),
        });
      }
    }
    return outcomes;
  }

  async rollback(id: string): Promise<ImprovementProposal> {
    const proposal = await this.proposals.findById(id);
    if (!proposal) throw new NotFoundException(`Proposal ${id} not found`);
    if (proposal.status !== 'applied') {
      throw new ConflictException(
        `Proposal ${id} is not applied (current: ${proposal.status})`,
      );
    }
    const applier = this.appliers.require(proposal.kind);
    if (!applier.rollback) {
      throw new ConflictException(
        `Applier for kind '${proposal.kind}' does not support rollback`,
      );
    }
    await applier.rollback(proposal);
    const updated = await this.proposals.updateById(id, {
      status: 'rolled_back',
      rolled_back_at: new Date(),
    });
    await emitImprovementAudit(this.ledger, {
      eventName: 'improvement.proposal.rolled_back',
      proposalId: id,
      outcome: 'success',
      payload: { kind: proposal.kind },
    });
    return updated ?? proposal;
  }

  private async applyProposal(
    proposal: ImprovementProposal,
  ): Promise<ImprovementProposal> {
    const applier = this.appliers.require(proposal.kind);
    try {
      const result = await applier.apply(proposal);
      if (result.ok) {
        const updated = await this.proposals.updateById(proposal.id, {
          status: 'applied',
          applied_at: new Date(),
          provenance: {
            ...proposal.provenance,
            apply_detail: result.detail ?? null,
            unrouted: result.unrouted ?? false,
          },
        });
        await emitImprovementAudit(this.ledger, {
          eventName: 'improvement.proposal.applied',
          proposalId: proposal.id,
          outcome: 'success',
          payload: { kind: proposal.kind, unrouted: result.unrouted ?? false },
        });
        return updated ?? proposal;
      }
      await this.rollbackAfterApplyFailure(applier, proposal);
      return await this.markFailed(
        proposal,
        result.detail ?? 'applier returned ok:false',
      );
    } catch (error) {
      this.logger.warn(
        `applier for kind '${proposal.kind}' threw during apply: ${String(error)}`,
      );
      await this.rollbackAfterApplyFailure(applier, proposal);
      return await this.markFailed(proposal, String(error));
    }
  }

  /**
   * Best-effort symmetric counterpart to the explicit `rollback()` path: when
   * `apply()` fails (returns `{ok:false}` or throws) after already persisting
   * a pre-mutation snapshot and reseed-protection marker (see
   * `AgentProfileChangeApplier`/`WorkflowDefinitionChangeApplier` apply-order
   * doc comments), the row would otherwise be left reseed-protected with its
   * *original* definition and an orphaned marker. Invoking `rollback` here
   * unwinds that.
   *
   * Only fires when a snapshot was actually persisted: many `apply()` failures
   * are *pre-mutation* (invalid payload, target not found, YAML parse/validation,
   * name mismatch) and return `{ok:false}` before `persistRollbackSnapshotOnce`
   * ever runs, so `rollback_data` is null and both appliers' `rollback()` throw
   * on absent data by design. The authoritative `rollback_data` is re-read from
   * the repository — the same source `rollback()` reads — so this guard and the
   * rollback it protects agree on exactly one view of whether a snapshot exists.
   *
   * A rollback failure must never mask the original apply failure or escape
   * `applyProposal` — it is logged and swallowed so the proposal is still
   * reliably marked `failed`.
   */
  private async rollbackAfterApplyFailure(
    applier: IImprovementApplier,
    proposal: ImprovementProposal,
  ): Promise<void> {
    if (typeof applier.rollback !== 'function') {
      return;
    }
    const current = (await this.proposals.findById(proposal.id)) ?? proposal;
    if (current.rollback_data === null || current.rollback_data === undefined) {
      return;
    }
    try {
      await applier.rollback(current);
    } catch (rollbackError) {
      this.logger.warn(
        `best-effort rollback for kind '${proposal.kind}' failed after apply failure: ${String(rollbackError)}`,
      );
    }
  }

  private async markFailed(
    proposal: ImprovementProposal,
    reason: string,
  ): Promise<ImprovementProposal> {
    const updated = await this.proposals.updateById(proposal.id, {
      status: 'failed',
      provenance: { ...proposal.provenance, apply_error: reason },
    });
    await emitImprovementAudit(this.ledger, {
      eventName: 'improvement.proposal.failed',
      proposalId: proposal.id,
      outcome: 'failure',
      payload: { kind: proposal.kind, reason },
    });
    return updated ?? proposal;
  }
}

/**
 * Reads `provenance.source` for governance's evidence-class confidence-cap
 * exemption check (see `decideGovernanceAction`). Fail-soft to `undefined`
 * for any shape that isn't a plain string — most producers carry no
 * provenance source relevant to governance at all.
 */
function readProvenanceSource(
  provenance: Record<string, unknown> | undefined,
): string | undefined {
  const source = provenance?.source;
  return typeof source === 'string' ? source : undefined;
}
